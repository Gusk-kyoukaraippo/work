#!/usr/bin/env python3
"""Extract floor schedule events from Arbos monthly planning workbooks."""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable


DEFAULT_TABLE_NAME = "floor_schedule_events"
DEFAULT_MATCH_TOLERANCE_DAYS = 1

EVENT_COLUMNS = [
    "event_id",
    "service_area",
    "movement_type",
    "scheduled_date",
    "schedule_month",
    "weekday",
    "form",
    "count",
    "is_new",
    "person_name",
    "person_name_key",
    "time_text",
    "transport",
    "place",
    "note",
    "discharge_destination",
    "discharge_reason",
    "followup_exclusion_reason",
    "source_kind",
    "source_file",
    "sheet_name",
    "source_row",
    "source_side",
    "matched_user_id",
    "matched_segment_start",
    "matched_segment_end",
    "match_delta_days",
    "match_status",
]


@dataclass(frozen=True)
class ScheduleEvent:
    event_id: str
    service_area: str
    movement_type: str
    scheduled_date: date
    schedule_month: str
    weekday: str
    form: str
    count: str
    is_new: str
    person_name: str
    person_name_key: str
    time_text: str
    transport: str
    place: str
    note: str
    source_kind: str
    source_file: str
    sheet_name: str
    source_row: int
    source_side: str
    discharge_destination: str = ""
    discharge_reason: str = ""
    followup_exclusion_reason: str = ""
    matched_user_id: str = ""
    matched_segment_start: str = ""
    matched_segment_end: str = ""
    match_delta_days: int | None = None
    match_status: str = ""


def normalize_text(value: object) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip()


def normalize_name_key(value: object) -> str:
    text = normalize_text(value)
    return re.sub(r"[\s\u3000・･()（）\[\]【】]+", "", text)


