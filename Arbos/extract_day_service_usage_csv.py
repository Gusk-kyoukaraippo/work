#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET


SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


@dataclass
class DayResult:
    usage_date: date
    source_zip: str
    source_workbook: str
    users: list[str]
    reported_count: int | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract date/user-name rows from Arbos day-service daily-report workbooks."
    )
    parser.add_argument("--archives-dir", required=True, type=Path)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--summary", required=True, type=Path)
    return parser.parse_args()


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def workbook_date(name: str) -> date | None:
    match = re.search(r"(20\d{6})", name)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%Y%m%d").date()


def column_row(cell_ref: str) -> tuple[str, int]:
    match = re.fullmatch(r"([A-Z]+)(\d+)", cell_ref)
    if not match:
        raise ValueError(f"Unsupported cell reference: {cell_ref}")
    return match.group(1), int(match.group(2))


def shared_strings(xlsx: zipfile.ZipFile) -> list[str]:
    try:
        raw = xlsx.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    values: list[str] = []
    for item in root.findall(SHEET_NS + "si"):
        values.append("".join(text.text or "" for text in item.iter(SHEET_NS + "t")))
    return values


def first_sheet_path(xlsx: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(xlsx.read("xl/workbook.xml"))
    first_sheet = workbook.find(SHEET_NS + "sheets").find(SHEET_NS + "sheet")
    rel_id = first_sheet.attrib[REL_NS + "id"]

    rels = ET.fromstring(xlsx.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib["Target"]
            return "xl/" + target.lstrip("/")
    raise ValueError("Could not resolve first worksheet path")


def worksheet_cells(xlsx_bytes: bytes) -> dict[tuple[int, str], str]:
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as xlsx:
        strings = shared_strings(xlsx)
        sheet_path = first_sheet_path(xlsx)
        root = ET.fromstring(xlsx.read(sheet_path))

        cells: dict[tuple[int, str], str] = {}
        for cell in root.iter(SHEET_NS + "c"):
            ref = cell.attrib.get("r")
            if not ref:
                continue
            col, row = column_row(ref)
            value_node = cell.find(SHEET_NS + "v")
            inline_node = cell.find(SHEET_NS + "is")

            value = ""
            cell_type = cell.attrib.get("t")
            if cell_type == "s" and value_node is not None:
                value = strings[int(value_node.text)]
            elif cell_type == "inlineStr" and inline_node is not None:
                value = "".join(text.text or "" for text in inline_node.iter(SHEET_NS + "t"))
            elif value_node is not None:
                value = value_node.text or ""

            if value:
                cells[(row, col)] = value
        return cells


def parse_report(xlsx_bytes: bytes, usage_date: date, source_zip: str, source_workbook: str) -> DayResult:
    cells = worksheet_cells(xlsx_bytes)

    header_row = None
    end_row = None
    reported_count = None
    for (row, col), value in cells.items():
        if col == "C" and "利用者氏名" in value:
            header_row = row
        if col == "B" and "利用者数" in value:
            end_row = row
        if col == "B":
            count_match = re.fullmatch(r"(\d+)人", value.strip())
            if count_match:
                reported_count = int(count_match.group(1))

    if header_row is None:
        raise ValueError(f"No user-name header found in {source_zip}/{source_workbook}")
    if end_row is None:
        raise ValueError(f"No user-count boundary found in {source_zip}/{source_workbook}")

    users: list[str] = []
    for row in range(header_row + 1, end_row):
        number = cells.get((row, "B"), "").strip()
        name = cells.get((row, "C"), "").strip()
        if number.isdigit() and name:
            users.append(name)

    return DayResult(
        usage_date=usage_date,
        source_zip=source_zip,
        source_workbook=source_workbook,
        users=users,
        reported_count=reported_count,
    )


def iter_target_workbooks(archives_dir: Path, start: date, end: date) -> Iterable[tuple[date, Path, str, bytes]]:
    for archive in sorted(archives_dir.glob("*.zip")):
        with zipfile.ZipFile(archive) as outer:
            for workbook_name in outer.namelist():
                usage_date = workbook_date(workbook_name)
                if usage_date is None or usage_date < start or usage_date > end:
                    continue
                if not workbook_name.lower().endswith(".xlsx"):
                    continue
                yield usage_date, archive, workbook_name, outer.read(workbook_name)


def main() -> None:
    args = parse_args()
    start = parse_date(args.start)
    end = parse_date(args.end)

    by_date: dict[date, DayResult] = {}
    duplicates: list[str] = []
    errors: list[str] = []

    for usage_date, archive, workbook_name, data in iter_target_workbooks(args.archives_dir, start, end):
        try:
            result = parse_report(data, usage_date, archive.name, workbook_name)
        except Exception as exc:
            errors.append(f"{usage_date.isoformat()} {archive.name}/{workbook_name}: {exc}")
            continue
        if usage_date in by_date:
            duplicates.append(
                f"{usage_date.isoformat()}: {by_date[usage_date].source_zip}/{by_date[usage_date].source_workbook}"
                f" and {archive.name}/{workbook_name}"
            )
            continue
        by_date[usage_date] = result

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "user_name"])
        for usage_date in sorted(by_date):
            for user in by_date[usage_date].users:
                writer.writerow([usage_date.isoformat(), user])

    mismatches = [
        result
        for result in by_date.values()
        if result.reported_count is not None and result.reported_count != len(result.users)
    ]

    total_rows = sum(len(result.users) for result in by_date.values())
    unique_users = sorted({user for result in by_date.values() for user in result.users})
    with args.summary.open("w", encoding="utf-8") as handle:
        handle.write(f"Period: {start.isoformat()} to {end.isoformat()}\n")
        handle.write(f"Daily reports processed: {len(by_date)}\n")
        handle.write(f"CSV rows: {total_rows}\n")
        handle.write(f"Unique users: {len(unique_users)}\n")
        handle.write(f"Output: {args.output}\n\n")
        handle.write("Processed dates:\n")
        for usage_date in sorted(by_date):
            result = by_date[usage_date]
            handle.write(
                f"- {usage_date.isoformat()}: {len(result.users)} users"
                f" ({result.source_zip} / {result.source_workbook})\n"
            )
        if mismatches:
            handle.write("\nCount mismatches:\n")
            for result in sorted(mismatches, key=lambda item: item.usage_date):
                handle.write(
                    f"- {result.usage_date.isoformat()}: extracted {len(result.users)},"
                    f" reported {result.reported_count}\n"
                )
        if duplicates:
            handle.write("\nDuplicate dates skipped:\n")
            for duplicate in duplicates:
                handle.write(f"- {duplicate}\n")
        if errors:
            handle.write("\nErrors:\n")
            for error in errors:
                handle.write(f"- {error}\n")

    if errors:
        raise SystemExit(f"{len(errors)} workbook(s) could not be parsed; see {args.summary}")


if __name__ == "__main__":
    main()
