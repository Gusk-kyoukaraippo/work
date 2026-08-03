from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE_DB = ROOT / "data/db/arbos_episodes.sqlite3"
DEFAULT_DAY_SERVICE_CSV = (
    ROOT / "data/day_service_user_lists/day_service_usage_2025-04-01_2026-06-08.csv"
)
DEFAULT_DAILY_CSV_DIR = ROOT / "data/raw/daily_csv"
DEFAULT_OUTPUT_DB = ROOT / "data/db/arbos_analysis.sqlite3"


def normalize_text(value: object) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip()


def normalize_name_key(value: object) -> str:
    text = normalize_text(value)
    return re.sub(r"[\s\u3000・･()（）\[\]【】]+", "", text)


def parse_snapshot_date(path: Path) -> str:
    match = re.search(r"(20\d{6})", path.name)
    if not match:
        raise ValueError(f"日付をファイル名から読めません: {path}")
    raw = match.group(1)
    return date(int(raw[:4]), int(raw[4:6]), int(raw[6:8])).isoformat()


def read_csv_dicts(path: Path, encoding: str) -> list[dict[str, str]]:
    with path.open(newline="", encoding=encoding) as file:
        return list(csv.DictReader(file))


@dataclass(frozen=True)
class ResidentNameObservation:
    snapshot_date: str
    user_id: str
    user_name: str
    user_name_key: str
    kana_name: str
    source_file: str


@dataclass(frozen=True)
class ResidentIdentity:
    user_id: str
    user_name: str
    user_name_key: str
    kana_name: str
    first_seen_date: str
    last_seen_date: str
    observation_count: int


def load_resident_name_observations(daily_csv_dir: Path) -> list[ResidentNameObservation]:
    observations: list[ResidentNameObservation] = []
    for path in sorted(daily_csv_dir.rglob("*.csv")):
        snapshot_date = parse_snapshot_date(path)
        for row in read_csv_dicts(path, "cp932"):
            user_id = normalize_text(row.get("患者ID"))
            user_name = normalize_text(row.get("氏名"))
            if not user_id or not user_name:
                continue
            observations.append(
                ResidentNameObservation(
                    snapshot_date=snapshot_date,
                    user_id=user_id,
                    user_name=user_name,
                    user_name_key=normalize_name_key(user_name),
                    kana_name=normalize_text(row.get("カナ氏名")),
                    source_file=str(path.relative_to(ROOT)),
                )
            )
    return observations


def build_resident_identities(
    observations: list[ResidentNameObservation],
) -> list[ResidentIdentity]:
    by_user: dict[str, list[ResidentNameObservation]] = defaultdict(list)
    for observation in observations:
        by_user[observation.user_id].append(observation)

    identities: list[ResidentIdentity] = []
    for user_id, rows in sorted(by_user.items()):
        name = Counter(row.user_name for row in rows).most_common(1)[0][0]
        kana_values = [row.kana_name for row in rows if row.kana_name]
        kana_name = Counter(kana_values).most_common(1)[0][0] if kana_values else ""
        dates = [row.snapshot_date for row in rows]
        identities.append(
            ResidentIdentity(
                user_id=user_id,
                user_name=name,
                user_name_key=normalize_name_key(name),
                kana_name=kana_name,
                first_seen_date=min(dates),
                last_seen_date=max(dates),
                observation_count=len(rows),
            )
        )
    return identities


