#!/usr/bin/env python3
"""Build a first ALBOS registry JSON from the existing analysis SQLite database.

This helper is not part of the browser runtime. The delivered application remains a
single offline HTML file and uses JSON for all operational persistence.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "data/db/arbos_analysis.sqlite3"
APP_ID = "arbos-user-registry"
APP_VERSION = "1.0.0"
JST = timezone(timedelta(hours=9))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the initial JSON for the offline ALBOS registry app."
    )
    parser.add_argument("--analysis-db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--dataset-id",
        default="arbos-main",
        help="Stable identifier for the operational JSON dataset.",
    )
    return parser.parse_args()


def rows(conn: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(query, params)]


def scalar(conn: sqlite3.Connection, query: str, default: Any = "") -> Any:
    row = conn.execute(query).fetchone()
    return row[0] if row and row[0] is not None else default


def clean(value: Any) -> str:
    return str(value or "").strip()


def app_user_id(patient_id: str) -> str:
    return f"patient:{patient_id}"


def date_minus(value: str, days: int) -> str:
    return (date.fromisoformat(value) - timedelta(days=days)).isoformat()


def build_users(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows(conn, "SELECT * FROM resident_users ORDER BY user_id"):
        patient_id = clean(row["user_id"])
        if not patient_id:
            continue
        result.append(
            {
                "userId": app_user_id(patient_id),
                "patientId": patient_id,
                "displayName": clean(row.get("user_name")) or f"患者ID {patient_id}",
                "kana": clean(row.get("kana_name")),
                "status": "archived" if int(row.get("followup_excluded") or 0) else "active",
                "primaryCounselor": "",
                "careManager": "",
                "careManagerOffice": "",
                "latestFloor": clean(row.get("latest_floor")),
                "threeFloorFit": "unconfirmed",
                "threeFloorConfirmedAt": "",
                "notes": clean(row.get("note")),
                "createdAt": "",
                "updatedAt": "",
            }
        )
    return result


def build_relations(conn: sqlite3.Connection, resident_max: str, day_max: str) -> list[dict[str, Any]]:
    service_rows = rows(
        conn,
        """
        SELECT user_id, service_type, MIN(usage_date) AS first_date,
               MAX(usage_date) AS last_date, COUNT(DISTINCT usage_date) AS usage_days
        FROM v_person_service_days
        WHERE COALESCE(user_id, '') <> ''
          AND service_type IN ('long_stay', 'short_stay', 'day_service')
        GROUP BY user_id, service_type
        ORDER BY user_id, service_type
        """,
    )
    current_long = {
        clean(row["user_id"])
        for row in rows(
            conn,
            """
            SELECT DISTINCT user_id FROM resident_episodes
            WHERE is_current = 1 AND (stay_type = 'long_stay' OR admission_type = '長期')
            """,
        )
    }
    mapping = {"long_stay": "long", "short_stay": "short", "day_service": "day"}
    result: list[dict[str, Any]] = []
    for row in service_rows:
        patient_id = clean(row["user_id"])
        service_id = mapping[row["service_type"]]
        last_date = clean(row["last_date"])
        if service_id == "long" and patient_id in current_long:
            status = "active"
        else:
            source_max = day_max if service_id == "day" else resident_max
            threshold_days = 90 if service_id == "day" else 180
            status = "active" if source_max and last_date >= date_minus(source_max, threshold_days) else "paused"
        result.append(
            {
                "relationId": f"relation:{patient_id}:{service_id}",
                "userId": app_user_id(patient_id),
                "serviceId": service_id,
                "status": status,
                "frequency": f"観測期間 {int(row['usage_days'] or 0)}日",
                "owner": "",
                "lastConfirmedDate": last_date,
                "note": "既存分析DBから初期作成。利用状態は職員確認が必要。",
                "updatedAt": "",
            }
        )
    return result


def build_events(conn: sqlite3.Connection) -> tuple[list[dict[str, Any]], int]:
    result: list[dict[str, Any]] = []
    for row in rows(conn, "SELECT * FROM resident_episodes ORDER BY admission_date, episode_id"):
        patient_id = clean(row["user_id"])
        if not patient_id:
            continue
        stay_type = clean(row.get("stay_type"))
        service_id = {"long_stay": "long", "short_stay": "short"}.get(stay_type, "other")
        note_parts = []
        if service_id == "other":
            note_parts.append("入所形態未確定")
        if clean(row.get("discharge_destination")) not in {"", "不明"}:
            note_parts.append(f"退所先: {clean(row['discharge_destination'])}")
        if clean(row.get("discharge_reason")) not in {"", "不明"}:
            note_parts.append(f"退所理由: {clean(row['discharge_reason'])}")
        result.append(
            {
                "eventId": f"resident:{clean(row['episode_id'])}",
                "userId": app_user_id(patient_id),
                "serviceId": service_id,
                "status": "actual",
                "startDate": clean(row.get("admission_date")),
                "endDate": clean(row.get("discharge_date")),
                "floor": clean(row.get("latest_floor") or row.get("admission_floor")),
                "source": "resident-csv",
                "note": " / ".join(note_parts),
                "createdAt": "",
            }
        )

    day_rows = rows(
        conn,
        """
        SELECT matched_user_id AS user_id, usage_date
        FROM day_service_usage
        WHERE match_status = 'matched' AND COALESCE(matched_user_id, '') <> ''
        GROUP BY matched_user_id, usage_date
        ORDER BY usage_date, matched_user_id
        """,
    )
    for row in day_rows:
        patient_id = clean(row["user_id"])
        usage_date = clean(row["usage_date"])
        result.append(
            {
                "eventId": f"day:{patient_id}:{usage_date}",
                "userId": app_user_id(patient_id),
                "serviceId": "day",
                "status": "actual",
                "startDate": usage_date,
                "endDate": "",
                "floor": "",
                "source": "day-service",
                "note": "",
                "createdAt": "",
            }
        )
    unmatched_people = int(
        scalar(
            conn,
            """
            SELECT COUNT(DISTINCT user_name_key) FROM day_service_usage
            WHERE match_status <> 'matched' OR COALESCE(matched_user_id, '') = ''
            """,
            0,
        )
    )
    return result, unmatched_people


def build_followups(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    priority_map = {"高": "high", "中": "medium", "低": "normal"}
    result: list[dict[str, Any]] = []
    for row in rows(
        conn,
        """
        SELECT * FROM resident_users
        WHERE followup_alert = 1 AND COALESCE(followup_excluded, 0) = 0
        ORDER BY next_expected_admission_date, user_id
        """,
    ):
        patient_id = clean(row["user_id"])
        due_date = clean(row.get("next_expected_admission_date"))
        result.append(
            {
                "taskId": f"followup:{patient_id}:{due_date or 'undated'}",
                "userId": app_user_id(patient_id),
                "category": "short-reactivation",
                "status": "todo",
                "priority": priority_map.get(clean(row.get("followup_priority")), "normal"),
                "owner": "",
                "dueDate": due_date,
                "reason": clean(row.get("followup_reason")) or "既存利用周期から確認候補",
                "nextAction": "現場情報を確認し、必要な次の対応を決める",
                "expectedBedDays": 0,
                "createdAt": "",
                "updatedAt": "",
                "closedAt": "",
            }
        )
    return result


def build_source_freshness(conn: sqlite3.Connection, unmatched_day_people: int) -> list[dict[str, Any]]:
    now = datetime.now(JST).isoformat(timespec="seconds")
    resident_max = clean(scalar(conn, "SELECT MAX(snapshot_date) FROM resident_daily_stays"))
    schedule_max = clean(scalar(conn, "SELECT MAX(scheduled_date) FROM floor_schedule_events"))
    day_max = clean(scalar(conn, "SELECT MAX(usage_date) FROM day_service_usage"))
    unmatched_schedule = int(
        scalar(
            conn,
            """
            SELECT COUNT(*) FROM floor_schedule_events
            WHERE match_status NOT IN ('matched_exact', 'matched_within_tolerance')
            """,
            0,
        )
    )
    schedule_events = int(scalar(conn, "SELECT COUNT(*) FROM floor_schedule_events", 0))
    return [
        {
            "sourceId": "resident",
            "label": "入所・在所データ",
            "latestDataDate": resident_max,
            "linkageStatus": "linked",
            "importedAt": now,
            "checkedAt": "",
            "note": "患者IDで連携",
        },
        {
            "sourceId": "schedule",
            "label": "入退所予定表",
            "latestDataDate": schedule_max,
            "linkageStatus": "partial" if schedule_events else "not-imported",
            "importedAt": now,
            "checkedAt": "",
            "note": (
                f"予定表{schedule_events}件はアプリの予定イベントへ未取込。未照合・要確認 {unmatched_schedule}件。"
                if schedule_events
                else "予定表データなし"
            ),
        },
        {
            "sourceId": "day-service",
            "label": "デイ利用実績",
            "latestDataDate": day_max,
            "linkageStatus": "partial" if unmatched_day_people else "linked",
            "importedAt": now,
            "checkedAt": "",
            "note": (
                f"患者ID未照合 {unmatched_day_people}名。患者IDを取得後に再作成が必要。"
                if unmatched_day_people
                else "患者IDで連携"
            ),
        },
    ]


def validate(payload: dict[str, Any]) -> None:
    user_ids = [row["userId"] for row in payload["users"]]
    patient_ids = [row["patientId"] for row in payload["users"]]
    if len(user_ids) != len(set(user_ids)):
        raise ValueError("userId is duplicated")
    if len(patient_ids) != len(set(patient_ids)):
        raise ValueError("patientId is duplicated")
    known_users = set(user_ids)
    known_services = {row["serviceId"] for row in payload["serviceCatalog"]}
    for key in ("serviceRelations", "serviceEvents", "followupTasks", "coordinationRecords"):
        for row in payload[key]:
            if row["userId"] not in known_users:
                raise ValueError(f"{key} has an unknown user reference: {row['userId']}")
    for row in payload["serviceRelations"] + payload["serviceEvents"]:
        if row["serviceId"] not in known_services:
            raise ValueError(f"Unknown service: {row['serviceId']}")


def main() -> None:
    args = parse_args()
    if not args.analysis_db.exists():
        raise SystemExit(f"Analysis DB not found: {args.analysis_db}")
    if args.output.exists():
        raise SystemExit(
            f"Output already exists; choose a new path because this initial builder never overwrites files: {args.output}"
        )
    with sqlite3.connect(args.analysis_db) as conn:
        conn.row_factory = sqlite3.Row
        resident_max = clean(scalar(conn, "SELECT MAX(snapshot_date) FROM resident_daily_stays"))
        day_max = clean(scalar(conn, "SELECT MAX(usage_date) FROM day_service_usage"))
        users = build_users(conn)
        events, unmatched_day_people = build_events(conn)
        payload = {
            "schemaVersion": 1,
            "appId": APP_ID,
            "appVersion": APP_VERSION,
            "datasetId": args.dataset_id,
            "revision": 0,
            "previousRevision": None,
            "savedAt": "",
            "savedBy": "",
            "isDemoData": False,
            "users": users,
            "serviceCatalog": [
                {"serviceId": "long", "label": "ロング", "sortOrder": 10, "active": True},
                {"serviceId": "short", "label": "ショート", "sortOrder": 20, "active": True},
                {"serviceId": "day", "label": "デイ", "sortOrder": 30, "active": True},
                {"serviceId": "other", "label": "その他", "sortOrder": 90, "active": True},
            ],
            "serviceRelations": build_relations(conn, resident_max, day_max),
            "serviceEvents": events,
            "followupTasks": build_followups(conn),
            "coordinationRecords": [],
            "sourceFreshness": build_source_freshness(conn, unmatched_day_people),
            "changeLogs": [
                {
                    "logId": "initial-import",
                    "at": datetime.now(JST).isoformat(timespec="seconds"),
                    "operator": "初期JSON作成スクリプト",
                    "action": "initial-import",
                    "entityType": "dataset",
                    "entityId": args.dataset_id,
                    "userId": "",
                    "summary": "既存分析DBから初期JSONを作成",
                }
            ],
            "settings": {"timelineMonths": 24, "archiveYears": 5},
        }
    validate(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with args.output.open("x", encoding="utf-8") as output_file:
            output_file.write(json.dumps(payload, ensure_ascii=False, indent=2))
    except FileExistsError as error:
        raise SystemExit(
            f"Output was created by another process; no file was overwritten: {args.output}"
        ) from error
    print(
        json.dumps(
            {
                "output": str(args.output),
                "users": len(payload["users"]),
                "relations": len(payload["serviceRelations"]),
                "events": len(payload["serviceEvents"]),
                "followups": len(payload["followupTasks"]),
                "day_service_people_without_patient_id": unmatched_day_people,
                "resident_data_max": resident_max,
                "day_service_data_max": day_max,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
