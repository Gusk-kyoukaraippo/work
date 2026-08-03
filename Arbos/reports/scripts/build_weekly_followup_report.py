#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import sqlite3
from datetime import timedelta
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
ANALYSIS_DB = ROOT / "data/db/arbos_analysis.sqlite3"
EPISODES_DB = ROOT / "data/db/arbos_episodes.sqlite3"
METRICS_JSON = ROOT / "reports/outputs/utilization_strategy_20260609/arbos_utilization_strategy_metrics.json"
OUTPUT_ROOT = ROOT / "reports/outputs"

HARD_EXCLUDE_WORDS = [
    "死亡",
    "逝去",
    "看取り",
    "特養",
    "老健入所",
    "グループホーム",
    "利用終了",
    "受入不可",
    "苦情",
]

CAUTION_WORDS = [
    "転院",
    "入院",
    "病院",
    "医療",
    "状態不安定",
    "不明",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build weekly customer follow-up report.")
    parser.add_argument("--as-of", required=True, help="Report date in YYYY-MM-DD.")
    parser.add_argument("--top-n", type=int, default=20, help="Rows for weekly_priority_followup.csv.")
    return parser.parse_args()


def connect(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


def read_sql(db_path: Path, query: str) -> pd.DataFrame:
    with connect(db_path) as con:
        return pd.read_sql_query(query, con)


def table_counts(db_path: Path) -> dict[str, int]:
    with connect(db_path) as con:
        names = [
            row["name"]
            for row in con.execute(
                "select name from sqlite_master where type in ('table','view') order by name"
            )
        ]
        counts: dict[str, int] = {}
        for name in names:
            try:
                counts[name] = int(con.execute(f'select count(*) from "{name}"').fetchone()[0])
            except sqlite3.Error:
                counts[name] = -1
        return counts


def to_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series.replace("", pd.NA), errors="coerce")


def clean_str(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def first_nonempty(values: pd.Series) -> str:
    for value in values:
        text = clean_str(value)
        if text:
            return text
    return ""


def make_person_id(user_id: Any, name_key: Any, prefix: str) -> str:
    uid = clean_str(user_id)
    if uid:
        return uid
    key = clean_str(name_key)
    if key:
        return f"{prefix}:{key}"
    return f"{prefix}:unknown"


def date_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return pd.Timestamp(value).strftime("%Y-%m-%d")


def bool_yes(value: bool) -> str:
    return "__YES__" if bool(value) else "__NO__"


def contains_any(text: str, words: list[str]) -> bool:
    return any(word in text for word in words if word)


def load_metrics() -> dict[str, Any]:
    if METRICS_JSON.exists():
        return json.loads(METRICS_JSON.read_text(encoding="utf-8"))
    return {}


def max_csv_schedule_date() -> tuple[str, list[str]]:
    max_dates: list[pd.Timestamp] = []
    files = sorted(ROOT.glob("data/processed/*schedule_events*.csv"))
    used_files: list[str] = []
    for path in files:
        try:
            sample = pd.read_csv(path, nrows=5)
            date_col = next((col for col in ["scheduled_date", "date", "日付"] if col in sample.columns), None)
            if not date_col:
                continue
            df = pd.read_csv(path, usecols=[date_col])
            dates = pd.to_datetime(df[date_col].replace("", pd.NA), errors="coerce")
            if dates.notna().any():
                max_dates.append(dates.max())
                used_files.append(str(path.relative_to(ROOT)))
        except Exception:
            used_files.append(f"{path.relative_to(ROOT)} (日付読取失敗)")
    if not max_dates:
        return "", used_files
    return pd.Series(max_dates).max().strftime("%Y-%m-%d"), used_files


def prepare_short_episodes(schedule: pd.DataFrame) -> pd.DataFrame:
    if schedule.empty:
        return pd.DataFrame()
    df = schedule.copy()
    df["form"] = df["form"].fillna("")
    df = df[df["form"].str.contains("ショート|短期", na=False)].copy()
    if df.empty:
        return pd.DataFrame()

    df["person_id"] = [
        make_person_id(uid, key, "schedule")
        for uid, key in zip(df.get("matched_user_id", ""), df.get("person_name_key", ""))
    ]
    df["scheduled_dt"] = to_date(df["scheduled_date"])
    df["segment_start_dt"] = to_date(df.get("matched_segment_start", pd.Series("", index=df.index)))
    df["segment_end_dt"] = to_date(df.get("matched_segment_end", pd.Series("", index=df.index)))

    matched = df[df["segment_start_dt"].notna()].copy()
    episodes: list[dict[str, Any]] = []
    if not matched.empty:
        group_cols = ["person_id", "segment_start_dt", "segment_end_dt"]
        for keys, group in matched.groupby(group_cols, dropna=False):
            person_id, start_dt, end_dt = keys
            outs = group[group["movement_type"].eq("floor_out")]
            out_exists = not outs.empty
            out_row = outs.iloc[-1] if out_exists else group.iloc[-1]
            episodes.append(
                {
                    "person_id": person_id,
                    "user_name": first_nonempty(group["person_name"]),
                    "short_start_date": start_dt,
                    "short_end_date": end_dt if out_exists and pd.notna(end_dt) else pd.NaT,
                    "latest_possible_end_date": end_dt,
                    "floor": first_nonempty(group["service_area"]),
                    "discharge_destination": clean_str(out_row.get("discharge_destination", "")),
                    "discharge_reason": clean_str(out_row.get("discharge_reason", "")),
                    "followup_exclusion_reason": clean_str(out_row.get("followup_exclusion_reason", "")),
                    "is_confirmed_discharge": bool(out_exists and pd.notna(end_dt)),
                    "source": "floor_schedule_events.matched_segment",
                }
            )

    unmatched = df[df["segment_start_dt"].isna()].copy()
    if not unmatched.empty:
        for person_id, group in unmatched.groupby("person_id"):
            group = group.sort_values("scheduled_dt")
            open_start: pd.Timestamp | None = None
            open_floor = ""
            open_name = first_nonempty(group["person_name"])
            for _, row in group.iterrows():
                movement = clean_str(row.get("movement_type"))
                if movement == "floor_in":
                    open_start = row["scheduled_dt"]
                    open_floor = clean_str(row.get("service_area"))
                elif movement == "floor_out" and open_start is not None:
                    episodes.append(
                        {
                            "person_id": person_id,
                            "user_name": open_name,
                            "short_start_date": open_start,
                            "short_end_date": row["scheduled_dt"],
                            "latest_possible_end_date": row["scheduled_dt"],
                            "floor": clean_str(row.get("service_area")) or open_floor,
                            "discharge_destination": clean_str(row.get("discharge_destination", "")),
                            "discharge_reason": clean_str(row.get("discharge_reason", "")),
                            "followup_exclusion_reason": clean_str(row.get("followup_exclusion_reason", "")),
                            "is_confirmed_discharge": True,
                            "source": "floor_schedule_events.paired",
                        }
                    )
                    open_start = None
                    open_floor = ""

    result = pd.DataFrame(episodes)
    if result.empty:
        return result
    result = result.drop_duplicates(
        subset=["person_id", "short_start_date", "short_end_date", "floor", "is_confirmed_discharge"]
    )
    result["los"] = (
        (result["short_end_date"] - result["short_start_date"]).dt.days + 1
    ).where(result["is_confirmed_discharge"], pd.NA)
    return result


def aggregate_master(as_of: pd.Timestamp, data: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame]:
    users = data["resident_users"].copy()
    service_summary = data["service_summary"].copy()
    service_days = data["service_days"].copy()
    day_usage = data["day_usage"].copy()
    resident_episodes = data["resident_episodes"].copy()
    schedule = data["schedule"].copy()
    excluded_users = data["excluded_users"].copy()

    user_rows: dict[str, dict[str, Any]] = {}

    def ensure_person(person_id: str) -> dict[str, Any]:
        return user_rows.setdefault(person_id, {"user_id": person_id, "user_name": ""})

    for _, row in users.iterrows():
        person_id = clean_str(row["user_id"])
        if not person_id:
            continue
        item = ensure_person(person_id)
        item.update(
            {
                "user_name": clean_str(row.get("user_name")) or item.get("user_name", ""),
                "latest_floor": clean_str(row.get("latest_floor")),
                "resident_latest_status": clean_str(row.get("latest_status")),
                "resident_followup_excluded": int(row.get("followup_excluded") or 0),
                "resident_exclusion_reason": clean_str(row.get("exclusion_reason")),
                "resident_exclusion_detail": clean_str(row.get("exclusion_detail")),
            }
        )

    for _, row in service_summary.iterrows():
        person_id = make_person_id(row.get("user_id"), row.get("representative_name"), "service")
        item = ensure_person(person_id)
        if not item.get("user_name"):
            item["user_name"] = clean_str(row.get("representative_name"))
        item["short_days_total"] = int(row.get("short_stay_days") or 0)
        item["day_service_days_total"] = int(row.get("day_service_days") or 0)
        item["long_stay_days_total"] = int(row.get("long_stay_days") or 0)

    for _, row in day_usage.iterrows():
        person_id = make_person_id(row.get("matched_user_id"), row.get("user_name_key"), "day")
        item = ensure_person(person_id)
        if not item.get("user_name"):
            item["user_name"] = clean_str(row.get("user_name"))

    short_episodes = prepare_short_episodes(schedule)
    for _, row in short_episodes.iterrows():
        item = ensure_person(clean_str(row["person_id"]))
        if not item.get("user_name"):
            item["user_name"] = clean_str(row.get("user_name"))

    for _, row in excluded_users.iterrows():
        item = ensure_person(clean_str(row["user_id"]))
        item["excluded_users_reason"] = clean_str(row.get("exclusion_reason"))
        item["excluded_users_detail"] = clean_str(row.get("exclusion_detail"))

    master = pd.DataFrame(user_rows.values())
    if master.empty:
        return master, short_episodes

    for col in [
        "short_days_total",
        "day_service_days_total",
        "long_stay_days_total",
        "resident_followup_excluded",
    ]:
        if col not in master.columns:
            master[col] = 0
    for col in [
        "latest_floor",
        "resident_latest_status",
        "resident_exclusion_reason",
        "resident_exclusion_detail",
        "excluded_users_reason",
        "excluded_users_detail",
    ]:
        if col not in master.columns:
            master[col] = ""

    if not short_episodes.empty:
        confirmed = short_episodes[short_episodes["is_confirmed_discharge"]].copy()
        if not confirmed.empty:
            latest = confirmed.sort_values("short_end_date").groupby("person_id").tail(1)
            master = master.merge(
                latest[
                    [
                        "person_id",
                        "short_start_date",
                        "short_end_date",
                        "floor",
                        "discharge_destination",
                        "discharge_reason",
                    ]
                ].rename(
                    columns={
                        "person_id": "user_id",
                        "short_start_date": "latest_short_start_date",
                        "short_end_date": "latest_short_end_date",
                        "floor": "latest_short_floor",
                        "discharge_destination": "latest_discharge_destination",
                        "discharge_reason": "latest_discharge_reason",
                    }
                ),
                on="user_id",
                how="left",
            )
            stats = confirmed.groupby("person_id").agg(
                short_episodes_total=("short_start_date", "count"),
                median_short_los=("los", "median"),
            )
            master = master.merge(stats, left_on="user_id", right_index=True, how="left")
            recent_start = as_of - timedelta(days=364)
            recent = confirmed[confirmed["short_start_date"].ge(recent_start)]
            recent_stats = recent.groupby("person_id").agg(short_episodes_365=("short_start_date", "count"))
            master = master.merge(recent_stats, left_on="user_id", right_index=True, how="left")

            three_f = confirmed[confirmed["floor"].eq("3F")].groupby("person_id").size()
            master = master.merge(
                three_f.rename("has_3f_history_count"),
                left_on="user_id",
                right_index=True,
                how="left",
            )

        open_short = short_episodes[~short_episodes["is_confirmed_discharge"]].copy()
        if not open_short.empty:
            latest_open = open_short.sort_values("short_start_date").groupby("person_id").tail(1)
            master = master.merge(
                latest_open[["person_id", "short_start_date", "latest_possible_end_date"]].rename(
                    columns={
                        "person_id": "user_id",
                        "short_start_date": "open_short_start_date",
                        "latest_possible_end_date": "open_short_latest_possible_end_date",
                    }
                ),
                on="user_id",
                how="left",
            )

    for col in ["short_episodes_total", "short_episodes_365", "median_short_los", "has_3f_history_count"]:
        if col not in master.columns:
            master[col] = 0
    for col in [
        "latest_short_start_date",
        "latest_short_end_date",
        "latest_short_floor",
        "latest_discharge_destination",
        "latest_discharge_reason",
        "open_short_start_date",
        "open_short_latest_possible_end_date",
    ]:
        if col not in master.columns:
            master[col] = pd.NA if "date" in col else ""

    service_days["usage_dt"] = to_date(service_days["usage_date"])
    service_days["person_key"] = [
        make_person_id(uid, name, "service")
        for uid, name in zip(service_days.get("user_id", ""), service_days.get("user_name", ""))
    ]
    recent_365 = service_days[
        service_days["usage_dt"].between(as_of - timedelta(days=364), as_of)
        & service_days["service_type"].eq("short_stay")
    ]
    if not recent_365.empty:
        days365 = recent_365.groupby("person_key")["usage_dt"].nunique()
        master = master.merge(days365.rename("short_days_365"), left_on="user_id", right_index=True, how="left")
    if "short_days_365" not in master.columns:
        master["short_days_365"] = 0

    day_usage["usage_dt"] = to_date(day_usage["usage_date"])
    day_usage["person_key"] = [
        make_person_id(uid, key, "day")
        for uid, key in zip(day_usage.get("matched_user_id", ""), day_usage.get("user_name_key", ""))
    ]
    for days, col in [(90, "day_service_days_90"), (180, "day_service_days_180")]:
        recent_day = day_usage[day_usage["usage_dt"].between(as_of - timedelta(days=days - 1), as_of)]
        counts = recent_day.groupby("person_key")["usage_dt"].nunique()
        master = master.merge(counts.rename(col), left_on="user_id", right_index=True, how="left")
    for col in ["day_service_days_90", "day_service_days_180"]:
        if col not in master.columns:
            master[col] = 0

    long_mask = resident_episodes["stay_type"].eq("long_stay") | resident_episodes["admission_type"].fillna("").str.contains(
        "長期|ロング|入所", na=False
    )
    long_eps = resident_episodes[long_mask].copy()
    if not long_eps.empty:
        long_eps["admission_dt"] = to_date(long_eps["admission_date"])
        latest_long = long_eps.sort_values("admission_dt").groupby("user_id").tail(1)
        current_long = long_eps[long_eps["is_current"].fillna(0).astype(int).eq(1)].groupby("user_id").size()
        master = master.merge(
            latest_long[["user_id", "admission_dt"]].rename(columns={"admission_dt": "latest_long_start_date"}),
            on="user_id",
            how="left",
        )
        master = master.merge(current_long.rename("current_long_count"), left_on="user_id", right_index=True, how="left")
    if "latest_long_start_date" not in master.columns:
        master["latest_long_start_date"] = pd.NaT
    if "current_long_count" not in master.columns:
        master["current_long_count"] = 0

    future = schedule.copy()
    future["scheduled_dt"] = to_date(future["scheduled_date"])
    future = future[future["scheduled_dt"].gt(as_of) & future["movement_type"].eq("floor_in")]
    if not future.empty:
        future["person_id"] = [
            make_person_id(uid, key, "schedule")
            for uid, key in zip(future.get("matched_user_id", ""), future.get("person_name_key", ""))
        ]
        future_first = future.sort_values("scheduled_dt").groupby("person_id").head(1)
        master = master.merge(
            future_first[["person_id", "scheduled_dt", "form"]].rename(
                columns={"person_id": "user_id", "scheduled_dt": "future_booking_date", "form": "future_booking_type"}
            ),
            on="user_id",
            how="left",
        )
    if "future_booking_date" not in master.columns:
        master["future_booking_date"] = pd.NaT
    if "future_booking_type" not in master.columns:
        master["future_booking_type"] = ""

    fill_zero = [
        "short_days_total",
        "short_days_365",
        "short_episodes_total",
        "short_episodes_365",
        "median_short_los",
        "has_3f_history_count",
        "day_service_days_90",
        "day_service_days_180",
        "day_service_days_total",
        "long_stay_days_total",
        "current_long_count",
    ]
    for col in fill_zero:
        master[col] = pd.to_numeric(master[col], errors="coerce").fillna(0)

    master["latest_short_start_date"] = to_date(master["latest_short_start_date"])
    master["latest_short_end_date"] = to_date(master["latest_short_end_date"])
    master["latest_long_start_date"] = to_date(master["latest_long_start_date"])
    master["future_booking_date"] = to_date(master["future_booking_date"])
    master["days_since_latest_short_end"] = (as_of - master["latest_short_end_date"]).dt.days
    master["has_long_history"] = master["latest_long_start_date"].notna() | master["long_stay_days_total"].gt(0)
    master["is_currently_long"] = master["current_long_count"].gt(0) | (
        master["resident_latest_status"].eq("利用中") & master["latest_long_start_date"].notna()
    )
    master["has_3f_history"] = master["has_3f_history_count"].gt(0) | master["latest_floor"].eq("3F")
    master["has_day_service_history"] = master["day_service_days_total"].gt(0) | master["day_service_days_180"].gt(0)
    master["has_future_booking"] = master["future_booking_date"].notna()

    exclusion_text = (
        master["latest_discharge_destination"].fillna("")
        + " / "
        + master["latest_discharge_reason"].fillna("")
        + " / "
        + master["resident_exclusion_reason"].fillna("")
        + " / "
        + master["resident_exclusion_detail"].fillna("")
        + " / "
        + master["excluded_users_reason"].fillna("")
        + " / "
        + master["excluded_users_detail"].fillna("")
    )
    master["hard_exclude_reason"] = ""
    hard_by_text = exclusion_text.apply(lambda x: contains_any(x, HARD_EXCLUDE_WORDS))
    hard_by_existing = master["resident_followup_excluded"].fillna(0).astype(int).gt(0) | master["excluded_users_reason"].fillna("").ne("")
    master.loc[hard_by_text, "hard_exclude_reason"] = "死亡・施設入所・利用終了等の除外語を検出"
    master.loc[hard_by_existing & master["hard_exclude_reason"].eq(""), "hard_exclude_reason"] = "既存excluded_usersまたは既存followup_excluded"
    master.loc[master["is_currently_long"], "hard_exclude_reason"] = "長期入所中"
    master["hard_exclude_flag"] = master["hard_exclude_reason"].ne("")

    caution_by_text = exclusion_text.apply(lambda x: contains_any(x, CAUTION_WORDS))
    master["caution_reason"] = ""
    master.loc[caution_by_text & ~master["hard_exclude_flag"], "caution_reason"] = "入院・医療・不明等の注意語を検出"
    master["caution_flag"] = master["caution_reason"].ne("")

    master["data_freshness_note"] = ""
    open_mask = master["open_short_start_date"].notna() & master["latest_short_end_date"].isna()
    master.loc[open_mask, "data_freshness_note"] = "データ最終日時点でショート利用中の可能性あり"

    return master, short_episodes


def score_candidate(row: pd.Series) -> int:
    score = 0
    days = row.get("days_since_latest_short_end")
    if pd.notna(days):
        days_int = int(days)
        if 14 <= days_int <= 29:
            score += 5
        elif 30 <= days_int <= 45:
            score += 4
        elif 46 <= days_int <= 89:
            score += 2
        elif days_int >= 90:
            score += 1
    if row.get("short_days_365", 0) >= 15:
        score += 3
    if row.get("short_episodes_365", 0) >= 3:
        score += 2
    if bool(row.get("has_3f_history", False)):
        score += 2
    if not bool(row.get("has_future_booking", False)):
        score += 2
    if not bool(row.get("has_long_history", False)):
        score += 1
    if row.get("day_service_days_90", 0) >= 8:
        score += 2
    elif row.get("day_service_days_180", 0) >= 16:
        score += 1
    if bool(row.get("caution_flag", False)):
        score -= 3
    if bool(row.get("has_future_booking", False)):
        score -= 5
    return int(score)


def priority_label(score: int) -> str:
    if score >= 8:
        return "A"
    if score >= 5:
        return "B"
    return "C"


def expected_bed_days(row: pd.Series, alert_type: str) -> int:
    median_los = row.get("median_short_los")
    if pd.notna(median_los) and float(median_los) > 0:
        base = int(round(float(median_los)))
        return max(2, min(14, base))
    if alert_type == "DAY_TO_SHORT_TRIAL":
        return 2
    if alert_type == "LONG_CONVERSION_CANDIDATE":
        return 5
    if alert_type == "THREE_F_TARGET":
        return 5
    return 5


def build_alerts(master: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for _, row in master.iterrows():
        if bool(row.get("hard_exclude_flag", False)):
            continue

        score = score_candidate(row)
        common = {
            "user_id": row["user_id"],
            "user_name": row.get("user_name", ""),
            "priority_score": score,
            "priority": priority_label(score),
            "latest_short_start_date": date_text(row.get("latest_short_start_date")),
            "latest_short_end_date": date_text(row.get("latest_short_end_date")),
            "days_since_latest_short_end": "" if pd.isna(row.get("days_since_latest_short_end")) else int(row.get("days_since_latest_short_end")),
            "latest_short_floor": row.get("latest_short_floor", ""),
            "short_days_total": int(row.get("short_days_total", 0)),
            "short_days_365": int(row.get("short_days_365", 0)),
            "short_episodes_total": int(row.get("short_episodes_total", 0)),
            "short_episodes_365": int(row.get("short_episodes_365", 0)),
            "has_3f_history": bool(row.get("has_3f_history", False)),
            "day_service_days_90": int(row.get("day_service_days_90", 0)),
            "day_service_days_180": int(row.get("day_service_days_180", 0)),
            "has_future_booking": bool(row.get("has_future_booking", False)),
            "future_booking_date": date_text(row.get("future_booking_date")),
            "future_booking_type": row.get("future_booking_type", ""),
            "caution_flag": bool(row.get("caution_flag", False)),
            "caution_reason": row.get("caution_reason", ""),
            "hard_exclude_flag": bool(row.get("hard_exclude_flag", False)),
        }

        days = row.get("days_since_latest_short_end")
        no_future = not bool(row.get("has_future_booking", False))
        no_current_long = not bool(row.get("is_currently_long", False))
        if pd.notna(days) and int(days) >= 14 and no_future and no_current_long:
            days_int = int(days)
            if 14 <= days_int <= 29:
                alert_type = "SHORT_14D"
                action = "次回予約・追加泊の打診"
                reason = "直近ショート退所後14〜29日"
            elif 30 <= days_int <= 44:
                alert_type = "SHORT_30D"
                action = "月内再利用・定期ショート提案"
                reason = "直近ショート退所後30〜44日"
            elif 45 <= days_int <= 89:
                alert_type = "SHORT_45D"
                action = "休眠化防止フォロー"
                reason = "直近ショート退所後45〜89日"
            else:
                alert_type = "SHORT_90D"
                action = "状況確認・再開可能性確認"
                reason = "直近ショート退所後90日以上"
            rows.append({**common, "alert_type": alert_type, "alert_reason": reason, "recommended_action": action, "expected_bed_days": expected_bed_days(row, alert_type)})

        if (
            row.get("short_days_365", 0) >= 15
            and not bool(row.get("has_long_history", False))
            and no_current_long
        ):
            alert_type = "LONG_CONVERSION_CANDIDATE"
            rows.append(
                {
                    **common,
                    "alert_type": alert_type,
                    "alert_reason": "直近365日ショート15日以上・ロング未転換",
                    "recommended_action": "定期ショート化・利用継続確認・必要時ロング相談",
                    "expected_bed_days": expected_bed_days(row, alert_type),
                }
            )

        latest_recent = pd.notna(days) and 14 <= int(days) <= 90
        if bool(row.get("has_3f_history", False)) and no_future and no_current_long and latest_recent:
            alert_type = "THREE_F_TARGET"
            rows.append(
                {
                    **common,
                    "alert_type": alert_type,
                    "alert_reason": "3F利用歴あり・次回予約未確認",
                    "recommended_action": "3Fショート再利用提案・3F枠での予約確認",
                    "expected_bed_days": expected_bed_days(row, alert_type),
                }
            )

        high_day = row.get("day_service_days_90", 0) >= 8 or row.get("day_service_days_180", 0) >= 16
        no_resident_history = row.get("short_days_total", 0) == 0 and not bool(row.get("has_long_history", False))
        if bool(row.get("has_day_service_history", False)) and no_resident_history and high_day:
            alert_type = "DAY_TO_SHORT_TRIAL"
            rows.append(
                {
                    **common,
                    "alert_type": alert_type,
                    "alert_reason": "デイ高頻度・入所未利用",
                    "recommended_action": "初回1泊2日ショート体験の案内",
                    "expected_bed_days": expected_bed_days(row, alert_type),
                }
            )

    alerts = pd.DataFrame(rows)
    if alerts.empty:
        return alerts
    return alerts.sort_values(["priority_score", "expected_bed_days"], ascending=[False, False])


def build_weekly_priority(alerts: pd.DataFrame, top_n: int) -> pd.DataFrame:
    if alerts.empty:
        return pd.DataFrame()
    field_first = {
        "priority_score": "max",
        "latest_short_end_date": "first",
        "days_since_latest_short_end": "first",
        "latest_short_floor": "first",
        "short_days_total": "first",
        "short_days_365": "first",
        "short_episodes_365": "first",
        "has_3f_history": "first",
        "day_service_days_90": "first",
        "day_service_days_180": "first",
        "has_future_booking": "first",
        "expected_bed_days": "max",
        "caution_flag": "first",
    }
    field_first = {key: value for key, value in field_first.items() if key in alerts.columns}
    eligible = alerts[
        ~alerts["hard_exclude_flag"].astype(bool)
        & ~alerts["caution_flag"].astype(bool)
        & ~alerts["has_future_booking"].astype(bool)
    ].copy()
    if eligible.empty:
        return pd.DataFrame()
    grouped = eligible.groupby(["user_id", "user_name"], as_index=False).agg(field_first)
    grouped["alert_types"] = grouped["user_id"].map(
        eligible.groupby("user_id")["alert_type"].apply(lambda x: " / ".join(sorted(set(x))))
    )
    grouped["alert_reason"] = grouped["user_id"].map(
        eligible.groupby("user_id")["alert_reason"].apply(lambda x: " / ".join(dict.fromkeys(x)))
    )
    grouped["recommended_action"] = grouped["user_id"].map(
        eligible.groupby("user_id")["recommended_action"].apply(lambda x: " / ".join(dict.fromkeys(x)))
    )
    grouped["priority"] = grouped["priority_score"].apply(priority_label)
    grouped["owner_or_counselor"] = ""
    grouped["followup_status"] = ""
    grouped["next_action_date"] = ""
    grouped["memo"] = ""
    ordered_cols = [
        "priority",
        "priority_score",
        "user_id",
        "user_name",
        "owner_or_counselor",
        "latest_short_end_date",
        "days_since_latest_short_end",
        "latest_short_floor",
        "short_days_total",
        "short_days_365",
        "short_episodes_365",
        "has_3f_history",
        "day_service_days_90",
        "day_service_days_180",
        "has_future_booking",
        "alert_types",
        "alert_reason",
        "recommended_action",
        "expected_bed_days",
        "caution_flag",
        "followup_status",
        "next_action_date",
        "memo",
    ]
    grouped = grouped.sort_values(["priority_score", "expected_bed_days"], ascending=[False, False]).head(top_n)
    return grouped[ordered_cols]


def as_int(value: Any) -> int:
    text = clean_str(value)
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def simple_reason(
    alert_types: str,
    days_since: Any,
    floor: str,
    short_days_365: Any,
    short_episodes_365: Any,
    day_days_90: Any,
    day_days_180: Any,
) -> str:
    alerts = set(str(alert_types).split(" / "))
    parts: list[str] = []
    if any(a in alerts for a in ["SHORT_14D", "SHORT_30D", "SHORT_45D"]):
        if str(days_since).strip():
            parts.append(f"前回ショートから{as_int(days_since)}日")
        else:
            parts.append("前回ショート後の確認時期")
    elif "SHORT_90D" in alerts:
        parts.append("しばらくショート利用なし")
    if "LONG_CONVERSION_CANDIDATE" in alerts:
        parts.append(f"直近365日ショート{as_int(short_days_365)}日/{as_int(short_episodes_365)}回")
    if "THREE_F_TARGET" in alerts:
        parts.append("3F利用歴あり")
    if "DAY_TO_SHORT_TRIAL" in alerts:
        parts.append(f"デイ多め（90日{as_int(day_days_90)}日/180日{as_int(day_days_180)}日）")
    elif as_int(day_days_90) >= 8:
        parts.append(f"デイ接点あり（90日{as_int(day_days_90)}日）")
    elif as_int(day_days_180) >= 16:
        parts.append(f"デイ接点あり（180日{as_int(day_days_180)}日）")
    if floor and floor == "3F" and "3F利用歴あり" not in parts:
        parts.append("直近3F利用")
    return " / ".join(parts[:3]) if parts else "今週確認候補"


def simple_service_context(row: pd.Series) -> str:
    short_days = as_int(row.get("short_days_365", 0))
    short_episodes = as_int(row.get("short_episodes_365", 0))
    day_90 = as_int(row.get("day_service_days_90", 0))
    day_180 = as_int(row.get("day_service_days_180", 0))
    return f"ショート直近365日: {short_days}日/{short_episodes}回 / デイ: 90日{day_90}日・180日{day_180}日"


def simple_request(alert_types: str) -> str:
    alerts = set(str(alert_types).split(" / "))
    if "SHORT_14D" in alerts:
        return "次回予約や追加泊ができるか確認"
    if "SHORT_30D" in alerts:
        return "今月もう一度使えるか確認"
    if "SHORT_45D" in alerts:
        return "間が空きすぎないよう近況確認"
    if "THREE_F_TARGET" in alerts:
        return "3F枠で再利用できるか相談員に確認"
    if "LONG_CONVERSION_CANDIDATE" in alerts:
        return "定期ショート化できるか確認"
    if "DAY_TO_SHORT_TRIAL" in alerts:
        return "まず1泊体験の余地を確認"
    if "SHORT_90D" in alerts:
        return "近況と再開可能性だけ確認"
    return "次回利用の可能性を確認"


def build_simple_priority(priority: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    if priority.empty:
        return pd.DataFrame()
    rows: list[dict[str, Any]] = []
    for idx, row in priority.reset_index(drop=True).iterrows():
        rows.append(
            {
                "対応順": idx + 1,
                "利用者ID": row.get("user_id", ""),
                "氏名": row.get("user_name", ""),
                "なぜ今見るか": simple_reason(
                    row.get("alert_types", ""),
                    row.get("days_since_latest_short_end", ""),
                    clean_str(row.get("latest_short_floor", "")),
                    row.get("short_days_365", 0),
                    row.get("short_episodes_365", 0),
                    row.get("day_service_days_90", 0),
                    row.get("day_service_days_180", 0),
                ),
                "今週のお願い": simple_request(row.get("alert_types", "")),
                "利用状況": simple_service_context(row),
                "前回ショート退所": row.get("latest_short_end_date", ""),
                "退所後日数": row.get("days_since_latest_short_end", ""),
                "前回フロア": row.get("latest_short_floor", ""),
                "対応結果": "",
                "次に見る日": "",
                "メモ": "",
            }
        )
    return pd.DataFrame(rows)


def normalize_for_csv(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = out[col].apply(date_text)
        elif out[col].dtype == bool:
            out[col] = out[col].map(bool_yes)
    return out.astype(object).where(pd.notna(out), "")


def write_csv(df: pd.DataFrame, path: Path) -> None:
    normalize_for_csv(df).to_csv(path, index=False, encoding="utf-8-sig")


def markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(v) for v in row) + " |")
    return "\n".join(lines)


def build_markdown_html(markdown: str, title: str) -> str:
    lines = markdown.splitlines()
    body: list[str] = []
    in_ul = False
    in_table = False
    table_rows: list[list[str]] = []

    def flush_ul() -> None:
        nonlocal in_ul
        if in_ul:
            body.append("</ul>")
            in_ul = False

    def flush_table() -> None:
        nonlocal in_table, table_rows
        if not in_table:
            return
        body.append("<table>")
        if table_rows:
            body.append("<thead><tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in table_rows[0]) + "</tr></thead>")
            body.append("<tbody>")
            has_separator = (
                len(table_rows) > 1
                and all(set(cell.replace(" ", "")) <= {"-", ":"} for cell in table_rows[1])
            )
            body_rows = table_rows[2:] if has_separator else table_rows[1:]
            for row in body_rows:
                body.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in row) + "</tr>")
            body.append("</tbody>")
        body.append("</table>")
        in_table = False
        table_rows = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            flush_ul()
            in_table = True
            table_rows.append([cell.strip() for cell in stripped.strip("|").split("|")])
            continue
        flush_table()
        if not stripped:
            flush_ul()
            continue
        if stripped.startswith("# "):
            flush_ul()
            body.append(f"<h1>{html.escape(stripped[2:])}</h1>")
        elif stripped.startswith("## "):
            flush_ul()
            body.append(f"<h2>{html.escape(stripped[3:])}</h2>")
        elif stripped.startswith("### "):
            flush_ul()
            body.append(f"<h3>{html.escape(stripped[4:])}</h3>")
        elif stripped.startswith("- "):
            if not in_ul:
                body.append("<ul>")
                in_ul = True
            body.append(f"<li>{html.escape(stripped[2:])}</li>")
        else:
            flush_ul()
            body.append(f"<p>{html.escape(stripped)}</p>")
    flush_ul()
    flush_table()
    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>{html.escape(title)}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; margin: 0; background: #f7f8fa; color: #1f2937; }}
    main {{ max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; }}
    h1 {{ font-size: 28px; margin: 0 0 20px; color: #111827; }}
    h2 {{ font-size: 20px; margin: 28px 0 12px; border-left: 4px solid #2563eb; padding-left: 10px; }}
    h3 {{ font-size: 16px; margin: 18px 0 8px; }}
    p, li {{ line-height: 1.75; font-size: 14px; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 20px; background: #fff; }}
    th, td {{ border: 1px solid #d1d5db; padding: 8px 10px; font-size: 13px; text-align: left; }}
    th {{ background: #e5e7eb; }}
  </style>
</head>
<body><main>
{chr(10).join(body)}
</main></body></html>
"""


def build_simple_priority_print_html(simple_priority: pd.DataFrame, as_of: pd.Timestamp) -> str:
    rows_html: list[str] = []
    status_options = ["未対応", "架電済", "ケアマネ連絡済", "家族連絡済", "提案済", "予約化", "見送り", "対象外", "次週再確認"]
    for _, row in simple_priority.iterrows():
        order = html.escape(clean_str(row.get("対応順")))
        user_id = html.escape(clean_str(row.get("利用者ID")))
        name = html.escape(clean_str(row.get("氏名")))
        reason = html.escape(clean_str(row.get("なぜ今見るか")))
        request = html.escape(clean_str(row.get("今週のお願い")))
        service = html.escape(clean_str(row.get("利用状況")))
        last_short = html.escape(clean_str(row.get("前回ショート退所")) or "-")
        days_since = html.escape(clean_str(row.get("退所後日数")) or "-")
        floor = html.escape(clean_str(row.get("前回フロア")) or "-")
        status_html = "".join(
            f'<span class="check"><span class="box"></span>{html.escape(option)}</span>'
            for option in status_options
        )
        rows_html.append(
            f"""
      <section class="person-card">
        <div class="card-head">
          <div class="order">対応順 {order}</div>
          <div class="person-title"><div class="name">{name}</div><div class="user-id">ID: {user_id}</div></div>
        </div>
        <div class="request">{request}</div>
        <div class="reason">{reason}</div>
        <div class="facts">
          <div><span>前回ショート退所</span><strong>{last_short}</strong></div>
          <div><span>退所後</span><strong>{days_since}日</strong></div>
          <div><span>前回フロア</span><strong>{floor}</strong></div>
        </div>
        <div class="service">{service}</div>
        <div class="status-block">
          <div class="label">対応結果</div>
          <div class="checks">{status_html}</div>
        </div>
        <div class="memo-row">
          <div><span>次に見る日</span><div class="write-line"></div></div>
          <div><span>メモ</span><div class="write-line"></div></div>
        </div>
      </section>
"""
        )

    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>現場向け 今週の重点フォロー</title>
  <style>
    :root {{
      --ink: #243043;
      --muted: #64748b;
      --line: #d8dee8;
      --paper: #fffdf8;
      --soft: #f4f8fb;
      --accent: #2f7d7e;
      --accent-soft: #e7f3f2;
      --warm: #f7efe0;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: #eef3f6;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
      line-height: 1.55;
    }}
    .screen-actions {{
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      justify-content: center;
      gap: 10px;
      padding: 10px 12px;
      background: rgba(238, 243, 246, 0.94);
      border-bottom: 1px solid #d8dee8;
      backdrop-filter: blur(6px);
    }}
    .print-button {{
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      padding: 9px 16px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }}
    .print-hint {{
      display: flex;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }}
    main {{
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
    }}
    .sheet {{
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 22px;
      box-shadow: 0 8px 24px rgba(36, 48, 67, 0.08);
    }}
    .topbar {{
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      border-bottom: 2px solid var(--accent-soft);
      padding-bottom: 14px;
      margin-bottom: 14px;
    }}
    h1 {{
      margin: 0 0 6px;
      font-size: 25px;
      letter-spacing: 0;
      color: #1f2937;
    }}
    .subtitle {{
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }}
    .date-box {{
      min-width: 150px;
      background: var(--accent-soft);
      border: 1px solid #bfdfdc;
      border-radius: 8px;
      padding: 10px 12px;
      text-align: center;
      font-size: 13px;
      color: #245f60;
    }}
    .date-box strong {{
      display: block;
      font-size: 16px;
      color: #174647;
      margin-top: 2px;
    }}
    .guide {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 12px 0 16px;
    }}
    .guide div {{
      background: var(--soft);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      font-size: 12px;
      color: #334155;
    }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }}
    .person-card {{
      background: #ffffff;
      border: 1px solid var(--line);
      border-left: 5px solid var(--accent);
      border-radius: 8px;
      padding: 11px 12px 12px;
      page-break-inside: avoid;
      break-inside: avoid;
      overflow: hidden;
    }}
    .card-head {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 7px;
    }}
    .order {{
      color: #ffffff;
      background: var(--accent);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      white-space: nowrap;
    }}
    .person-title {{
      text-align: right;
      min-width: 0;
    }}
    .name {{
      font-size: 19px;
      font-weight: 700;
      color: #111827;
    }}
    .user-id {{
      color: var(--muted);
      font-size: 11px;
      margin-top: 1px;
    }}
    .request {{
      background: var(--warm);
      border: 1px solid #edd9b8;
      border-radius: 8px;
      padding: 8px 9px;
      font-size: 14px;
      font-weight: 700;
      color: #5f421d;
      margin-bottom: 7px;
    }}
    .reason {{
      font-size: 12px;
      color: #334155;
      margin-bottom: 8px;
    }}
    .facts {{
      display: grid;
      grid-template-columns: 1.25fr 0.8fr 0.8fr;
      gap: 6px;
      margin-bottom: 7px;
    }}
    .facts div {{
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 5px 6px;
      background: #fbfdff;
      min-height: 42px;
    }}
    .facts span,
    .memo-row span,
    .label {{
      display: block;
      color: var(--muted);
      font-size: 10px;
      margin-bottom: 2px;
    }}
    .facts strong {{
      font-size: 13px;
      color: #1f2937;
    }}
    .service {{
      color: #334155;
      background: #f7fafc;
      border-radius: 6px;
      padding: 6px 7px;
      font-size: 11px;
      margin-bottom: 8px;
    }}
    .checks {{
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-bottom: 7px;
    }}
    .check {{
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      color: #334155;
      white-space: nowrap;
    }}
    .status-block {{
      border-top: 1px dashed #cbd5e1;
      padding-top: 6px;
      margin-top: 6px;
    }}
    .box {{
      width: 10px;
      height: 10px;
      border: 1.4px solid #64748b;
      border-radius: 2px;
      background: #fff;
    }}
    .memo-row {{
      display: grid;
      grid-template-columns: 0.7fr 1.3fr;
      gap: 8px;
    }}
    .write-line {{
      height: 22px;
      border-bottom: 1px solid #9ca3af;
    }}
    @media print {{
      @page {{ size: A4 portrait; margin: 8mm; }}
      html, body {{ width: 210mm; background: #fff; }}
      body {{
        color: #111827;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .screen-actions {{ display: none; }}
      main {{ max-width: none; width: 100%; padding: 0; }}
      .sheet {{
        border: 0;
        box-shadow: none;
        padding: 0;
        background: #fff;
      }}
      .topbar {{
        padding-bottom: 8px;
        margin-bottom: 8px;
        break-after: avoid;
        page-break-after: avoid;
      }}
      h1 {{ font-size: 19px; margin-bottom: 3px; }}
      .subtitle {{ font-size: 10px; }}
      .date-box {{
        min-width: 118px;
        padding: 6px 8px;
        font-size: 10px;
      }}
      .date-box strong {{ font-size: 13px; }}
      .guide {{
        gap: 5px;
        margin: 8px 0 9px;
        break-after: avoid;
        page-break-after: avoid;
      }}
      .guide div {{
        padding: 6px 7px;
        font-size: 9.5px;
        line-height: 1.4;
      }}
      .cards {{
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5mm;
        align-items: start;
      }}
      .person-card {{
        box-shadow: none;
        border-radius: 6px;
        padding: 8px 9px 9px;
        break-inside: avoid;
        page-break-inside: avoid;
      }}
      .card-head {{ margin-bottom: 5px; }}
      .order {{ font-size: 9px; padding: 2px 6px; }}
      .name {{ font-size: 15px; }}
      .user-id {{ font-size: 9px; }}
      .request {{
        padding: 5px 6px;
        font-size: 11.5px;
        margin-bottom: 5px;
      }}
      .reason {{
        font-size: 10px;
        line-height: 1.35;
        margin-bottom: 5px;
      }}
      .facts {{ gap: 4px; margin-bottom: 5px; }}
      .facts div {{
        min-height: 31px;
        padding: 3px 4px;
      }}
      .facts span,
      .memo-row span,
      .label {{
        font-size: 8.5px;
        margin-bottom: 1px;
      }}
      .facts strong {{ font-size: 10px; }}
      .service {{
        padding: 4px 5px;
        font-size: 9px;
        margin-bottom: 5px;
      }}
      .status-block {{
        padding-top: 4px;
        margin-top: 4px;
      }}
      .checks {{
        gap: 2px 5px;
        margin-bottom: 4px;
      }}
      .check {{ font-size: 8.5px; gap: 2px; }}
      .box {{
        width: 8px;
        height: 8px;
        border-width: 1px;
      }}
      .memo-row {{ gap: 5px; }}
      .write-line {{ height: 14px; }}
      .guide div, .request, .service, .facts div, .date-box, .order {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    }}
    @media screen and (max-width: 760px) {{
      .cards, .guide, .topbar, .memo-row {{ grid-template-columns: 1fr; display: grid; }}
      .date-box {{ text-align: left; }}
    }}
  </style>
</head>
<body>
<div class="screen-actions">
  <button class="print-button" type="button" onclick="window.print()">印刷する</button>
  <div class="print-hint">A4縦・倍率100%での印刷を想定しています</div>
</div>
<main>
  <div class="sheet">
    <header class="topbar">
      <div>
        <h1>現場向け 今週の重点フォロー</h1>
        <p class="subtitle">候補者探しの手間を減らすための、印刷用リストです。上から順に、今週確認できる範囲で使ってください。</p>
      </div>
      <div class="date-box">作成日<strong>{html.escape(date_text(as_of))}</strong></div>
    </header>
    <section class="guide">
      <div>順位は、前回ショートからの日数、ショート利用実績、3F利用歴、デイサービス利用状況を合わせて見ています。</div>
      <div>ショートは直近365日、デイは直近90日・180日の利用日数です。日付範囲は作成日から逆算しています。</div>
      <div>全員に必ず連絡するリストではありません。状況が分かる人は対応結果だけ記入してください。</div>
    </section>
    <section class="cards">
{''.join(rows_html)}
    </section>
  </div>
</main>
</body>
</html>
"""


def build_reports(
    output_dir: Path,
    as_of: pd.Timestamp,
    top_n: int,
    master: pd.DataFrame,
    alerts: pd.DataFrame,
    priority: pd.DataFrame,
    metrics: dict[str, Any],
    freshness: dict[str, str],
    table_row_counts: dict[str, dict[str, int]],
    distributions: dict[str, dict[str, int]],
    used_schedule_csvs: list[str],
) -> dict[str, Any]:
    priority_counts = priority["priority"].value_counts().to_dict() if not priority.empty else {}
    alert_counts = alerts["alert_type"].value_counts().to_dict() if not alerts.empty else {}
    expected_total = int(priority["expected_bed_days"].sum()) if not priority.empty else 0
    data_warning = []
    for key in ["resident_max_date", "day_service_max_date", "schedule_max_date"]:
        value = freshness.get(key, "")
        if value and pd.Timestamp(value) < as_of:
            data_warning.append(f"{key} がAS_OF_DATEより古い")

    recent = metrics.get("recent_2026_apr_may", {})
    floor_recent = metrics.get("floor_recent", [])
    floor_3f = next((row for row in floor_recent if row.get("floor") == "3F"), {})
    kpi_rows = [
        ["ショート＋ロング入所率", f"{recent.get('goal_pct', '今回未算出')}%"],
        ["98%目標との差", "3.0pt" if recent.get("goal_pct") is not None else "今回未算出"],
        ["不足床日", metrics.get("gap_to_98_days", "今回未算出")],
        ["ショート床日", recent.get("short_days", "今回未算出")],
        ["ロング床日", recent.get("long_days", "今回未算出")],
        ["3F入所率", f"{floor_3f.get('goal_pct', '今回未算出')}%" if floor_3f else "今回未算出"],
        ["3F平均空床", f"{round(36 - float(floor_3f.get('avg_goal_beds', 0)), 1)}床/日" if floor_3f else "今回未算出"],
        ["今週の重点フォロー対象者数", len(priority)],
        ["見込み床日合計（仮置き）", expected_total],
    ]
    summary_rows = []
    alert_labels = {
        "SHORT_14D": ["ショート退所後14〜29日", "次回予約・追加泊"],
        "SHORT_30D": ["ショート退所後30〜44日", "月内再利用"],
        "SHORT_45D": ["ショート退所後45〜89日", "休眠防止"],
        "LONG_CONVERSION_CANDIDATE": ["ショート15日以上・ロング未転換", "定期化・ロング相談"],
        "THREE_F_TARGET": ["3F対象", "3F再利用"],
        "DAY_TO_SHORT_TRIAL": ["デイ高頻度・入所未利用", "初回ショート体験"],
    }
    for alert_type, (label, action) in alert_labels.items():
        sub = alerts[alerts["alert_type"].eq(alert_type)] if not alerts.empty else pd.DataFrame()
        summary_rows.append([label, len(sub), int(sub["expected_bed_days"].sum()) if not sub.empty else 0, action])

    md = f"""# 顧客フォローDX週次レポート：ショート稼働改善と現場負担軽減

作成日: {date_text(as_of)}

## 1. 今週の結論

- 入所率改善の主戦場はロング直接獲得ではなく、ショート床日の回復である。
- 2026年4-5月の入所率95.0%に対し、98%目標には180床日不足。
- 前年同期間比ではロング床日は増えているが、ショート床日が165床日減少。
- 既存ショート利用者の再利用、ショート15日以上利用者の定期化、3F向けショート再利用、デイ高頻度者の初回ショート誘導を重点化する。
- 現場疲弊があるため、現場には全件ではなく「今週の重点10〜20件」に絞って提示する。
- このMVPは現場に新しい入力負担を増やすためではなく、既存データから「今週確認した方がよい利用者」を先に整理するためのもの。

## 2. データ鮮度

- resident系データ最大日付: {freshness.get("resident_max_date", "今回未算出")}
- day_service系データ最大日付: {freshness.get("day_service_max_date", "今回未算出")}
- schedule系データ最大日付: {freshness.get("schedule_max_date", "今回未算出")}
- as_of_date: {date_text(as_of)}
- 注意点: {"; ".join(data_warning) if data_warning else "AS_OF_DATE時点の主要データ鮮度に大きな警告なし"}

## 3. KPIサマリー

{markdown_table(["KPI", "値"], kpi_rows)}

優先度別件数: A={priority_counts.get("A", 0)} / B={priority_counts.get("B", 0)} / C={priority_counts.get("C", 0)}

アラート種別別件数: {", ".join(f"{k}={v}" for k, v in alert_counts.items()) if alert_counts else "該当なし"}

## 4. 今週の重点フォロー対象の要約

{markdown_table(["区分", "件数", "見込み床日", "主な対応"], summary_rows)}

見込み床日は過去ショート1回あたり中央値等から置いた参考値であり、予約確約値ではありません。

## 5. 現場負担軽減の運用ルール

- 現場に渡すのは上位10〜20件のみ。
- 全件アラートは管理者用。
- 対応結果は選択式で最小限。
- 見送り・対象外は一定期間スヌーズする設計にする。
- 3〜4週間は人力レポートとして検証し、使える条件だけを自動化する。

## 6. 次週に見ること

- A優先リストから予約化した件数
- 予約化した見込み床日
- 対象外の混入率
- 現場が対応可能だった件数
- 3F候補が実際に3F稼働に効いたか
- アラート条件の修正点
"""
    (output_dir / "weekly_followup_executive_summary.md").write_text(md, encoding="utf-8")
    (output_dir / "weekly_followup_executive_summary.html").write_text(
        build_markdown_html(md, "顧客フォローDX週次レポート"), encoding="utf-8"
    )

    metrics_out = {
        "as_of_date": date_text(as_of),
        "top_n": top_n,
        "weekly_priority_count": len(priority),
        "priority_counts": priority_counts,
        "alert_type_counts": alert_counts,
        "expected_bed_days_total": expected_total,
        "data_freshness": freshness,
        "data_freshness_warning": data_warning,
        "source_metrics": {
            "recent_2026_apr_may": metrics.get("recent_2026_apr_may"),
            "yoy_2025_apr_may": metrics.get("yoy_2025_apr_may"),
            "gap_to_98_days": metrics.get("gap_to_98_days"),
            "yoy_short_gap_days": metrics.get("yoy_short_gap_days"),
            "floor_recent": metrics.get("floor_recent"),
        },
    }
    (output_dir / "weekly_followup_metrics.json").write_text(
        json.dumps(metrics_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    simple_path_note = "weekly_priority_followup_simple.csv"

    notes = f"""# data_quality_notes

## 使用したDB・CSV

- {ANALYSIS_DB.relative_to(ROOT)}
- {EPISODES_DB.relative_to(ROOT)}
- {METRICS_JSON.relative_to(ROOT)}
{chr(10).join(f"- {p}" for p in used_schedule_csvs) if used_schedule_csvs else "- 予定表CSVは存在確認のみ。主集計はDB化済みfloor_schedule_eventsを使用。"}

## 各テーブルの行数

### arbos_analysis.sqlite3

{markdown_table(["テーブル/ビュー", "行数"], [[k, v] for k, v in table_row_counts["analysis"].items()])}

### arbos_episodes.sqlite3

{markdown_table(["テーブル/ビュー", "行数"], [[k, v] for k, v in table_row_counts["episodes"].items()])}

## 主要テーブルの最大日付

- resident_daily_stays.snapshot_date: {freshness.get("resident_daily_max_date", "")}
- resident_episodes.last_seen_date: {freshness.get("resident_episode_max_date", "")}
- day_service_usage.usage_date: {freshness.get("day_service_max_date", "")}
- floor_schedule_events.scheduled_date: {freshness.get("schedule_db_max_date", "")}
- schedule CSV max date: {freshness.get("schedule_csv_max_date", "")}

## 利用形態の値分布

### resident_episodes.stay_type

{markdown_table(["値", "件数"], [[k, v] for k, v in distributions["stay_type"].items()])}

### resident_episodes.admission_type

{markdown_table(["値", "件数"], [[k, v] for k, v in distributions["admission_type"].items()])}

### floor_schedule_events.form

{markdown_table(["値", "件数"], [[k, v] for k, v in distributions["schedule_form"].items()])}

## フロア判定の値分布

{markdown_table(["値", "件数"], [[k, v] for k, v in distributions["floor"].items()])}

## 除外者数・注意者数

- hard_exclude者数: {int(master["hard_exclude_flag"].sum())}
- caution者数: {int(master["caution_flag"].sum())}
- 現場向け重点リストへのhard_exclude混入: 0
- 現場向け重点リストへのcaution混入: {int(priority["caution_flag"].astype(bool).sum()) if not priority.empty else 0}

## 次回予約判定の方法

- floor_schedule_eventsでAS_OF_DATEより後のfloor_inイベントを次回予約として判定。
- 今回はschedule系データ最大日付がAS_OF_DATEより古い場合、次回予約の有無は不確実性あり。

## 退所日確定の判定方法

- ショートはfloor_schedule_eventsのformが「ショート」または「短期」のものを対象。
- matched_segment_start/endがあり、同一セグメントにfloor_outが存在する場合のみ退所日確定とした。
- 退所日が確定していないセグメントは退所後日数アラートから除外。

## 既知の限界

- ショート利用の入退所は予定表イベントを主に使っているため、予定表に未入力・未照合の利用者は漏れる可能性がある。
- day_service_usageの未照合者は疑似user_idで保持しており、既存入所者との完全な名寄せは今後の改善対象。
- 予定表データがAS_OF_DATEより古い場合、次回予約判定は保守的に「確認できない」として扱う。
- owner_or_counselorは既存データから取得できなかったため空欄。

## 今後改善すべき点

- 相談員・担当者列の追加
- 手入力followup_statusの読み込みとスヌーズ反映
- 予定表CSVからの未来予約データ更新
- 除外・注意語の現場レビュー
- 3F適合条件の現場定義化

## followup_status選択肢

- 未対応
- 架電済
- ケアマネ連絡済
- 家族連絡済
- 提案済
- 予約化
- 見送り
- 対象外
- 次週再確認

## snoozeルール案

- 見送り: 30日
- 対象外: 90日
- 予約化: 次回退所後まで非表示
- 次週再確認: 7日
"""
    (output_dir / "data_quality_notes.md").write_text(notes, encoding="utf-8")

    readme = f"""# 週次フォローMVP

## 目的

現場が一から候補者を探さなくても、今週声をかけるべき既存利用者が分かる状態を作るための週次人力レポートです。

## 現場に渡すファイル

- weekly_priority_followup_simple.csv
- weekly_priority_followup.csv

まず現場にはweekly_priority_followup_simple.csvを渡してください。対応順、氏名、確認理由、今週のお願い、記録欄だけに絞っています。

weekly_priority_followup.csvは、相談員リーダーや管理者が詳細を確認するための版です。

順位には、前回ショートからの日数、ショート直近365日の日数・回数、3F利用歴、デイ直近90日・180日の利用日数を反映しています。

## 管理職・経営層が見るファイル

- weekly_followup_executive_summary.md
- weekly_followup_executive_summary.html
- weekly_followup_metrics.json

## 管理者・分析担当が見るファイル

- all_followup_alerts.csv
- short_reactivation_alerts.csv
- long_conversion_candidates.csv
- three_floor_targets.csv
- day_to_short_trial_candidates.csv
- customer_followup_master.csv
- data_quality_notes.md
- followup_status_template.csv

## 翌週の運用方法

1. weekly_priority_followup.csvの上位10〜20件だけを現場・相談員で確認する。
2. 対応結果を選択式で記録する。
3. 予約化、見送り、対象外、次週再確認の件数を見る。
4. 対象外の混入が多い条件を修正する。
5. 3〜4週間試してから自動化範囲を決める。

## 注意点

- 見込み床日は仮置きであり予約確約ではありません。
- 予定表データが古い場合、次回予約判定には不確実性があります。
- 全件アラートは管理者用で、現場へそのまま渡さないでください。
- 現場向けの基本ファイルは{simple_path_note}です。
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")
    return metrics_out


def main() -> None:
    args = parse_args()
    as_of = pd.Timestamp(args.as_of)
    output_dir = OUTPUT_ROOT / f"weekly_followup_{as_of.strftime('%Y%m%d')}"
    output_dir.mkdir(parents=True, exist_ok=False)

    data = {
        "resident_users": read_sql(ANALYSIS_DB, "select * from resident_users"),
        "resident_episodes": read_sql(ANALYSIS_DB, "select * from resident_episodes"),
        "resident_daily": read_sql(ANALYSIS_DB, "select snapshot_date, floor, admission_type, stay_type from resident_daily_stays"),
        "schedule": read_sql(ANALYSIS_DB, "select * from floor_schedule_events"),
        "day_usage": read_sql(ANALYSIS_DB, "select * from day_service_usage"),
        "service_summary": read_sql(ANALYSIS_DB, "select * from v_person_service_summary"),
        "service_days": read_sql(ANALYSIS_DB, "select usage_date, person_id, user_id, user_name, service_type from v_person_service_days"),
        "excluded_users": read_sql(EPISODES_DB, "select * from excluded_users"),
    }
    metrics = load_metrics()

    resident_daily_max = date_text(to_date(data["resident_daily"]["snapshot_date"]).max())
    resident_episode_max = date_text(to_date(data["resident_episodes"]["last_seen_date"]).max())
    day_service_max = date_text(to_date(data["day_usage"]["usage_date"]).max())
    schedule_db_max = date_text(to_date(data["schedule"]["scheduled_date"]).max())
    schedule_csv_max, used_schedule_csvs = max_csv_schedule_date()
    schedule_max_candidates = [x for x in [schedule_db_max, schedule_csv_max] if x]
    schedule_max = max(schedule_max_candidates) if schedule_max_candidates else ""
    resident_max = max([x for x in [resident_daily_max, resident_episode_max] if x])
    freshness = {
        "as_of_date": date_text(as_of),
        "resident_max_date": resident_max,
        "resident_daily_max_date": resident_daily_max,
        "resident_episode_max_date": resident_episode_max,
        "day_service_max_date": day_service_max,
        "schedule_max_date": schedule_max,
        "schedule_db_max_date": schedule_db_max,
        "schedule_csv_max_date": schedule_csv_max,
    }

    master, short_episodes = aggregate_master(as_of, data)
    alerts = build_alerts(master)
    priority = build_weekly_priority(alerts, args.top_n)

    master_export = master.copy()
    master_export["latest_short_start_date"] = master_export["latest_short_start_date"].apply(date_text)
    master_export["latest_short_end_date"] = master_export["latest_short_end_date"].apply(date_text)
    master_export["latest_long_start_date"] = master_export["latest_long_start_date"].apply(date_text)
    master_export["future_booking_date"] = master_export["future_booking_date"].apply(date_text)
    master_export["has_long_history"] = master_export["has_long_history"].astype(bool)
    master_export["is_currently_long"] = master_export["is_currently_long"].astype(bool)
    customer_cols = [
        "user_id",
        "user_name",
        "latest_short_start_date",
        "latest_short_end_date",
        "latest_short_floor",
        "days_since_latest_short_end",
        "short_days_total",
        "short_days_365",
        "short_episodes_total",
        "short_episodes_365",
        "latest_long_start_date",
        "has_long_history",
        "is_currently_long",
        "has_3f_history",
        "latest_floor",
        "day_service_days_90",
        "day_service_days_180",
        "has_day_service_history",
        "has_future_booking",
        "future_booking_date",
        "future_booking_type",
        "latest_discharge_destination",
        "latest_discharge_reason",
        "hard_exclude_flag",
        "hard_exclude_reason",
        "caution_flag",
        "caution_reason",
        "data_freshness_note",
    ]
    for col in customer_cols:
        if col not in master_export.columns:
            master_export[col] = ""
    write_csv(master_export[customer_cols], output_dir / "customer_followup_master.csv")
    write_csv(priority, output_dir / "weekly_priority_followup.csv")
    simple_priority = build_simple_priority(priority, as_of)
    write_csv(simple_priority, output_dir / "weekly_priority_followup_simple.csv")
    simple_cards: list[str] = []
    if not simple_priority.empty:
        for _, row in simple_priority.iterrows():
            simple_cards.append(
                f"""### {row["対応順"]}. {row["氏名"]}（ID: {row["利用者ID"]}）

**今週のお願い**: {row["今週のお願い"]}

**なぜ今見るか**: {row["なぜ今見るか"]}

**利用状況**: {row["利用状況"]}

**前回情報**: 前回ショート退所 {row["前回ショート退所"] or "-"} / 退所後 {row["退所後日数"] or "-"}日 / 前回フロア {row["前回フロア"] or "-"}

**対応結果**: □未対応  □架電済  □ケアマネ連絡済  □家族連絡済  □提案済  □予約化  □見送り  □対象外  □次週再確認

**次に見る日**: ____________________

**メモ**: __________________________________________________

---
"""
            )
    simple_md = f"""# 現場向け 今週の重点フォロー

作成日: {date_text(as_of)}

## 使い方

- この一覧だけ見ればよいです。
- 上から順に、今週確認できる範囲で対応してください。
- 全員に必ず連絡するリストではありません。状況を知っている人は、対応結果に「対象外」「見送り」などを入れてください。
- 新しい入力作業を増やす目的ではありません。候補者探しの手間を減らすための一覧です。
- 順位は、前回ショートからの日数、ショート利用実績、3F利用歴、デイサービス利用状況を合わせて見ています。
- ショート利用実績は、作成日から見た直近365日の日数・回数です。
- デイサービスは、直近90日・180日の利用日数を表示しています。

## 今週見る人

{chr(10).join(simple_cards)}

## 対応結果の記入例

- 未対応
- 架電済
- ケアマネ連絡済
- 家族連絡済
- 提案済
- 予約化
- 見送り
- 対象外
- 次週再確認
"""
    (output_dir / "weekly_priority_followup_simple.md").write_text(simple_md, encoding="utf-8")
    (output_dir / "weekly_priority_followup_simple.html").write_text(
        build_simple_priority_print_html(simple_priority, as_of), encoding="utf-8"
    )
    write_csv(alerts, output_dir / "all_followup_alerts.csv")
    write_csv(alerts[alerts["alert_type"].str.startswith("SHORT_", na=False)], output_dir / "short_reactivation_alerts.csv")
    write_csv(alerts[alerts["alert_type"].eq("LONG_CONVERSION_CANDIDATE")], output_dir / "long_conversion_candidates.csv")
    write_csv(alerts[alerts["alert_type"].eq("THREE_F_TARGET")], output_dir / "three_floor_targets.csv")
    write_csv(alerts[alerts["alert_type"].eq("DAY_TO_SHORT_TRIAL")], output_dir / "day_to_short_trial_candidates.csv")

    status_template_cols = [
        "report_date",
        "user_id",
        "user_name",
        "priority",
        "alert_types",
        "owner_or_counselor",
        "followup_status",
        "action_date",
        "next_action_date",
        "result",
        "expected_bed_days",
        "booked_bed_days",
        "snooze_until",
        "memo",
    ]
    status_template = priority.copy()
    status_template["report_date"] = date_text(as_of)
    status_template["action_date"] = ""
    status_template["result"] = ""
    status_template["booked_bed_days"] = ""
    status_template["snooze_until"] = ""
    for col in status_template_cols:
        if col not in status_template.columns:
            status_template[col] = ""
    write_csv(status_template[status_template_cols], output_dir / "followup_status_template.csv")

    table_row_counts = {"analysis": table_counts(ANALYSIS_DB), "episodes": table_counts(EPISODES_DB)}
    distributions = {
        "stay_type": data["resident_episodes"]["stay_type"].fillna("").replace("", "(空欄)").value_counts().to_dict(),
        "admission_type": data["resident_episodes"]["admission_type"].fillna("").replace("", "(空欄)").value_counts().to_dict(),
        "schedule_form": data["schedule"]["form"].fillna("").replace("", "(空欄)").value_counts().to_dict(),
        "floor": data["resident_daily"]["floor"].fillna("").replace("", "unknown").value_counts().to_dict(),
    }
    metrics_out = build_reports(
        output_dir=output_dir,
        as_of=as_of,
        top_n=args.top_n,
        master=master,
        alerts=alerts,
        priority=priority,
        metrics=metrics,
        freshness=freshness,
        table_row_counts=table_row_counts,
        distributions=distributions,
        used_schedule_csvs=used_schedule_csvs,
    )

    files = sorted(path.name for path in output_dir.iterdir() if path.is_file())
    print(json.dumps({"output_dir": str(output_dir), "files": files, "metrics": metrics_out}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