def quote_attach_path(path: Path) -> str:
    return str(path).replace("'", "''")


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = OFF;

        CREATE TABLE analysis_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE resident_name_observations (
            snapshot_date TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_name TEXT NOT NULL,
            user_name_key TEXT NOT NULL,
            kana_name TEXT NOT NULL,
            source_file TEXT NOT NULL,
            PRIMARY KEY (snapshot_date, user_id)
        );

        CREATE TABLE resident_identities (
            user_id TEXT PRIMARY KEY,
            user_name TEXT NOT NULL,
            user_name_key TEXT NOT NULL,
            kana_name TEXT NOT NULL,
            first_seen_date TEXT NOT NULL,
            last_seen_date TEXT NOT NULL,
            observation_count INTEGER NOT NULL
        );

        CREATE INDEX idx_resident_identities_name_key
            ON resident_identities (user_name_key);
        """
    )


def insert_identity_data(
    conn: sqlite3.Connection,
    observations: list[ResidentNameObservation],
    identities: list[ResidentIdentity],
) -> None:
    conn.executemany(
        """
        INSERT INTO resident_name_observations (
            snapshot_date, user_id, user_name, user_name_key, kana_name, source_file
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                row.snapshot_date,
                row.user_id,
                row.user_name,
                row.user_name_key,
                row.kana_name,
                row.source_file,
            )
            for row in observations
        ],
    )
    conn.executemany(
        """
        INSERT INTO resident_identities (
            user_id, user_name, user_name_key, kana_name,
            first_seen_date, last_seen_date, observation_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                row.user_id,
                row.user_name,
                row.user_name_key,
                row.kana_name,
                row.first_seen_date,
                row.last_seen_date,
                row.observation_count,
            )
            for row in identities
        ],
    )


def import_resident_tables(conn: sqlite3.Connection, source_db: Path) -> None:
    conn.execute(f"ATTACH DATABASE '{quote_attach_path(source_db)}' AS src")
    conn.executescript(
        """
        CREATE TABLE resident_users AS
        SELECT u.*, i.user_name, i.user_name_key, i.kana_name
        FROM src.users AS u
        LEFT JOIN resident_identities AS i USING (user_id);

        CREATE TABLE resident_episodes AS
        SELECT
            e.*,
            COALESCE(i.user_name, '') AS user_name,
            COALESCE(i.user_name_key, '') AS user_name_key,
            COALESCE(i.kana_name, '') AS kana_name,
            CASE
                WHEN e.admission_type = '長期' THEN 'long_stay'
                WHEN e.admission_type = '短期' THEN 'short_stay'
                ELSE 'unknown_resident_stay'
            END AS stay_type
        FROM src.episodes AS e
        LEFT JOIN resident_identities AS i USING (user_id);

        CREATE TABLE resident_daily_stays AS
        SELECT
            d.*,
            COALESCE(i.user_name, '') AS user_name,
            COALESCE(i.user_name_key, '') AS user_name_key,
            COALESCE(i.kana_name, '') AS kana_name,
            CASE
                WHEN d.admission_type = '長期' THEN 'long_stay'
                WHEN d.admission_type = '短期' THEN 'short_stay'
                ELSE 'unknown_resident_stay'
            END AS stay_type
        FROM src.daily_residents AS d
        LEFT JOIN resident_identities AS i USING (user_id);

        CREATE TABLE floor_capacity AS
        SELECT * FROM src.floor_capacity;

        CREATE TABLE floor_schedule_events AS
        SELECT * FROM src.floor_schedule_events;

        CREATE INDEX idx_resident_users_user_id
            ON resident_users (user_id);
        CREATE INDEX idx_resident_episodes_user_dates
            ON resident_episodes (user_id, admission_date, discharge_date);
        CREATE INDEX idx_resident_episodes_type_date
            ON resident_episodes (admission_type, admission_date);
        CREATE INDEX idx_resident_daily_stays_date_user
            ON resident_daily_stays (snapshot_date, user_id);
        CREATE INDEX idx_resident_daily_stays_type_date
            ON resident_daily_stays (stay_type, snapshot_date);
        CREATE INDEX idx_floor_schedule_events_person
            ON floor_schedule_events (person_name_key, scheduled_date);
        """
    )
    conn.execute("DETACH DATABASE src")


def import_day_service_usage(
    conn: sqlite3.Connection,
    day_service_csv: Path,
    identities: list[ResidentIdentity],
) -> None:
    name_to_ids: dict[str, set[str]] = defaultdict(set)
    for identity in identities:
        if identity.user_name_key:
            name_to_ids[identity.user_name_key].add(identity.user_id)

    conn.executescript(
        """
        CREATE TABLE day_service_usage (
            usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
            usage_date TEXT NOT NULL,
            user_name TEXT NOT NULL,
            user_name_key TEXT NOT NULL,
            matched_user_id TEXT NOT NULL,
            match_status TEXT NOT NULL
        );

        CREATE INDEX idx_day_service_usage_date
            ON day_service_usage (usage_date);
        CREATE INDEX idx_day_service_usage_name_key
            ON day_service_usage (user_name_key);
        CREATE INDEX idx_day_service_usage_match
            ON day_service_usage (matched_user_id, match_status);
        """
    )

    rows = read_csv_dicts(day_service_csv, "utf-8-sig")
    insert_rows: list[tuple[str, str, str, str, str]] = []
    for row in rows:
        usage_date = normalize_text(row.get("date"))
        user_name = normalize_text(row.get("user_name"))
        user_name_key = normalize_name_key(user_name)
        candidate_ids = sorted(name_to_ids.get(user_name_key, set()))
        if not user_name_key:
            matched_user_id = ""
            match_status = "not_matched_no_name"
        elif len(candidate_ids) == 1:
            matched_user_id = candidate_ids[0]
            match_status = "matched"
        elif len(candidate_ids) > 1:
            matched_user_id = ""
            match_status = "ambiguous_name"
        else:
            matched_user_id = ""
            match_status = "not_matched_name_unknown"
        insert_rows.append(
            (usage_date, user_name, user_name_key, matched_user_id, match_status)
        )

    conn.executemany(
        """
        INSERT INTO day_service_usage (
            usage_date, user_name, user_name_key, matched_user_id, match_status
        ) VALUES (?, ?, ?, ?, ?)
        """,
        insert_rows,
    )

    conn.executescript(
        """
        CREATE TABLE day_service_name_matches AS
        SELECT
            d.user_name_key,
            MIN(d.user_name) AS representative_name,
            COUNT(*) AS usage_rows,
            COUNT(DISTINCT d.usage_date) AS usage_days,
            MIN(d.usage_date) AS first_usage_date,
            MAX(d.usage_date) AS last_usage_date,
            d.match_status,
            d.matched_user_id,
            GROUP_CONCAT(DISTINCT i.user_id) AS candidate_user_ids
        FROM day_service_usage AS d
        LEFT JOIN resident_identities AS i
          ON i.user_name_key = d.user_name_key
        GROUP BY d.user_name_key, d.match_status, d.matched_user_id;

        CREATE INDEX idx_day_service_name_matches_status
            ON day_service_name_matches (match_status, matched_user_id);
        """
    )


def create_analysis_views(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE VIEW v_day_service_match_quality AS
        SELECT
            match_status,
            COUNT(*) AS usage_rows,
            COUNT(DISTINCT user_name_key) AS unique_names,
            COUNT(DISTINCT usage_date) AS usage_dates
        FROM day_service_usage
        GROUP BY match_status;

        CREATE VIEW v_person_service_days AS
        SELECT DISTINCT
            snapshot_date AS usage_date,
            user_id AS person_id,
            user_id,
            user_name,
            user_name_key,
            stay_type AS service_type,
            admission_type AS service_detail,
            1 AS identity_matched,
            'resident_daily_stays' AS source_table
        FROM resident_daily_stays
        UNION ALL
        SELECT DISTINCT
            usage_date,
            CASE
                WHEN matched_user_id <> '' THEN matched_user_id
                ELSE 'DAY:' || user_name_key
            END AS person_id,
            matched_user_id AS user_id,
            user_name,
            user_name_key,
            'day_service' AS service_type,
            '' AS service_detail,
            CASE WHEN matched_user_id <> '' THEN 1 ELSE 0 END AS identity_matched,
            'day_service_usage' AS source_table
        FROM day_service_usage;

        CREATE VIEW v_person_service_summary AS
        SELECT
            person_id,
            MAX(NULLIF(user_id, '')) AS user_id,
            MIN(user_name) AS representative_name,
            MIN(usage_date) AS first_seen_date,
            MAX(usage_date) AS last_seen_date,
            COUNT(DISTINCT usage_date) AS any_service_days,
            COUNT(DISTINCT CASE WHEN service_type = 'long_stay' THEN usage_date END)
                AS long_stay_days,
            COUNT(DISTINCT CASE WHEN service_type = 'short_stay' THEN usage_date END)
                AS short_stay_days,
            COUNT(DISTINCT CASE WHEN service_type = 'unknown_resident_stay' THEN usage_date END)
                AS unknown_resident_stay_days,
            COUNT(DISTINCT CASE WHEN service_type = 'day_service' THEN usage_date END)
                AS day_service_days
        FROM v_person_service_days
        GROUP BY person_id;

        CREATE VIEW v_long_stay_users_cross_service AS
        SELECT
            user_id,
            representative_name AS user_name,
            first_seen_date,
            last_seen_date,
            long_stay_days,
            short_stay_days,
            day_service_days,
            CASE WHEN short_stay_days > 0 THEN 1 ELSE 0 END AS has_short_stay,
            CASE WHEN day_service_days > 0 THEN 1 ELSE 0 END AS has_day_service,
            CASE
                WHEN short_stay_days > 0 AND day_service_days > 0 THEN 1
                ELSE 0
            END AS has_short_and_day_service
        FROM v_person_service_summary
        WHERE user_id IS NOT NULL
          AND long_stay_days > 0;

        CREATE VIEW v_long_stay_episode_service_context AS
        SELECT
            e.episode_id,
            e.user_id,
            e.user_name,
            e.admission_date AS long_admission_date,
            e.discharge_date AS long_discharge_date,
            e.last_seen_date AS long_last_seen_date,
            COUNT(DISTINCT CASE
                WHEN d.usage_date BETWEEN e.admission_date
                    AND COALESCE(NULLIF(e.discharge_date, ''), e.last_seen_date)
                THEN d.usage_date
            END) AS day_service_days_during_long,
            COUNT(DISTINCT CASE
                WHEN s.snapshot_date BETWEEN e.admission_date
                    AND COALESCE(NULLIF(e.discharge_date, ''), e.last_seen_date)
                THEN s.snapshot_date
            END) AS short_stay_days_during_long
        FROM resident_episodes AS e
        LEFT JOIN day_service_usage AS d
          ON d.matched_user_id = e.user_id
         AND d.match_status = 'matched'
        LEFT JOIN resident_daily_stays AS s
          ON s.user_id = e.user_id
         AND s.stay_type = 'short_stay'
        WHERE e.admission_type = '長期'
        GROUP BY
            e.episode_id, e.user_id, e.user_name,
            e.admission_date, e.discharge_date, e.last_seen_date;

        CREATE VIEW v_day_service_to_long_stay_transitions AS
        WITH day_users AS (
            SELECT
                matched_user_id AS user_id,
                MIN(user_name) AS user_name,
                MIN(usage_date) AS first_day_service_date,
                MAX(usage_date) AS last_day_service_date,
                COUNT(DISTINCT usage_date) AS day_service_days
            FROM day_service_usage
            WHERE match_status = 'matched'
            GROUP BY matched_user_id
        ),
        transition AS (
            SELECT
                d.user_id,
                MIN(e.admission_date) AS first_long_admission_after_day
            FROM day_users AS d
            JOIN resident_episodes AS e
              ON e.user_id = d.user_id
             AND e.admission_type = '長期'
             AND e.admission_date >= d.first_day_service_date
            GROUP BY d.user_id
        )
        SELECT
            d.user_id,
            COALESCE(i.user_name, d.user_name) AS user_name,
            d.first_day_service_date,
            d.last_day_service_date,
            d.day_service_days,
            t.first_long_admission_after_day AS long_admission_date,
            CAST(
                julianday(t.first_long_admission_after_day)
                - julianday(d.first_day_service_date)
                AS INTEGER
            ) AS days_from_first_day_service_to_long,
            (
                SELECT COUNT(DISTINCT usage_date)
                FROM day_service_usage AS du
                WHERE du.matched_user_id = d.user_id
                  AND du.match_status = 'matched'
                  AND t.first_long_admission_after_day IS NOT NULL
                  AND du.usage_date <= t.first_long_admission_after_day
            ) AS day_service_days_before_long
        FROM day_users AS d
        LEFT JOIN transition AS t USING (user_id)
        LEFT JOIN resident_identities AS i USING (user_id);

        CREATE VIEW v_short_stay_to_long_stay_transitions AS
        WITH short_users AS (
            SELECT
                user_id,
                MIN(user_name) AS user_name,
                MIN(snapshot_date) AS first_short_stay_date,
                MAX(snapshot_date) AS last_short_stay_date,
                COUNT(DISTINCT snapshot_date) AS short_stay_days
            FROM resident_daily_stays
            WHERE stay_type = 'short_stay'
            GROUP BY user_id
        ),
        transition AS (
            SELECT
                s.user_id,
                MIN(e.admission_date) AS first_long_admission_after_short
            FROM short_users AS s
            JOIN resident_episodes AS e
              ON e.user_id = s.user_id
             AND e.admission_type = '長期'
             AND e.admission_date >= s.first_short_stay_date
            GROUP BY s.user_id
        )
        SELECT
            s.user_id,
            s.user_name,
            s.first_short_stay_date,
            s.last_short_stay_date,
            s.short_stay_days,
            t.first_long_admission_after_short AS long_admission_date,
            CAST(
                julianday(t.first_long_admission_after_short)
                - julianday(s.first_short_stay_date)
                AS INTEGER
            ) AS days_from_first_short_stay_to_long
        FROM short_users AS s
        LEFT JOIN transition AS t USING (user_id);
        """
    )