def parse_month_text(value: str) -> tuple[int, int] | None:
    text = normalize_text(value).replace(" ", "")
    match = re.search(r"(平成|H)(\d+)年(\d+)月", text)
    if match:
        return 1988 + int(match.group(2)), int(match.group(3))
    match = re.search(r"(令和|R)(\d+)[年\.](\d+)月", text)
    if match:
        return 2018 + int(match.group(2)), int(match.group(3))
    match = re.search(r"(20\d{2})[-/年\.](\d{1,2})", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def parse_month_arg(value: str) -> tuple[int, int]:
    parsed = parse_month_text(value)
    if not parsed:
        raise argparse.ArgumentTypeError(f"年月を解釈できません: {value}")
    year, month = parsed
    if not 1 <= month <= 12:
        raise argparse.ArgumentTypeError(f"月が不正です: {value}")
    return year, month


def month_key(year_month: tuple[int, int]) -> int:
    year, month = year_month
    return year * 12 + month


def month_label(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def parse_sheet_month(sheet_name: str) -> tuple[int, int] | None:
    return parse_month_text(sheet_name)


def format_excel_cell(value: object) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return normalize_text(value)


def format_excel_time(value: object) -> str:
    if isinstance(value, float) and 0 <= value < 1:
        total_minutes = round(value * 24 * 60)
        return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"
    return format_excel_cell(value)


def make_event_id(
    service_area: str,
    source_file: str,
    sheet_name: str,
    source_row: int,
    source_side: str,
    scheduled_date: date,
    person_name_key: str,
    form: str,
    place: str,
    time_text: str,
) -> str:
    payload = "|".join(
        [
            service_area,
            Path(source_file).name,
            sheet_name,
            str(source_row),
            source_side,
            scheduled_date.isoformat(),
            person_name_key,
            form,
            place,
            time_text,
        ]
    )
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]
    return f"S_{digest}"


def find_schedule_header(row: list[str]) -> dict[str, int] | None:
    if "日" not in row or "曜" not in row:
        return None
    if row.count("形態") < 2 or row.count("氏名") < 2:
        return None
    return {"day": row.index("日"), "weekday": row.index("曜")}


def find_occurrence(row: list[str], label: str, occurrence_index: int) -> int | None:
    positions = [index for index, value in enumerate(row) if value == label]
    if len(positions) <= occurrence_index:
        return None
    return positions[occurrence_index]


def side_columns(row: list[str], side_index: int) -> dict[str, int | None]:
    return {
        "form": find_occurrence(row, "形態", side_index),
        "count": find_occurrence(row, "数", side_index),
        "is_new": find_occurrence(row, "新", side_index),
        "person_name": find_occurrence(row, "氏名", side_index),
        "time_text": find_occurrence(row, "時間", side_index),
        "transport": find_occurrence(row, "送迎", side_index),
        "place": find_occurrence(row, "場所", side_index),
        "note": find_occurrence(row, "備考", side_index),
    }


def cell_value(row_values: list[object], column: int | None, *, time_value: bool = False) -> str:
    if column is None or column >= len(row_values):
        return ""
    value = row_values[column]
    return format_excel_time(value) if time_value else format_excel_cell(value)


def extract_events_from_workbook(
    workbook_path: Path,
    *,
    service_area: str,
    start_month: tuple[int, int],
    end_month: tuple[int, int],
) -> list[ScheduleEvent]:
    try:
        import xlrd
    except ImportError as exc:
        raise RuntimeError("Excel .xls の読み取りには xlrd が必要です: python3 -m pip install xlrd") from exc

    workbook = xlrd.open_workbook(str(workbook_path), on_demand=True)
    events: list[ScheduleEvent] = []
    start_key = month_key(start_month)
    end_key = month_key(end_month)

    for sheet_name in workbook.sheet_names():
        sheet_month = parse_sheet_month(sheet_name)
        if not sheet_month:
            continue
        if not start_key <= month_key(sheet_month) <= end_key:
            continue

        sheet = workbook.sheet_by_name(sheet_name)
        header_row_index: int | None = None
        header_info: dict[str, int] | None = None
        header_values: list[str] = []
        for row_index in range(min(12, sheet.nrows)):
            row = [normalize_text(sheet.cell_value(row_index, col)) for col in range(sheet.ncols)]
            info = find_schedule_header(row)
            if info:
                header_row_index = row_index
                header_info = info
                header_values = row
                break
        if header_row_index is None or header_info is None:
            continue

        admission_columns = side_columns(header_values, 0)
        discharge_columns = side_columns(header_values, 1)
        current_date: date | None = None
        current_weekday = ""
        year, month = sheet_month

        for row_index in range(header_row_index + 1, sheet.nrows):
            row_values = [sheet.cell_value(row_index, col) for col in range(sheet.ncols)]
            day_value = row_values[header_info["day"]] if header_info["day"] < len(row_values) else ""
            weekday_value = row_values[header_info["weekday"]] if header_info["weekday"] < len(row_values) else ""
            if isinstance(day_value, float) and day_value > 25000:
                current_date = xlrd.xldate.xldate_as_datetime(day_value, workbook.datemode).date()
            elif isinstance(day_value, (float, int)) and 1 <= int(day_value) <= 31:
                try:
                    current_date = date(year, month, int(day_value))
                except ValueError:
                    current_date = None
            elif normalize_text(day_value).isdigit():
                try:
                    current_date = date(year, month, int(normalize_text(day_value)))
                except ValueError:
                    current_date = None
            if normalize_text(weekday_value):
                current_weekday = normalize_text(weekday_value)

            if not current_date:
                continue

            events.extend(
                make_events_for_row(
                    row_values,
                    columns=admission_columns,
                    movement_type="floor_in",
                    source_side="left",
                    source_file=str(workbook_path),
                    sheet_name=sheet_name,
                    source_row=row_index + 1,
                    scheduled_date=current_date,
                    schedule_month=month_label(year, month),
                    weekday=current_weekday,
                    service_area=service_area,
                )
            )
            events.extend(
                make_events_for_row(
                    row_values,
                    columns=discharge_columns,
                    movement_type="floor_out",
                    source_side="right",
                    source_file=str(workbook_path),
                    sheet_name=sheet_name,
                    source_row=row_index + 1,
                    scheduled_date=current_date,
                    schedule_month=month_label(year, month),
                    weekday=current_weekday,
                    service_area=service_area,
                )
            )

        workbook.unload_sheet(sheet_name)

    workbook.release_resources()
    return events


def make_events_for_row(
    row_values: list[object],
    *,
    columns: dict[str, int | None],
    movement_type: str,
    source_side: str,
    source_file: str,
    sheet_name: str,
    source_row: int,
    scheduled_date: date,
    schedule_month: str,
    weekday: str,
    service_area: str,
) -> list[ScheduleEvent]:
    form = cell_value(row_values, columns["form"])
    count = cell_value(row_values, columns["count"])
    is_new = cell_value(row_values, columns["is_new"])
    person_name = cell_value(row_values, columns["person_name"])
    time_text = cell_value(row_values, columns["time_text"], time_value=True)
    transport = cell_value(row_values, columns["transport"])
    place = cell_value(row_values, columns["place"])
    note = cell_value(row_values, columns["note"])

    # Person-level schedule events must have a name. Rows without names are
    # workbook helper notes/totals in the floor sheets and cannot be matched to CSV.
    if not person_name:
        return []
    # Floor workbooks also use the name cells for same-floor room-change notes
    # such as "A12→17"; these are not admission/discharge schedule events.
    if "→" in person_name and not form:
        return []

    person_name_key = normalize_name_key(person_name)
    event_id = make_event_id(
        service_area,
        source_file,
        sheet_name,
        source_row,
        source_side,
        scheduled_date,
        person_name_key,
        form,
        place,
        time_text,
    )
    discharge_destination, discharge_reason, followup_exclusion_reason = classify_discharge_event(
        movement_type=movement_type,
        form=form,
        place=place,
        note=note,
    )
    return [
        ScheduleEvent(
            event_id=event_id,
            service_area=service_area,
            movement_type=movement_type,
            scheduled_date=scheduled_date,
            schedule_month=schedule_month,
            weekday=weekday,
            form=form,
            count=count,
            is_new=is_new,
            person_name=person_name,
            person_name_key=person_name_key,
            time_text=time_text,
            transport=transport,
            place=place,
            note=note,
            discharge_destination=discharge_destination,
            discharge_reason=discharge_reason,
            followup_exclusion_reason=followup_exclusion_reason,
            source_kind="excel_workbook",
            source_file=str(source_file),
            sheet_name=sheet_name,
            source_row=source_row,
            source_side=source_side,
        )
    ]


def classify_discharge_event(
    *,
    movement_type: str,
    form: str,
    place: str,
    note: str,
) -> tuple[str, str, str]:
    if movement_type != "floor_out":
        return "", "", ""

    text = normalize_text(f"{place} {note}")
    if not text:
        return "", "", ""

    if any(keyword in text for keyword in ("死亡", "死去", "逝去", "永眠")):
        return "死亡", "死亡退所", "死亡退所"

    if any(keyword in text for keyword in ("特養", "特別養護老人ホーム")):
        return destination_from_place_note(place, note, "特養"), "施設退所", "施設退所"

    paid_home_keywords = ("住宅型有料", "介護付有料", "有料老人", "有料")
    if any(keyword in text for keyword in paid_home_keywords):
        return destination_from_place_note(place, note, "有料老人ホーム"), "施設退所", "施設退所"

    if any(keyword in text for keyword in ("老健", "グループホーム", "サ高住", "サービスハウス", "施設")):
        return destination_from_place_note(place, note, "施設"), "施設退所", "施設退所"

    if "退所後" in text and "入所" in text:
        return destination_from_place_note(place, note, "施設"), "施設退所", "施設退所"

    if any(keyword in text for keyword in ("病院", "HSP", "HP", "HOSP", "併設", "日赤", "医療")):
        return place_or_default(place, "病院"), "病院退所", ""

    if any(keyword in text for keyword in ("転床", "転棟")) or place in {"2F", "3F", "ユニット"}:
        return place_or_default(place, "施設内移動"), "施設内移動", ""

    if "自宅" in text:
        return "自宅", "自宅退所", ""

    if form in {"ショート", "短期"}:
        return place_or_default(place, ""), "ショート終了", ""

    return place_or_default(place, ""), "", ""


def place_or_default(place: str, default: str) -> str:
    return place if place and place != "不明" else default


def destination_from_place_note(place: str, note: str, default: str) -> str:
    if place and place not in {"不明", "自宅"}:
        return place
    return note or place_or_default(place, default)


def read_text_with_fallback(path: Path) -> str:
    for encoding in ("cp932", "utf-8-sig", "utf-8"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("csv", b"", 0, 1, f"CSV文字コードを判定できません: {path}")


def load_name_to_user_ids(daily_csv_dir: Path | None) -> dict[str, set[str]]:
    if not daily_csv_dir:
        return {}
    name_to_ids: dict[str, set[str]] = {}
    for path in sorted(daily_csv_dir.glob("**/*.csv")):
        content = read_text_with_fallback(path)
        reader = csv.DictReader(content.splitlines())
        for row in reader:
            user_id = normalize_text(row.get("患者ID"))
            name_key = normalize_name_key(row.get("氏名"))
            if not user_id or not name_key:
                continue
            name_to_ids.setdefault(name_key, set()).add(user_id)
    return name_to_ids


def load_floor_segments(db_path: Path, service_area: str) -> tuple[dict[str, list[tuple[date, date]]], date | None]:
    if not db_path.exists():
        return {}, None
    with sqlite3.connect(db_path) as conn:
        if not table_exists(conn, "daily_residents"):
            return {}, None
        latest_row = conn.execute("SELECT max(snapshot_date) FROM daily_residents").fetchone()
        latest_snapshot = date.fromisoformat(latest_row[0]) if latest_row and latest_row[0] else None
        rows = conn.execute(
            """
            SELECT user_id, snapshot_date
            FROM daily_residents
            WHERE floor = ?
            ORDER BY user_id, snapshot_date
            """,
            (service_area,),
        ).fetchall()

    dates_by_user: dict[str, list[date]] = {}
    for user_id, snapshot_date in rows:
        dates_by_user.setdefault(user_id, []).append(date.fromisoformat(snapshot_date))

    segments: dict[str, list[tuple[date, date]]] = {}
    for user_id, dates in dates_by_user.items():
        unique_dates = sorted(set(dates))
        if not unique_dates:
            continue
        start = previous = unique_dates[0]
        for current in unique_dates[1:]:
            if (current - previous).days > 1:
                segments.setdefault(user_id, []).append((start, previous))
                start = current
            previous = current
        segments.setdefault(user_id, []).append((start, previous))
    return segments, latest_snapshot


def match_events(
    events: list[ScheduleEvent],
    *,
    db_path: Path,
    daily_csv_dir: Path | None,
    tolerance_days: int,
) -> list[ScheduleEvent]:
    name_to_ids = load_name_to_user_ids(daily_csv_dir)
    segments_by_user, latest_snapshot = load_floor_segments(db_path, events[0].service_area if events else "")
    matched: list[ScheduleEvent] = []

    for event in events:
        if not event.person_name_key:
            matched.append(replace_match(event, match_status="not_matched_no_name"))
            continue
        user_ids = name_to_ids.get(event.person_name_key, set())
        if not user_ids:
            # Daily CSV is the identity source of truth. Workbook names are hand-entered
            # and may contain kanji variants or typos, so keep these as flagged matches.
            fallback = find_unique_boundary_match(
                segments_by_user,
                event=event,
                tolerance_days=tolerance_days,
            )
            if fallback:
                user_id, start, end, delta = fallback
                matched.append(
                    replace_match(
                        event,
                        matched_user_id=user_id,
                        matched_segment_start=start.isoformat(),
                        matched_segment_end=end.isoformat(),
                        match_delta_days=delta,
                        match_status="matched_boundary_only_name_mismatch",
                    )
                )
                continue
            status = "future_unverified_no_known_id" if latest_snapshot and event.scheduled_date > latest_snapshot else "not_matched_name_unknown"
            matched.append(replace_match(event, match_status=status))
            continue
        if len(user_ids) > 1:
            matched.append(replace_match(event, match_status="not_matched_name_ambiguous"))
            continue
        user_id = next(iter(user_ids))
        segments = segments_by_user.get(user_id, [])
        if not segments:
            status = "future_unverified_no_floor_segment" if latest_snapshot and event.scheduled_date > latest_snapshot else "not_matched_no_floor_segment"
            matched.append(replace_match(event, matched_user_id=user_id, match_status=status))
            continue
        target_index = 0 if event.movement_type == "floor_in" else 1
        candidates = []
        for start, end in segments:
            boundary = start if target_index == 0 else end
            delta = (boundary - event.scheduled_date).days
            candidates.append((abs(delta), delta, start, end))
        candidates.sort(key=lambda item: (item[0], abs((item[2] - event.scheduled_date).days), item[2]))
        abs_delta, delta, start, end = candidates[0]
        if abs_delta == 0:
            status = "matched_exact"
        elif abs_delta <= tolerance_days:
            status = "matched_within_tolerance"
        elif latest_snapshot and event.scheduled_date > latest_snapshot:
            status = "future_unverified"
        else:
            status = "not_matched_boundary_mismatch"
        matched.append(
            replace_match(
                event,
                matched_user_id=user_id,
                matched_segment_start=start.isoformat(),
                matched_segment_end=end.isoformat(),
                match_delta_days=delta,
                match_status=status,
            )
        )
    return matched


def find_unique_boundary_match(
    segments_by_user: dict[str, list[tuple[date, date]]],
    *,
    event: ScheduleEvent,
    tolerance_days: int,
) -> tuple[str, date, date, int] | None:
    target_index = 0 if event.movement_type == "floor_in" else 1
    candidates: list[tuple[str, date, date, int]] = []
    for user_id, segments in segments_by_user.items():
        for start, end in segments:
            boundary = start if target_index == 0 else end
            delta = (boundary - event.scheduled_date).days
            if abs(delta) <= tolerance_days:
                candidates.append((user_id, start, end, delta))
    if len(candidates) == 1:
        return candidates[0]
    return None


def replace_match(
    event: ScheduleEvent,
    *,
    matched_user_id: str = "",
    matched_segment_start: str = "",
    matched_segment_end: str = "",
    match_delta_days: int | None = None,
    match_status: str,
) -> ScheduleEvent:
    return ScheduleEvent(
        **{
            **event.__dict__,
            "matched_user_id": matched_user_id,
            "matched_segment_start": matched_segment_start,
            "matched_segment_end": matched_segment_end,
            "match_delta_days": match_delta_days,
            "match_status": match_status,
        }
    )


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def create_events_table(conn: sqlite3.Connection, table_name: str) -> None:
    validate_identifier(table_name)
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            event_id TEXT PRIMARY KEY,
            service_area TEXT NOT NULL,
            movement_type TEXT NOT NULL,
            scheduled_date TEXT NOT NULL,
            schedule_month TEXT NOT NULL,
            weekday TEXT NOT NULL,
            form TEXT NOT NULL,
            count TEXT NOT NULL,
            is_new TEXT NOT NULL,
            person_name TEXT NOT NULL,
            person_name_key TEXT NOT NULL,
            time_text TEXT NOT NULL,
            transport TEXT NOT NULL,
            place TEXT NOT NULL,
            note TEXT NOT NULL,
            discharge_destination TEXT NOT NULL DEFAULT '',
            discharge_reason TEXT NOT NULL DEFAULT '',
            followup_exclusion_reason TEXT NOT NULL DEFAULT '',
            source_kind TEXT NOT NULL,
            source_file TEXT NOT NULL,
            sheet_name TEXT NOT NULL,
            source_row INTEGER NOT NULL,
            source_side TEXT NOT NULL,
            matched_user_id TEXT NOT NULL,
            matched_segment_start TEXT NOT NULL,
            matched_segment_end TEXT NOT NULL,
            match_delta_days INTEGER,
            match_status TEXT NOT NULL
        )
        """
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_area_date ON {table_name} (service_area, scheduled_date)"
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_match ON {table_name} (matched_user_id, match_status)"
    )
    ensure_event_columns(conn, table_name)


def ensure_event_columns(conn: sqlite3.Connection, table_name: str) -> None:
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})")}
    for column in ("discharge_destination", "discharge_reason", "followup_exclusion_reason"):
        if column not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")


def validate_identifier(value: str) -> None:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise ValueError(f"SQLite識別子として不正です: {value}")


def write_events(
    db_path: Path,
    events: list[ScheduleEvent],
    *,
    table_name: str,
    replace_area_period: bool,
    service_area: str,
    start_month: tuple[int, int],
    end_month: tuple[int, int],
) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        create_events_table(conn, table_name)
        if replace_area_period:
            conn.execute(
                f"""
                DELETE FROM {table_name}
                WHERE service_area = ?
                  AND schedule_month BETWEEN ? AND ?
                """,
                (service_area, month_label(*start_month), month_label(*end_month)),
            )
        conn.executemany(
            f"""
            INSERT OR REPLACE INTO {table_name} (
                {", ".join(EVENT_COLUMNS)}
            ) VALUES (
                {", ".join("?" for _ in EVENT_COLUMNS)}
            )
            """,
            [event_to_tuple(event) for event in events],
        )
        conn.commit()


def event_to_tuple(event: ScheduleEvent) -> tuple[object, ...]:
    return (
        event.event_id,
        event.service_area,
        event.movement_type,
        event.scheduled_date.isoformat(),
        event.schedule_month,
        event.weekday,
        event.form,
        event.count,
        event.is_new,
        event.person_name,
        event.person_name_key,
        event.time_text,
        event.transport,
        event.place,
        event.note,
        event.discharge_destination,
        event.discharge_reason,
        event.followup_exclusion_reason,
        event.source_kind,
        event.source_file,
        event.sheet_name,
        event.source_row,
        event.source_side,
        event.matched_user_id,
        event.matched_segment_start,
        event.matched_segment_end,
        event.match_delta_days,
        event.match_status,
    )


def export_events_csv(path: Path, events: Iterable[ScheduleEvent]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=EVENT_COLUMNS)
        writer.writeheader()
        for event in events:
            row = dict(zip(EVENT_COLUMNS, event_to_tuple(event), strict=True))
            writer.writerow(row)


def collect_input_paths(values: list[str]) -> list[Path]:
    paths: list[Path] = []
    for value in values:
        matches = sorted(Path().glob(value)) if any(char in value for char in "*?[]") else [Path(value)]
        for match in matches:
            if match.is_file():
                paths.append(match)
    if not paths:
        raise FileNotFoundError("入力Excelファイルが見つかりません")
    return paths


def run_extract(args: argparse.Namespace) -> None:
    start_month = parse_month_arg(args.start_month)
    end_month = parse_month_arg(args.end_month)
    if month_key(start_month) > month_key(end_month):
        raise ValueError("--start-month は --end-month 以前にしてください")

    input_paths = collect_input_paths(args.input)
    events: list[ScheduleEvent] = []
    for input_path in input_paths:
        if input_path.suffix.lower() != ".xls":
            raise ValueError(f"現在の自動抽出は .xls 対応です: {input_path}")
        events.extend(
            extract_events_from_workbook(
                input_path,
                service_area=args.area,
                start_month=start_month,
                end_month=end_month,
            )
        )

    if args.daily_csv_dir:
        events = match_events(
            events,
            db_path=Path(args.db),
            daily_csv_dir=Path(args.daily_csv_dir),
            tolerance_days=args.match_tolerance_days,
        )
    else:
        events = [replace_match(event, match_status="not_matched_not_requested") for event in events]

    write_events(
        Path(args.db),
        events,
        table_name=args.table,
        replace_area_period=args.replace_area_period,
        service_area=args.area,
        start_month=start_month,
        end_month=end_month,
    )
    if args.output_csv:
        export_events_csv(Path(args.output_csv), events)

    print(f"入力Excel数: {len(input_paths)}")
    print(f"抽出イベント数: {len(events)}")
    print(f"対象: {args.area} / {month_label(*start_month)}〜{month_label(*end_month)}")
    print(f"SQLiteテーブル: {Path(args.db)}::{args.table}")
    if args.daily_csv_dir:
        statuses: dict[str, int] = {}
        for event in events:
            statuses[event.match_status] = statuses.get(event.match_status, 0) + 1
        print("照合結果:")
        for status, count in sorted(statuses.items()):
            print(f"  {status}: {count}")
    if args.output_csv:
        print(f"確認CSV: {Path(args.output_csv)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="月別入退所予定Excelからフロア別予定イベントを抽出してSQLite別テーブルへ保存します。"
    )
    parser.add_argument("--input", action="append", required=True, help="入力 .xls。複数指定またはglob指定可")
    parser.add_argument("--db", default="data/db/arbos_episodes.sqlite3", help="保存先SQLite DB")
    parser.add_argument("--area", required=True, help="予定表の対象。例: ユニット, 2F, 3F")
    parser.add_argument("--start-month", required=True, help="開始年月。例: 2025-04, R7.4月")
    parser.add_argument("--end-month", required=True, help="終了年月。例: 2025-06, R7.6月")
    parser.add_argument("--table", default=DEFAULT_TABLE_NAME, help=f"保存先テーブル名。既定: {DEFAULT_TABLE_NAME}")
    parser.add_argument(
        "--daily-csv-dir",
        help="患者ID照合に使う日々CSVフォルダ。指定すると氏名+フロア滞在区間で照合します。",
    )
    parser.add_argument(
        "--match-tolerance-days",
        type=int,
        default=DEFAULT_MATCH_TOLERANCE_DAYS,
        help="SQLite実績境界日との許容日差。既定: 1",
    )
    parser.add_argument(
        "--replace-area-period",
        action="store_true",
        help="同じareaかつ対象年月範囲の既存予定イベントを削除してから保存します。",
    )
    parser.add_argument("--output-csv", help="確認用CSVも出力する場合のパス")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        run_extract(args)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
