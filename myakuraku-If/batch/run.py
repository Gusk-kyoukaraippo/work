from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import yaml

from batch.pubmed_client import PubMedClient
from batch.query_builder import Department, University, build_full_query
from batch.storage import RunRecord, connect, get_latest_agg, init_db, insert_run, upsert_agg


CONFIG_DIR = Path("config")


def _load_yaml(path: Path) -> list[dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"Expected list in {path}")
    return data


def load_departments() -> list[Department]:
    items = _load_yaml(CONFIG_DIR / "departments.yaml")
    departments: list[Department] = []
    for item in items:
        departments.append(
            Department(
                id=item["id"],
                label_ja=item["label_ja"],
                label_en=item["label_en"],
                aff_patterns=item.get("aff_patterns", []),
                aff_exclude_patterns=item.get("aff_exclude_patterns", []),
                mesh_terms=item.get("mesh_terms", []),
            )
        )
    return departments


def load_universities() -> list[University]:
    items = _load_yaml(CONFIG_DIR / "universities.yaml")
    universities: list[University] = []
    for item in items:
        universities.append(
            University(
                id=item["id"],
                name_ja=item["name_ja"],
                name_en=item["name_en"],
                lat=float(item["lat"]),
                lon=float(item["lon"]),
                aff_patterns=item.get("aff_patterns", []),
                aff_exclude_patterns=item.get("aff_exclude_patterns", []),
            )
        )
    return universities


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch aggregation for PubMed counts.")
    parser.add_argument("--start-year", type=int, required=True)
    parser.add_argument("--end-year", type=int, required=True)
    parser.add_argument("--api-key", type=str, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Print queries and URLs, then exit.")
    parser.add_argument("--strict", action="store_true", help="Stop batch on API errors.")
    parser.add_argument(
        "--universities",
        type=str,
        help="University IDs (comma separated). Example: utokyo,kyoto",
    )
    parser.add_argument(
        "--departments",
        type=str,
        help="Department IDs (comma separated). Example: neurology,cardiology",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.start_year > args.end_year:
        raise SystemExit("start-year must be <= end-year")

    departments = load_departments()
    if not departments:
        raise SystemExit("No departments configured")
    universities = load_universities()
    if not universities:
        raise SystemExit("No universities configured")

    if args.universities:
        target_univ_ids = {item.strip() for item in args.universities.split(",") if item.strip()}
        universities = [u for u in universities if u.id in target_univ_ids]
        print(f"[DEBUG] Target universities: {[u.name_ja for u in universities]}")
        if not universities:
            raise SystemExit("No matching universities for --universities")

    if args.departments:
        target_dept_ids = {item.strip() for item in args.departments.split(",") if item.strip()}
        departments = [d for d in departments if d.id in target_dept_ids]
        print(f"[DEBUG] Target departments: {[d.label_ja for d in departments]}")
        if not departments:
            raise SystemExit("No matching departments for --departments")

    now = datetime.now(timezone.utc)
    run_id = now.strftime("run_%Y%m%dT%H%M%SZ")
    if_policy = "constant_1.0"
    notes = "IF=1.0 fixed; query uses AD/DP; counts from ESearch"

    client = PubMedClient(api_key=args.api_key, strict=args.strict)

    if args.dry_run:
        for year in range(args.start_year, args.end_year + 1):
            for department in departments:
                for university in universities:
                    query = build_full_query(university, department, year)
                    print(f"[DEBUG] Generated PubMed query: {query}")
                    print(
                        f"[DEBUG] Year: {year}, University: {university.id}, Department: {department.id}"
                    )
                    print(f"[DEBUG] Request URL: {client.build_esearch_url(query)}")
        return

    conn = connect()
    init_db(conn)
    insert_run(conn, RunRecord(run_id=run_id, computed_at=now.isoformat(), if_policy=if_policy, notes=notes))

    for year in range(args.start_year, args.end_year + 1):
        for department in departments:
            for university in universities:
                if not args.force:
                    existing = get_latest_agg(conn, year, university.id, department.id)
                    if existing:
                        print(
                            "[DEBUG] Saving to DB: "
                            f"year={year}, university_id={university.id}, department_id={department.id}, "
                            f"paper_count={int(existing['paper_count'])}, "
                            f"total_if={float(existing['total_if'])}"
                        )
                        upsert_agg(
                            conn,
                            run_id,
                            year,
                            university.id,
                            department.id,
                            int(existing["paper_count"]),
                            float(existing["total_if"]),
                            int(existing["unknown_if_count"]),
                        )
                        continue

                query = build_full_query(university, department, year)
                print(f"[DEBUG] Generated PubMed query: {query}")
                print(
                    f"[DEBUG] Year: {year}, University: {university.id}, Department: {department.id}"
                )
                count = client.esearch_count(query)
                total_if = float(count)
                unknown_if_count = 0
                print(
                    "[DEBUG] Saving to DB: "
                    f"year={year}, university_id={university.id}, department_id={department.id}, "
                    f"paper_count={count}, total_if={total_if}"
                )
                upsert_agg(
                    conn,
                    run_id,
                    year,
                    university.id,
                    department.id,
                    count,
                    total_if,
                    unknown_if_count,
                )

    conn.close()


if __name__ == "__main__":
    main()
