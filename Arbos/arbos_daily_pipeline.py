#!/usr/bin/env python3
"""Build an admission-episode database from daily Arbos resident CSV files."""

from __future__ import annotations

import argparse
import csv
import os
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable


CSV_COLUMNS = {
    "patient_id": "患者ID",
    "admission_date": "入院日",
    "room": "部屋",
    "bed": "Bed",
    "admission_type": "形態",
    "planned_discharge_date": "退院予定日",
    "counselor": "相談員",
}

MANUAL_FIELDS = [
    "source_type",
    "source_name",
    "discharge_destination",
    "discharge_reason",
    "memo",
]

EPISODE_COLUMNS = [
    "episode_id",
    "user_id",
    "admission_date",
    "discharge_date",
    "last_seen_date",
    "first_absent_date",
    "is_current",
    "admission_floor",
    "latest_floor",
    "room",
    "bed",
    "admission_type",
    "source_type",
    "source_name",
    "discharge_destination",
    "discharge_reason",
    "stay_days",
    "admission_sequence",
    "readmission_flag",
    "previous_discharge_date",
    "days_to_readmission",
    "memo",
]

USER_COLUMNS = [
    "user_id",
    "note",
    "latest_status",
    "total_episodes",
    "completed_episodes",
    "is_current",
    "current_episode_id",
    "latest_admission_date",
    "latest_discharge_date",
    "latest_seen_date",
    "latest_floor",
    "latest_admission_type",
    "average_stay_days",
    "readmission_interval_count",
    "average_readmission_interval_days",
    "estimated_usage_cycle_days",
    "next_expected_admission_date",
    "days_until_expected_admission",
    "followup_alert",
    "followup_priority",
    "followup_category",
    "followup_excluded",
    "exclusion_reason",
    "exclusion_detail",
    "followup_window_start",
    "followup_window_end",
    "followup_reason",
]

CONTACT_ALERT_COLUMNS = [
    "user_id",
    "next_expected_admission_date",
    "days_until_expected_admission",
    "followup_priority",
    "followup_category",
    "followup_reason",
    "latest_discharge_date",
    "latest_admission_date",
    "latest_floor",
    "latest_admission_type",
    "total_episodes",
    "average_readmission_interval_days",
    "average_stay_days",
]

USER_LIST_V1_COLUMNS = [
    "利用者ID",
    "最新状態",
    "最新入所日",
    "最新退所日",
    "最新確認日",
    "最新フロア",
    "最新入所形態",
    "退所先",
    "退所理由",
    "除外理由",
    "利用回数",
    "退所済み回数",
    "平均利用日数",
    "平均再利用周期",
    "次回想定入所日",
    "次回想定日まで",
    "声かけ優先度",
    "声かけ区分",
    "声かけ理由",
]

EXCLUDED_USER_COLUMNS = [
    "user_id",
    "exclusion_reason",
    "exclusion_detail",
    "latest_discharge_date",
    "latest_admission_date",
    "latest_floor",
    "latest_admission_type",
    "discharge_destination",
    "discharge_reason",
    "total_episodes",
]

DEFAULT_FLOOR_CAPACITY = [
    {"floor": "2F", "capacity": 54},
    {"floor": "3F", "capacity": 36},
    {"floor": "ユニット", "capacity": 10},
]
LEGACY_DATA_START_DATE = date(2025, 4, 1)
LONG_OVERDUE_DAYS = 60


@dataclass(frozen=True)
class Observation:
    snapshot_date: date
    user_id: str
    admission_date: date
    room: str
    bed: str
    admission_type: str
    latest_floor: str
    planned_discharge_date: str = ""
    counselor: str = ""


@dataclass
class Episode:
    episode_id: str
    user_id: str
    admission_date: date
    discharge_date: date | None
    last_seen_date: date
    first_absent_date: date | None
    is_current: bool
    admission_floor: str
    latest_floor: str
    room: str
    bed: str
    admission_type: str
    source_type: str = "不明"
    source_name: str = ""
    discharge_destination: str = "不明"
    discharge_reason: str = "不明"
    stay_days: int = 0
    admission_sequence: int = 1
    readmission_flag: bool = False
    previous_discharge_date: date | None = None
    days_to_readmission: int | None = None
    memo: str = ""
    first_seen_date: date = field(default_factory=date.today)


@dataclass(frozen=True)
class UserProfile:
    user_id: str
    latest_status: str
    total_episodes: int
    completed_episodes: int
    is_current: bool
    current_episode_id: str
    latest_admission_date: date
    latest_discharge_date: date | None
    latest_seen_date: date
    latest_floor: str
    latest_admission_type: str
    average_stay_days: int
    readmission_interval_count: int
    average_readmission_interval_days: int | None
    estimated_usage_cycle_days: int | None
    next_expected_admission_date: date | None
    days_until_expected_admission: int | None
    followup_alert: bool
    followup_priority: str
    followup_category: str
    followup_excluded: bool
    exclusion_reason: str
    exclusion_detail: str
    followup_window_start: date
    followup_window_end: date
    followup_reason: str
    note: str = ""