def insert_metadata(
    conn: sqlite3.Connection,
    source_db: Path,
    day_service_csv: Path,
    daily_csv_dir: Path,
) -> None:
    metadata = {
        "source_resident_db": str(source_db),
        "source_day_service_csv": str(day_service_csv),
        "source_daily_csv_dir": str(daily_csv_dir),
        "built_for": "resident/day-service utilization analysis",
        "name_match_method": "NFKC normalized exact name key; ambiguous or unknown names are retained",
    }
    conn.executemany(
        "INSERT INTO analysis_metadata (key, value) VALUES (?, ?)",
        sorted(metadata.items()),
    )


def validate(conn: sqlite3.Connection) -> dict[str, int]:
    queries = {
        "resident_identities": "SELECT COUNT(*) FROM resident_identities",
        "resident_episodes": "SELECT COUNT(*) FROM resident_episodes",
        "resident_daily_stays": "SELECT COUNT(*) FROM resident_daily_stays",
        "day_service_usage": "SELECT COUNT(*) FROM day_service_usage",
        "matched_day_service_rows": (
            "SELECT COUNT(*) FROM day_service_usage WHERE match_status = 'matched'"
        ),
        "matched_day_service_names": (
            "SELECT COUNT(*) FROM day_service_name_matches WHERE match_status = 'matched'"
        ),
        "long_stay_users": "SELECT COUNT(*) FROM v_long_stay_users_cross_service",
        "day_to_long_transitions": (
            "SELECT COUNT(*) FROM v_day_service_to_long_stay_transitions "
            "WHERE long_admission_date IS NOT NULL"
        ),
    }
    return {
        key: int(conn.execute(sql).fetchone()[0])
        for key, sql in queries.items()
    }