def parse_date(value: str) -> date | None:
    """Extract a date from values such as 2026/05/31, 2026-05-31, or 2026/05/31(確)."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"(\d{4})\s*(?:/|-|年)\s*(\d{1,2})\s*(?:/|-|月)\s*(\d{1,2})", text)
    if not match:
        match = re.search(r"(\d{4})(\d{2})(\d{2})", text)
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    return date(year, month, day)


def extract_snapshot_date(path: Path) -> date:
    parsed = parse_date(path.stem)
    if parsed:
        return parsed
    raise ValueError(f"ファイル名から日付を取得できません: {path.name}")


def floor_from_room(room: str) -> str:
    text = str(room or "").strip().upper()
    if re.match(r"^2\d{2}", text):
        return "2F"
    if re.match(r"^3\d{2}", text):
        return "3F"
    if text.startswith("U-") or text.startswith("Ｕ-"):
        return "ユニット"
    return "不明"


def normalize_header(row: dict[str, str]) -> dict[str, str]:
    return {str(key).strip(): (value or "").strip() for key, value in row.items() if key is not None}


def read_text_with_fallback(path: Path) -> str:
    errors: list[str] = []
    for encoding in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            errors.append(f"{encoding}: {exc}")
    raise UnicodeDecodeError("csv", b"", 0, 1, f"CSV文字コードを判定できません: {path} / {errors}")


def read_daily_csv(path: Path) -> list[Observation]:
    snapshot_date = extract_snapshot_date(path)
    content = read_text_with_fallback(path)
    reader = csv.DictReader(content.splitlines())
    observations: list[Observation] = []

    for raw_row in reader:
        row = normalize_header(raw_row)
        user_id = row.get(CSV_COLUMNS["patient_id"], "").strip()
        admission_date = parse_date(row.get(CSV_COLUMNS["admission_date"], ""))
        if not user_id or not admission_date:
            continue

        room = row.get(CSV_COLUMNS["room"], "")
        observations.append(
            Observation(
                snapshot_date=snapshot_date,
                user_id=user_id,
                admission_date=admission_date,
                room=room,
                bed=row.get(CSV_COLUMNS["bed"], ""),
                admission_type=row.get(CSV_COLUMNS["admission_type"], ""),
                latest_floor=floor_from_room(room),
                planned_discharge_date=format_optional_date(
                    parse_date(row.get(CSV_COLUMNS["planned_discharge_date"], ""))
                ),
                counselor=row.get(CSV_COLUMNS["counselor"], ""),
            )
        )
    return observations


def make_episode_id(user_id: str, admission_date: date, used_ids: set[str]) -> str:
    base = f"E_{user_id}_{admission_date:%Y%m%d}"
    if base not in used_ids:
        used_ids.add(base)
        return base
    number = 2
    while f"{base}_{number}" in used_ids:
        number += 1
    episode_id = f"{base}_{number}"
    used_ids.add(episode_id)
    return episode_id


def update_episode_from_observation(episode: Episode, observation: Observation) -> None:
    episode.last_seen_date = observation.snapshot_date
    episode.is_current = True
    episode.latest_floor = observation.latest_floor
    episode.room = observation.room
    episode.bed = observation.bed
    episode.admission_type = observation.admission_type
    episode.discharge_date = None
    episode.first_absent_date = None


def build_episodes(csv_paths: Iterable[Path]) -> tuple[list[Episode], list[Observation], date]:
    observations_by_date: dict[date, list[Observation]] = {}
    for path in csv_paths:
        for observation in read_daily_csv(path):
            observations_by_date.setdefault(observation.snapshot_date, []).append(observation)

    if not observations_by_date:
        raise ValueError("取り込めるCSV行がありません。患者IDと入院日を確認してください。")

    episodes: list[Episode] = []
    active_by_user: dict[str, Episode] = {}
    used_ids: set[str] = set()
    all_observations: list[Observation] = []

    for snapshot_date in sorted(observations_by_date):
        daily_observations = dedupe_daily_observations(observations_by_date[snapshot_date])
        all_observations.extend(daily_observations)
        seen_users = {observation.user_id for observation in daily_observations}

        for observation in daily_observations:
            active_episode = active_by_user.get(observation.user_id)
            if active_episode and active_episode.admission_date == observation.admission_date:
                update_episode_from_observation(active_episode, observation)
                continue

            if active_episode and active_episode.admission_date != observation.admission_date:
                close_episode(active_episode, snapshot_date)
                active_by_user.pop(observation.user_id, None)

            episode = Episode(
                episode_id=make_episode_id(observation.user_id, observation.admission_date, used_ids),
                user_id=observation.user_id,
                admission_date=observation.admission_date,
                discharge_date=None,
                last_seen_date=observation.snapshot_date,
                first_absent_date=None,
                is_current=True,
                admission_floor=observation.latest_floor,
                latest_floor=observation.latest_floor,
                room=observation.room,
                bed=observation.bed,
                admission_type=observation.admission_type,
                first_seen_date=observation.snapshot_date,
            )
            episodes.append(episode)
            active_by_user[observation.user_id] = episode

        for user_id, episode in list(active_by_user.items()):
            if user_id not in seen_users:
                close_episode(episode, snapshot_date)
                active_by_user.pop(user_id, None)

    latest_snapshot_date = max(observations_by_date)
    derive_episode_fields(episodes, latest_snapshot_date)
    return episodes, all_observations, latest_snapshot_date


def dedupe_daily_observations(observations: list[Observation]) -> list[Observation]:
    deduped: dict[tuple[str, date], Observation] = {}
    for observation in observations:
        deduped[(observation.user_id, observation.admission_date)] = observation
    return list(deduped.values())


def close_episode(episode: Episode, first_absent_date: date) -> None:
    episode.is_current = False
    episode.first_absent_date = first_absent_date
    episode.discharge_date = episode.last_seen_date


def derive_episode_fields(episodes: list[Episode], latest_snapshot_date: date) -> None:
    by_user: dict[str, list[Episode]] = {}
    for episode in episodes:
        by_user.setdefault(episode.user_id, []).append(episode)

    for user_episodes in by_user.values():
        user_episodes.sort(key=lambda item: (item.admission_date, item.first_seen_date, item.episode_id))
        previous: Episode | None = None
        for index, episode in enumerate(user_episodes, start=1):
            episode.admission_sequence = index
            episode.readmission_flag = index >= 2
            episode.previous_discharge_date = previous.discharge_date if previous else None
            if episode.previous_discharge_date:
                episode.days_to_readmission = (episode.admission_date - episode.previous_discharge_date).days
            else:
                episode.days_to_readmission = None

            end_date = episode.discharge_date or latest_snapshot_date
            episode.stay_days = max((end_date - episode.admission_date).days + 1, 1)
            previous = episode


def load_existing_manual_fields(db_path: Path) -> dict[str, dict[str, str]]:
    if not db_path.exists():
        return {}
    with sqlite3.connect(db_path) as conn:
        if not table_exists(conn, "episodes"):
            return {}
        columns = [row[1] for row in conn.execute("PRAGMA table_info(episodes)")]
        required = ["episode_id", *MANUAL_FIELDS]
        if not all(column in columns for column in required):
            return {}
        fields: dict[str, dict[str, str]] = {}
        for row in conn.execute(
            f"SELECT {', '.join(required)} FROM episodes"
        ):
            episode_id = row[0]
            fields[episode_id] = {
                field: row[index + 1] or "" for index, field in enumerate(MANUAL_FIELDS)
            }
        return fields


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def load_manual_csv(path: Path | None) -> dict[str, dict[str, str]]:
    if not path:
        return {}
    content = read_text_with_fallback(path)
    reader = csv.DictReader(content.splitlines())
    manual: dict[str, dict[str, str]] = {}
    for raw_row in reader:
        row = normalize_header(raw_row)
        episode_id = row.get("episode_id") or row.get("エピソードID")
        if not episode_id:
            continue
        manual[episode_id] = {field: row.get(field, "") for field in MANUAL_FIELDS}
    return manual


def apply_manual_fields(episodes: list[Episode], manual_fields: dict[str, dict[str, str]]) -> None:
    for episode in episodes:
        values = manual_fields.get(episode.episode_id)
        if not values:
            continue
        for field_name in MANUAL_FIELDS:
            value = values.get(field_name)
            if value:
                setattr(episode, field_name, value)


def load_schedule_discharge_fields(db_path: Path) -> dict[tuple[str, str, str], dict[str, str]]:
    if not db_path.exists():
        return {}
    with sqlite3.connect(db_path) as conn:
        if not table_exists(conn, "floor_schedule_events"):
            return {}
        columns = {row[1] for row in conn.execute("PRAGMA table_info(floor_schedule_events)")}
        required = {
            "movement_type",
            "scheduled_date",
            "matched_user_id",
            "matched_segment_start",
            "matched_segment_end",
            "match_status",
            "discharge_destination",
            "discharge_reason",
            "followup_exclusion_reason",
        }
        if not required.issubset(columns):
            return {}
        rows = conn.execute(
            """
            SELECT matched_user_id, matched_segment_start, matched_segment_end,
                   scheduled_date, discharge_destination, discharge_reason,
                   followup_exclusion_reason, match_status
            FROM floor_schedule_events
            WHERE movement_type = 'floor_out'
              AND matched_user_id <> ''
              AND matched_segment_start <> ''
              AND matched_segment_end <> ''
              AND (discharge_destination <> '' OR discharge_reason <> '')
            """
        ).fetchall()

    fields: dict[tuple[str, str, str], dict[str, str]] = {}
    scores: dict[tuple[str, str, str], tuple[int, str]] = {}
    for (
        user_id,
        segment_start,
        segment_end,
        scheduled_date,
        destination,
        reason,
        exclusion_reason,
        match_status,
    ) in rows:
        key = (user_id, segment_start, segment_end)
        score = schedule_discharge_score(
            destination=destination or "",
            reason=reason or "",
            exclusion_reason=exclusion_reason or "",
            match_status=match_status or "",
        )
        previous = scores.get(key)
        if previous and (score, scheduled_date) <= previous:
            continue
        scores[key] = (score, scheduled_date)
        fields[key] = {
            "discharge_destination": destination or "",
            "discharge_reason": reason or "",
        }
    return fields


def schedule_discharge_score(
    *,
    destination: str,
    reason: str,
    exclusion_reason: str,
    match_status: str,
) -> int:
    score = 0
    if destination:
        score += 1
    if reason:
        score += 2
    if match_status.startswith("matched"):
        score += 2
    if reason in {"死亡退所", "施設退所"} or exclusion_reason:
        score += 10
    return score


def apply_schedule_discharge_fields(
    episodes: list[Episode],
    schedule_fields: dict[tuple[str, str, str], dict[str, str]],
) -> int:
    legacy_schedule_fields = build_legacy_schedule_discharge_index(schedule_fields)
    updated = 0
    for episode in episodes:
        if not episode.discharge_date:
            continue
        key = (
            episode.user_id,
            format_date(episode.admission_date),
            format_date(episode.discharge_date),
        )
        values = schedule_fields.get(key)
        if not values and episode.admission_date < LEGACY_DATA_START_DATE:
            values = legacy_schedule_fields.get((episode.user_id, format_date(episode.discharge_date)))
        if not values:
            continue

        changed = False
        destination = values.get("discharge_destination", "")
        reason = values.get("discharge_reason", "")
        if destination and should_fill_discharge_field(episode.discharge_destination):
            episode.discharge_destination = destination
            changed = True
        if reason and should_fill_discharge_field(episode.discharge_reason):
            episode.discharge_reason = reason
            changed = True
        if changed:
            updated += 1
    return updated


def build_legacy_schedule_discharge_index(
    schedule_fields: dict[tuple[str, str, str], dict[str, str]],
) -> dict[tuple[str, str], dict[str, str]]:
    indexed: dict[tuple[str, str], dict[str, str]] = {}
    scores: dict[tuple[str, str], int] = {}
    for (user_id, _segment_start, segment_end), values in schedule_fields.items():
        key = (user_id, segment_end)
        score = schedule_field_score(values)
        if key in scores and score <= scores[key]:
            continue
        scores[key] = score
        indexed[key] = values
    return indexed


def schedule_field_score(values: dict[str, str]) -> int:
    score = 0
    if values.get("discharge_destination"):
        score += 1
    if values.get("discharge_reason"):
        score += 2
    if values.get("discharge_reason") in {"死亡退所", "施設退所"}:
        score += 10
    return score


def should_fill_discharge_field(value: str) -> bool:
    return not value or value == "不明"


def build_user_profiles(
    episodes: list[Episode],
    *,
    as_of_date: date,
    alert_days: int = 30,
) -> list[UserProfile]:
    by_user: dict[str, list[Episode]] = {}
    for episode in episodes:
        by_user.setdefault(episode.user_id, []).append(episode)

    window_end = as_of_date + timedelta(days=alert_days)
    profiles: list[UserProfile] = []
    for user_id, user_episodes in by_user.items():
        ordered = sorted(user_episodes, key=lambda item: (item.admission_date, item.first_seen_date, item.episode_id))
        latest = ordered[-1]
        current = next((episode for episode in reversed(ordered) if episode.is_current), None)
        intervals = [
            episode.days_to_readmission
            for episode in ordered
            if episode.days_to_readmission is not None and episode.days_to_readmission >= 0
        ]
        average_interval = round(sum(intervals) / len(intervals)) if intervals else None
        average_stay = round(sum(episode.stay_days for episode in ordered) / len(ordered))

        next_expected_admission_date: date | None = None
        days_until_expected: int | None = None
        if not latest.is_current and latest.discharge_date and average_interval is not None:
            next_expected_admission_date = latest.discharge_date + timedelta(days=average_interval)
            days_until_expected = (next_expected_admission_date - as_of_date).days

        exclusion_reason, exclusion_detail = followup_exclusion(latest)
        followup_excluded = bool(exclusion_reason)
        latest_status = latest_status_for_profile(latest, followup_excluded)
        followup_category = followup_category_from_days(
            days_until_expected,
            is_current=latest.is_current,
            excluded=followup_excluded,
            next_expected_admission_date=next_expected_admission_date,
            window_end=window_end,
            alert_days=alert_days,
        )
        followup_alert = followup_category.startswith("今後") or followup_category == "直近超過1-59日"
        followup_priority = followup_priority_from_days(days_until_expected) if followup_alert else ""
        if followup_category == "60日以上超過":
            followup_priority = "別枠"
        followup_reason = (
            build_followup_reason(days_until_expected, average_interval)
            if followup_alert or followup_category == "60日以上超過"
            else ""
        )

        profiles.append(
            UserProfile(
                user_id=user_id,
                latest_status=latest_status,
                total_episodes=len(ordered),
                completed_episodes=sum(1 for episode in ordered if not episode.is_current),
                is_current=current is not None,
                current_episode_id=current.episode_id if current else "",
                latest_admission_date=latest.admission_date,
                latest_discharge_date=latest.discharge_date,
                latest_seen_date=latest.last_seen_date,
                latest_floor=latest.latest_floor,
                latest_admission_type=latest.admission_type,
                average_stay_days=average_stay,
                readmission_interval_count=len(intervals),
                average_readmission_interval_days=average_interval,
                estimated_usage_cycle_days=average_interval,
                next_expected_admission_date=next_expected_admission_date,
                days_until_expected_admission=days_until_expected,
                followup_alert=followup_alert,
                followup_priority=followup_priority,
                followup_category=followup_category,
                followup_excluded=followup_excluded,
                exclusion_reason=exclusion_reason,
                exclusion_detail=exclusion_detail,
                followup_window_start=as_of_date,
                followup_window_end=window_end,
                followup_reason=followup_reason,
            )
        )
    return sorted(profiles, key=lambda item: item.user_id)


def followup_exclusion(episode: Episode) -> tuple[str, str]:
    if episode.is_current:
        return "", ""
    destination = episode.discharge_destination or ""
    reason = episode.discharge_reason or ""
    text = f"{destination} {reason}"
    if "死亡" in text:
        return "死亡退院", compact_reason_detail(destination, reason)
    facility_keywords = ("施設", "特養", "有料", "老健", "サ高住", "グループホーム", "GH")
    if any(keyword in text for keyword in facility_keywords):
        return "施設退所", compact_reason_detail(destination, reason)
    return "", ""


def latest_status_for_profile(episode: Episode, excluded: bool) -> str:
    if episode.is_current:
        return "利用中"
    if excluded:
        return "除外"
    return "退所済"


def followup_category_from_days(
    days_until_expected: int | None,
    *,
    is_current: bool,
    excluded: bool,
    next_expected_admission_date: date | None,
    window_end: date,
    alert_days: int,
) -> str:
    if is_current:
        return "利用中"
    if excluded:
        return "対象外"
    if next_expected_admission_date is None or days_until_expected is None:
        return "周期不足"
    if days_until_expected <= -LONG_OVERDUE_DAYS:
        return "60日以上超過"
    if days_until_expected < 0:
        return "直近超過1-59日"
    if next_expected_admission_date <= window_end:
        return f"今後{alert_days}日以内"
    return "対象外"


def compact_reason_detail(destination: str, reason: str) -> str:
    values = [value for value in (destination, reason) if value and value != "不明"]
    return " / ".join(values)


def followup_priority_from_days(days_until_expected: int | None) -> str:
    if days_until_expected is None:
        return ""
    if days_until_expected <= 7:
        return "高"
    if days_until_expected <= 14:
        return "中"
    return "低"


def build_followup_reason(days_until_expected: int | None, average_interval: int | None) -> str:
    if days_until_expected is None or average_interval is None:
        return ""
    cycle_text = f"平均{average_interval}日周期"
    if days_until_expected < 0:
        return f"{cycle_text}の想定再利用日を{abs(days_until_expected)}日超過"
    if days_until_expected == 0:
        return f"{cycle_text}の想定再利用日が今日"
    return f"{cycle_text}の想定再利用日まで{days_until_expected}日"


def load_floor_capacity(path: Path | None) -> list[dict[str, int | str]]:
    if not path:
        return DEFAULT_FLOOR_CAPACITY
    content = read_text_with_fallback(path)
    reader = csv.DictReader(content.splitlines())
    capacities: list[dict[str, int | str]] = []
    for raw_row in reader:
        row = normalize_header(raw_row)
        floor = row.get("floor") or row.get("フロア")
        capacity = row.get("capacity") or row.get("定員")
        if not floor or capacity in (None, ""):
            continue
        capacities.append({"floor": floor, "capacity": int(float(str(capacity)))})
    return capacities


def write_database(
    db_path: Path,
    episodes: list[Episode],
    observations: list[Observation],
    floor_capacity: list[dict[str, int | str]],
    user_profiles: list[UserProfile],
) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            """
            DROP TABLE IF EXISTS daily_residents;
            DROP TABLE IF EXISTS contact_alerts;
            DROP TABLE IF EXISTS long_overdue_followups;
            DROP TABLE IF EXISTS excluded_users;
            DROP TABLE IF EXISTS floor_capacity;
            DROP TABLE IF EXISTS episodes;
            DROP TABLE IF EXISTS users;

            CREATE TABLE users (
                user_id TEXT PRIMARY KEY,
                note TEXT NOT NULL DEFAULT '',
                latest_status TEXT NOT NULL,
                total_episodes INTEGER NOT NULL,
                completed_episodes INTEGER NOT NULL,
                is_current INTEGER NOT NULL,
                current_episode_id TEXT NOT NULL,
                latest_admission_date TEXT NOT NULL,
                latest_discharge_date TEXT,
                latest_seen_date TEXT NOT NULL,
                latest_floor TEXT NOT NULL,
                latest_admission_type TEXT NOT NULL,
                average_stay_days INTEGER NOT NULL,
                readmission_interval_count INTEGER NOT NULL,
                average_readmission_interval_days INTEGER,
                estimated_usage_cycle_days INTEGER,
                next_expected_admission_date TEXT,
                days_until_expected_admission INTEGER,
                followup_alert INTEGER NOT NULL,
                followup_priority TEXT NOT NULL,
                followup_category TEXT NOT NULL,
                followup_excluded INTEGER NOT NULL,
                exclusion_reason TEXT NOT NULL,
                exclusion_detail TEXT NOT NULL,
                followup_window_start TEXT NOT NULL,
                followup_window_end TEXT NOT NULL,
                followup_reason TEXT NOT NULL
            );

            CREATE TABLE episodes (
                episode_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                admission_date TEXT NOT NULL,
                discharge_date TEXT,
                last_seen_date TEXT NOT NULL,
                first_absent_date TEXT,
                is_current INTEGER NOT NULL,
                admission_floor TEXT NOT NULL,
                latest_floor TEXT NOT NULL,
                room TEXT NOT NULL,
                bed TEXT NOT NULL,
                admission_type TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_name TEXT NOT NULL,
                discharge_destination TEXT NOT NULL,
                discharge_reason TEXT NOT NULL,
                stay_days INTEGER NOT NULL,
                admission_sequence INTEGER NOT NULL,
                readmission_flag INTEGER NOT NULL,
                previous_discharge_date TEXT,
                days_to_readmission INTEGER,
                memo TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );

            CREATE TABLE floor_capacity (
                floor TEXT PRIMARY KEY,
                capacity INTEGER NOT NULL
            );

            CREATE TABLE daily_residents (
                snapshot_date TEXT NOT NULL,
                user_id TEXT NOT NULL,
                admission_date TEXT NOT NULL,
                room TEXT NOT NULL,
                bed TEXT NOT NULL,
                floor TEXT NOT NULL,
                admission_type TEXT NOT NULL,
                PRIMARY KEY (snapshot_date, user_id, admission_date)
            );

            CREATE TABLE contact_alerts (
                user_id TEXT PRIMARY KEY,
                next_expected_admission_date TEXT NOT NULL,
                days_until_expected_admission INTEGER NOT NULL,
                followup_priority TEXT NOT NULL,
                followup_category TEXT NOT NULL,
                followup_reason TEXT NOT NULL,
                latest_discharge_date TEXT,
                latest_admission_date TEXT NOT NULL,
                latest_floor TEXT NOT NULL,
                latest_admission_type TEXT NOT NULL,
                total_episodes INTEGER NOT NULL,
                average_readmission_interval_days INTEGER NOT NULL,
                average_stay_days INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );

            CREATE TABLE long_overdue_followups (
                user_id TEXT PRIMARY KEY,
                next_expected_admission_date TEXT NOT NULL,
                days_until_expected_admission INTEGER NOT NULL,
                followup_priority TEXT NOT NULL,
                followup_category TEXT NOT NULL,
                followup_reason TEXT NOT NULL,
                latest_discharge_date TEXT,
                latest_admission_date TEXT NOT NULL,
                latest_floor TEXT NOT NULL,
                latest_admission_type TEXT NOT NULL,
                total_episodes INTEGER NOT NULL,
                average_readmission_interval_days INTEGER NOT NULL,
                average_stay_days INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );

            CREATE TABLE excluded_users (
                user_id TEXT PRIMARY KEY,
                exclusion_reason TEXT NOT NULL,
                exclusion_detail TEXT NOT NULL,
                latest_discharge_date TEXT,
                latest_admission_date TEXT NOT NULL,
                latest_floor TEXT NOT NULL,
                latest_admission_type TEXT NOT NULL,
                discharge_destination TEXT NOT NULL,
                discharge_reason TEXT NOT NULL,
                total_episodes INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
            """
        )

        conn.executemany(
            """
            INSERT INTO users (
                user_id, note, latest_status, total_episodes, completed_episodes, is_current,
                current_episode_id, latest_admission_date, latest_discharge_date,
                latest_seen_date, latest_floor, latest_admission_type,
                average_stay_days, readmission_interval_count,
                average_readmission_interval_days, estimated_usage_cycle_days,
                next_expected_admission_date, days_until_expected_admission,
                followup_alert, followup_priority, followup_category, followup_excluded,
                exclusion_reason, exclusion_detail, followup_window_start,
                followup_window_end, followup_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [user_profile_to_tuple(profile) for profile in user_profiles],
        )
        conn.executemany(
            """
            INSERT INTO episodes (
                episode_id, user_id, admission_date, discharge_date, last_seen_date,
                first_absent_date, is_current, admission_floor, latest_floor, room,
                bed, admission_type, source_type, source_name, discharge_destination,
                discharge_reason, stay_days, admission_sequence, readmission_flag,
                previous_discharge_date, days_to_readmission, memo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [episode_to_tuple(episode) for episode in episodes],
        )
        conn.executemany(
            "INSERT INTO floor_capacity (floor, capacity) VALUES (?, ?)",
            [(row["floor"], row["capacity"]) for row in floor_capacity],
        )
        conn.executemany(
            """
            INSERT INTO daily_residents (
                snapshot_date, user_id, admission_date, room, bed, floor, admission_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    format_date(observation.snapshot_date),
                    observation.user_id,
                    format_date(observation.admission_date),
                    observation.room,
                    observation.bed,
                    observation.latest_floor,
                    observation.admission_type,
                )
                for observation in observations
            ],
        )
        conn.executemany(
            """
            INSERT INTO contact_alerts (
                user_id, next_expected_admission_date, days_until_expected_admission,
                followup_priority, followup_category, followup_reason, latest_discharge_date,
                latest_admission_date, latest_floor, latest_admission_type,
                total_episodes, average_readmission_interval_days, average_stay_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [contact_alert_to_tuple(profile) for profile in user_profiles if profile.followup_alert],
        )
        conn.executemany(
            """
            INSERT INTO long_overdue_followups (
                user_id, next_expected_admission_date, days_until_expected_admission,
                followup_priority, followup_category, followup_reason, latest_discharge_date,
                latest_admission_date, latest_floor, latest_admission_type,
                total_episodes, average_readmission_interval_days, average_stay_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                contact_alert_to_tuple(profile)
                for profile in user_profiles
                if profile.followup_category == "60日以上超過"
            ],
        )
        conn.executemany(
            """
            INSERT INTO excluded_users (
                user_id, exclusion_reason, exclusion_detail, latest_discharge_date,
                latest_admission_date, latest_floor, latest_admission_type,
                discharge_destination, discharge_reason, total_episodes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [excluded_user_to_tuple(profile, episodes) for profile in user_profiles if profile.followup_excluded],
        )
        conn.commit()


def episode_to_tuple(episode: Episode) -> tuple[object, ...]:
    return (
        episode.episode_id,
        episode.user_id,
        format_date(episode.admission_date),
        format_optional_date(episode.discharge_date),
        format_date(episode.last_seen_date),
        format_optional_date(episode.first_absent_date),
        int(episode.is_current),
        episode.admission_floor,
        episode.latest_floor,
        episode.room,
        episode.bed,
        episode.admission_type,
        episode.source_type or "不明",
        episode.source_name,
        episode.discharge_destination or "不明",
        episode.discharge_reason or "不明",
        episode.stay_days,
        episode.admission_sequence,
        int(episode.readmission_flag),
        format_optional_date(episode.previous_discharge_date),
        episode.days_to_readmission,
        episode.memo,
    )


def export_outputs(
    output_dir: Path,
    episodes: list[Episode],
    floor_capacity: list[dict[str, int | str]],
    db_path: Path,
    user_profiles: list[UserProfile],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / "episodes.csv", EPISODE_COLUMNS, [episode_to_dict(ep) for ep in episodes])
    write_csv(
        output_dir / "users.csv",
        USER_COLUMNS,
        [user_profile_to_dict(profile) for profile in user_profiles],
    )
    write_csv(
        output_dir / "user_list_v1.csv",
        USER_LIST_V1_COLUMNS,
        [user_profile_to_user_list_v1_dict(profile, episodes) for profile in user_profiles],
    )
    write_csv(
        output_dir / "contact_alerts_next_month.csv",
        CONTACT_ALERT_COLUMNS,
        [contact_alert_to_dict(profile) for profile in user_profiles if profile.followup_alert],
    )
    write_csv(
        output_dir / "long_overdue_followup_candidates.csv",
        CONTACT_ALERT_COLUMNS,
        [
            contact_alert_to_dict(profile)
            for profile in user_profiles
            if profile.followup_category == "60日以上超過"
        ],
    )
    write_csv(
        output_dir / "excluded_users.csv",
        EXCLUDED_USER_COLUMNS,
        [excluded_user_to_dict(profile, episodes) for profile in user_profiles if profile.followup_excluded],
    )
    write_csv(output_dir / "floor_capacity.csv", ["floor", "capacity"], floor_capacity)
    write_csv(
        output_dir / "manual_entry_template.csv",
        ["episode_id", "user_id", "admission_date", *MANUAL_FIELDS],
        [
            {
                "episode_id": ep.episode_id,
                "user_id": ep.user_id,
                "admission_date": format_date(ep.admission_date),
                **{field_name: getattr(ep, field_name) for field_name in MANUAL_FIELDS},
            }
            for ep in episodes
        ],
    )
    write_csv(
        output_dir / "readmissions.csv",
        EPISODE_COLUMNS,
        [episode_to_dict(ep) for ep in episodes if ep.readmission_flag],
    )
    export_sqlite_query(
        db_path,
        output_dir / "monthly_admissions_discharges.csv",
        """
        WITH months AS (
            SELECT substr(admission_date, 1, 7) AS month FROM episodes
            UNION
            SELECT substr(discharge_date, 1, 7) AS month
            FROM episodes
            WHERE discharge_date IS NOT NULL AND discharge_date <> ''
        ),
        admissions AS (
            SELECT substr(admission_date, 1, 7) AS month, count(*) AS admission_count
            FROM episodes GROUP BY substr(admission_date, 1, 7)
        ),
        discharges AS (
            SELECT substr(discharge_date, 1, 7) AS month, count(*) AS discharge_count
            FROM episodes
            WHERE discharge_date IS NOT NULL AND discharge_date <> ''
            GROUP BY substr(discharge_date, 1, 7)
        )
        SELECT months.month,
               coalesce(admissions.admission_count, 0) AS admission_count,
               coalesce(discharges.discharge_count, 0) AS discharge_count
        FROM months
        LEFT JOIN admissions USING (month)
        LEFT JOIN discharges USING (month)
        ORDER BY months.month
        """,
    )
    export_sqlite_query(
        db_path,
        output_dir / "daily_floor_occupancy.csv",
        """
        SELECT r.snapshot_date,
               r.floor,
               count(*) AS resident_count,
               count(DISTINCT r.room || ':' || r.bed) AS occupied_bed_count,
               coalesce(c.capacity, 0) AS capacity,
               CASE
                   WHEN coalesce(c.capacity, 0) > 0
                   THEN round(count(*) * 1.0 / c.capacity, 4)
                   ELSE NULL
               END AS utilization_rate
        FROM daily_residents r
        LEFT JOIN floor_capacity c ON c.floor = r.floor
        GROUP BY r.snapshot_date, r.floor
        ORDER BY r.snapshot_date, r.floor
        """,
    )


def episode_to_dict(episode: Episode) -> dict[str, object]:
    return {
        "episode_id": episode.episode_id,
        "user_id": episode.user_id,
        "admission_date": format_date(episode.admission_date),
        "discharge_date": format_optional_date(episode.discharge_date),
        "last_seen_date": format_date(episode.last_seen_date),
        "first_absent_date": format_optional_date(episode.first_absent_date),
        "is_current": str(episode.is_current).lower(),
        "admission_floor": episode.admission_floor,
        "latest_floor": episode.latest_floor,
        "room": episode.room,
        "bed": episode.bed,
        "admission_type": episode.admission_type,
        "source_type": episode.source_type,
        "source_name": episode.source_name,
        "discharge_destination": episode.discharge_destination,
        "discharge_reason": episode.discharge_reason,
        "stay_days": episode.stay_days,
        "admission_sequence": episode.admission_sequence,
        "readmission_flag": str(episode.readmission_flag).lower(),
        "previous_discharge_date": format_optional_date(episode.previous_discharge_date),
        "days_to_readmission": episode.days_to_readmission if episode.days_to_readmission is not None else "",
        "memo": episode.memo,
    }


def user_profile_to_tuple(profile: UserProfile) -> tuple[object, ...]:
    return (
        profile.user_id,
        profile.note,
        profile.latest_status,
        profile.total_episodes,
        profile.completed_episodes,
        int(profile.is_current),
        profile.current_episode_id,
        format_date(profile.latest_admission_date),
        format_optional_date(profile.latest_discharge_date),
        format_date(profile.latest_seen_date),
        profile.latest_floor,
        profile.latest_admission_type,
        profile.average_stay_days,
        profile.readmission_interval_count,
        profile.average_readmission_interval_days,
        profile.estimated_usage_cycle_days,
        format_optional_date(profile.next_expected_admission_date),
        profile.days_until_expected_admission,
        int(profile.followup_alert),
        profile.followup_priority,
        profile.followup_category,
        int(profile.followup_excluded),
        profile.exclusion_reason,
        profile.exclusion_detail,
        format_date(profile.followup_window_start),
        format_date(profile.followup_window_end),
        profile.followup_reason,
    )


def contact_alert_to_tuple(profile: UserProfile) -> tuple[object, ...]:
    return (
        profile.user_id,
        format_date(profile.next_expected_admission_date),  # type: ignore[arg-type]
        profile.days_until_expected_admission,
        profile.followup_priority,
        profile.followup_category,
        profile.followup_reason,
        format_optional_date(profile.latest_discharge_date),
        format_date(profile.latest_admission_date),
        profile.latest_floor,
        profile.latest_admission_type,
        profile.total_episodes,
        profile.average_readmission_interval_days,
        profile.average_stay_days,
    )


def excluded_user_to_tuple(profile: UserProfile, episodes: list[Episode]) -> tuple[object, ...]:
    latest = latest_episode_for_profile(profile, episodes)
    return (
        profile.user_id,
        profile.exclusion_reason,
        profile.exclusion_detail,
        format_optional_date(profile.latest_discharge_date),
        format_date(profile.latest_admission_date),
        profile.latest_floor,
        profile.latest_admission_type,
        latest.discharge_destination,
        latest.discharge_reason,
        profile.total_episodes,
    )


def user_profile_to_dict(profile: UserProfile) -> dict[str, object]:
    return {
        "user_id": profile.user_id,
        "note": profile.note,
        "latest_status": profile.latest_status,
        "total_episodes": profile.total_episodes,
        "completed_episodes": profile.completed_episodes,
        "is_current": str(profile.is_current).lower(),
        "current_episode_id": profile.current_episode_id,
        "latest_admission_date": format_date(profile.latest_admission_date),
        "latest_discharge_date": format_optional_date(profile.latest_discharge_date),
        "latest_seen_date": format_date(profile.latest_seen_date),
        "latest_floor": profile.latest_floor,
        "latest_admission_type": profile.latest_admission_type,
        "average_stay_days": profile.average_stay_days,
        "readmission_interval_count": profile.readmission_interval_count,
        "average_readmission_interval_days": profile.average_readmission_interval_days
        if profile.average_readmission_interval_days is not None
        else "",
        "estimated_usage_cycle_days": profile.estimated_usage_cycle_days
        if profile.estimated_usage_cycle_days is not None
        else "",
        "next_expected_admission_date": format_optional_date(profile.next_expected_admission_date),
        "days_until_expected_admission": profile.days_until_expected_admission
        if profile.days_until_expected_admission is not None
        else "",
        "followup_alert": str(profile.followup_alert).lower(),
        "followup_priority": profile.followup_priority,
        "followup_category": profile.followup_category,
        "followup_excluded": str(profile.followup_excluded).lower(),
        "exclusion_reason": profile.exclusion_reason,
        "exclusion_detail": profile.exclusion_detail,
        "followup_window_start": format_date(profile.followup_window_start),
        "followup_window_end": format_date(profile.followup_window_end),
        "followup_reason": profile.followup_reason,
    }


def user_profile_to_user_list_v1_dict(profile: UserProfile, episodes: list[Episode]) -> dict[str, object]:
    latest = latest_episode_for_profile(profile, episodes)
    return {
        "利用者ID": profile.user_id,
        "最新状態": profile.latest_status,
        "最新入所日": format_date(profile.latest_admission_date),
        "最新退所日": format_optional_date(profile.latest_discharge_date),
        "最新確認日": format_date(profile.latest_seen_date),
        "最新フロア": profile.latest_floor,
        "最新入所形態": profile.latest_admission_type,
        "退所先": latest.discharge_destination,
        "退所理由": latest.discharge_reason,
        "除外理由": profile.exclusion_reason,
        "利用回数": profile.total_episodes,
        "退所済み回数": profile.completed_episodes,
        "平均利用日数": profile.average_stay_days,
        "平均再利用周期": profile.average_readmission_interval_days
        if profile.average_readmission_interval_days is not None
        else "",
        "次回想定入所日": format_optional_date(profile.next_expected_admission_date),
        "次回想定日まで": profile.days_until_expected_admission
        if profile.days_until_expected_admission is not None
        else "",
        "声かけ優先度": profile.followup_priority,
        "声かけ区分": profile.followup_category,
        "声かけ理由": profile.followup_reason,
    }


def contact_alert_to_dict(profile: UserProfile) -> dict[str, object]:
    return {
        "user_id": profile.user_id,
        "next_expected_admission_date": format_optional_date(profile.next_expected_admission_date),
        "days_until_expected_admission": profile.days_until_expected_admission
        if profile.days_until_expected_admission is not None
        else "",
        "followup_priority": profile.followup_priority,
        "followup_category": profile.followup_category,
        "followup_reason": profile.followup_reason,
        "latest_discharge_date": format_optional_date(profile.latest_discharge_date),
        "latest_admission_date": format_date(profile.latest_admission_date),
        "latest_floor": profile.latest_floor,
        "latest_admission_type": profile.latest_admission_type,
        "total_episodes": profile.total_episodes,
        "average_readmission_interval_days": profile.average_readmission_interval_days
        if profile.average_readmission_interval_days is not None
        else "",
        "average_stay_days": profile.average_stay_days,
    }


def excluded_user_to_dict(profile: UserProfile, episodes: list[Episode]) -> dict[str, object]:
    latest = latest_episode_for_profile(profile, episodes)
    return {
        "user_id": profile.user_id,
        "exclusion_reason": profile.exclusion_reason,
        "exclusion_detail": profile.exclusion_detail,
        "latest_discharge_date": format_optional_date(profile.latest_discharge_date),
        "latest_admission_date": format_date(profile.latest_admission_date),
        "latest_floor": profile.latest_floor,
        "latest_admission_type": profile.latest_admission_type,
        "discharge_destination": latest.discharge_destination,
        "discharge_reason": latest.discharge_reason,
        "total_episodes": profile.total_episodes,
    }


def latest_episode_for_profile(profile: UserProfile, episodes: list[Episode]) -> Episode:
    user_episodes = [episode for episode in episodes if episode.user_id == profile.user_id]
    return sorted(user_episodes, key=lambda item: (item.admission_date, item.first_seen_date, item.episode_id))[-1]


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def export_sqlite_query(db_path: Path, output_path: Path, query: str) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query).fetchall()
    fieldnames = list(rows[0].keys()) if rows else []
    if not fieldnames:
        output_path.write_text("", encoding="utf-8-sig")
        return
    write_csv(output_path, fieldnames, [dict(row) for row in rows])


def format_date(value: date) -> str:
    return value.isoformat()


def format_optional_date(value: date | None) -> str:
    return value.isoformat() if value else ""


def find_csv_files(input_dir: Path, pattern: str) -> list[Path]:
    paths = sorted(path for path in input_dir.glob(pattern) if path.is_file())
    if not paths:
        raise FileNotFoundError(f"CSVが見つかりません: {input_dir}/{pattern}")
    return paths


def run_build(args: argparse.Namespace) -> None:
    input_dir = Path(args.input_dir)
    db_path = Path(args.db)
    csv_paths = find_csv_files(input_dir, args.pattern)
    episodes, observations, latest_snapshot_date = build_episodes(csv_paths)

    manual_fields = load_existing_manual_fields(db_path)
    manual_fields.update(load_manual_csv(Path(args.manual_csv) if args.manual_csv else None))
    apply_manual_fields(episodes, manual_fields)
    schedule_discharge_count = apply_schedule_discharge_fields(
        episodes,
        load_schedule_discharge_fields(db_path),
    )

    floor_capacity = load_floor_capacity(Path(args.floor_capacity) if args.floor_capacity else None)
    as_of_date = parse_date(args.as_of) if args.as_of else latest_snapshot_date
    if as_of_date is None:
        raise ValueError(f"基準日を解釈できません: {args.as_of}")
    if args.alert_days < 1:
        raise ValueError("--alert-days は1以上で指定してください")
    user_profiles = build_user_profiles(episodes, as_of_date=as_of_date, alert_days=args.alert_days)

    write_database(db_path, episodes, observations, floor_capacity, user_profiles)
    export_outputs(Path(args.output_dir), episodes, floor_capacity, db_path, user_profiles)

    print(f"取り込みCSV数: {len(csv_paths)}")
    print(f"最終スナップショット日: {latest_snapshot_date}")
    print(f"利用者数: {len({episode.user_id for episode in episodes})}")
    print(f"エピソード数: {len(episodes)}")
    print(f"現在入所中: {sum(1 for episode in episodes if episode.is_current)}")
    print(f"退所済み: {sum(1 for episode in episodes if not episode.is_current)}")
    print(f"再入所エピソード: {sum(1 for episode in episodes if episode.readmission_flag)}")
    print(f"予定表退所情報反映: {schedule_discharge_count}")
    print(f"声かけ候補: {sum(1 for profile in user_profiles if profile.followup_alert)}")
    print(
        "60日以上超過別枠: "
        f"{sum(1 for profile in user_profiles if profile.followup_category == '60日以上超過')}"
    )
    print(f"声かけ判定期間: {as_of_date} から {as_of_date + timedelta(days=args.alert_days)}")
    print(f"SQLite DB: {db_path}")
    print(f"出力CSV: {Path(args.output_dir)}")


def run_init_floor_capacity(args: argparse.Namespace) -> None:
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_csv(path, ["floor", "capacity"], DEFAULT_FLOOR_CAPACITY)
    print(f"フロア定員CSVを作成しました: {path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="毎日CSVから利用率分析用の入所エピソードDBを作成します。"
    )
    subparsers = parser.add_subparsers(dest="command")

    build = subparsers.add_parser("build", help="CSVフォルダからSQLite DBと分析用CSVを作成")
    build.add_argument("--input-dir", required=True, help="毎日CSVを置いたフォルダ")
    build.add_argument("--pattern", default="**/*.csv", help="取り込むCSVファイル名パターン")
    build.add_argument("--db", default="data/db/arbos_episodes.sqlite3", help="出力SQLite DB")
    build.add_argument("--output-dir", default="data/processed", help="分析用CSVの出力フォルダ")
    build.add_argument("--manual-csv", help="手入力列を上書きするCSV")
    build.add_argument("--floor-capacity", help="フロア定員CSV。未指定なら2F=40, 3F=40, ユニット=20")
    build.add_argument("--as-of", help="声かけ判定の基準日。未指定なら最新CSV日")
    build.add_argument("--alert-days", type=int, default=30, help="基準日から何日先まで声かけ候補に含めるか")
    build.set_defaults(func=run_build)

    init_floor = subparsers.add_parser("init-floor-capacity", help="フロア定員CSVのひな形を作成")
    init_floor.add_argument("--output", default="data/processed/floor_capacity.csv")
    init_floor.set_defaults(func=run_init_floor_capacity)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    try:
        args.func(args)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=os.sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