def build_database(
    source_db: Path,
    day_service_csv: Path,
    daily_csv_dir: Path,
    output_db: Path,
) -> dict[str, int]:
    output_db.parent.mkdir(parents=True, exist_ok=True)
    if output_db.exists():
        output_db.unlink()

    observations = load_resident_name_observations(daily_csv_dir)
    identities = build_resident_identities(observations)

    with sqlite3.connect(output_db) as conn:
        conn.execute("PRAGMA journal_mode = DELETE")
        create_schema(conn)
        insert_identity_data(conn, observations, identities)
        import_resident_tables(conn, source_db)
        import_day_service_usage(conn, day_service_csv, identities)
        create_analysis_views(conn)
        insert_metadata(conn, source_db, day_service_csv, daily_csv_dir)
        stats = validate(conn)
        conn.execute("PRAGMA optimize")
        return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build an analysis-ready SQLite database for Arbos utilization."
    )
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB)
    parser.add_argument("--day-service-csv", type=Path, default=DEFAULT_DAY_SERVICE_CSV)
    parser.add_argument("--daily-csv-dir", type=Path, default=DEFAULT_DAILY_CSV_DIR)
    parser.add_argument("--output-db", type=Path, default=DEFAULT_OUTPUT_DB)
    args = parser.parse_args()

    stats = build_database(
        source_db=args.source_db,
        day_service_csv=args.day_service_csv,
        daily_csv_dir=args.daily_csv_dir,
        output_db=args.output_db,
    )
    print(f"output_db={args.output_db}")
    for key, value in stats.items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
