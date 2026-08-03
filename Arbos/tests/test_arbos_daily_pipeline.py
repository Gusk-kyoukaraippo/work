import csv
import sqlite3
import tempfile
import unittest
from pathlib import Path

from arbos_daily_pipeline import (
    Episode,
    build_episodes,
    build_user_profiles,
    floor_from_room,
    followup_exclusion,
    main,
    parse_date,
)


HEADER = [
    "指示確認",
    "ｵｰﾀﾞｰ",
    "部屋",
    "Bed",
    "1号",
    "患者ID",
    "入院日",
    "退院予定日",
    "氏名",
    "カナ氏名",
    "年齢",
    "性別",
    "日数",
    "形態",
    "検査",
    "薬",
    "主治医",
    "看護師",
    "相談員",
    "カルテ記載",
]


def write_daily_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="cp932") as file:
        writer = csv.DictWriter(file, fieldnames=HEADER)
        writer.writeheader()
        for row in rows:
            full_row = {column: "" for column in HEADER}
            full_row.update(row)
            writer.writerow(full_row)


class DailyPipelineTest(unittest.TestCase):
    def test_parse_date_extracts_mixed_text(self):
        self.assertEqual(parse_date("2026/05/31(確)").isoformat(), "2026-05-31")
        self.assertEqual(parse_date("患者一覧_20260531").isoformat(), "2026-05-31")

    def test_floor_from_room(self):
        self.assertEqual(floor_from_room("200"), "2F")
        self.assertEqual(floor_from_room("302"), "3F")
        self.assertEqual(floor_from_room("U-1"), "ユニット")
        self.assertEqual(floor_from_room(""), "不明")

    def test_followup_exclusion_detects_death_and_facility_discharge(self):
        base = {
            "episode_id": "E_001_20260401",
            "user_id": "001",
            "admission_date": parse_date("2026/04/01"),
            "discharge_date": parse_date("2026/04/10"),
            "last_seen_date": parse_date("2026/04/10"),
            "first_absent_date": parse_date("2026/04/11"),
            "is_current": False,
            "admission_floor": "2F",
            "latest_floor": "2F",
            "room": "200",
            "bed": "01",
            "admission_type": "短期",
        }
        death = Episode(**base, discharge_destination="死亡", discharge_reason="死亡退院")
        facility = Episode(**base, discharge_destination="特養", discharge_reason="施設退所")

        self.assertEqual(followup_exclusion(death)[0], "死亡退院")
        self.assertEqual(followup_exclusion(facility)[0], "施設退所")

    def test_build_episodes_detects_discharge_and_readmission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_daily_csv(
                root / "患者一覧_入所（アルボース医師）_20260501.csv",
                [
                    {"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2026/05/01", "部屋": "302", "Bed": "02", "形態": "短期"},
                ],
            )
            write_daily_csv(
                root / "患者一覧_入所（アルボース医師）_20260502.csv",
                [
                    {"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2026/05/01", "部屋": "302", "Bed": "02", "形態": "短期"},
                ],
            )
            write_daily_csv(
                root / "患者一覧_入所（アルボース医師）_20260503.csv",
                [
                    {"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                ],
            )
            write_daily_csv(
                root / "患者一覧_入所（アルボース医師）_20260510.csv",
                [
                    {"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2026/05/10", "部屋": "U-1", "Bed": "01", "形態": "短期"},
                ],
            )

            episodes, _observations, latest_date = build_episodes(sorted(root.glob("*.csv")))
            self.assertEqual(latest_date.isoformat(), "2026-05-10")
            self.assertEqual(len(episodes), 3)

            first_episode = next(ep for ep in episodes if ep.episode_id == "E_002_20260501")
            self.assertFalse(first_episode.is_current)
            self.assertEqual(first_episode.discharge_date.isoformat(), "2026-05-02")
            self.assertEqual(first_episode.first_absent_date.isoformat(), "2026-05-03")

            readmission = next(ep for ep in episodes if ep.episode_id == "E_002_20260510")
            self.assertTrue(readmission.is_current)
            self.assertTrue(readmission.readmission_flag)
            self.assertEqual(readmission.previous_discharge_date.isoformat(), "2026-05-02")
            self.assertEqual(readmission.days_to_readmission, 8)
            self.assertEqual(readmission.admission_floor, "ユニット")

    def test_cli_preserves_manual_fields_from_existing_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "input"
            input_dir.mkdir()
            output_dir = root / "output"
            db_path = root / "arbos.sqlite3"

            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260501.csv",
                [{"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"}],
            )

            result = main(["build", "--input-dir", str(input_dir), "--db", str(db_path), "--output-dir", str(output_dir)])
            self.assertEqual(result, 0)

            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "UPDATE episodes SET source_type = ?, source_name = ?, memo = ? WHERE episode_id = ?",
                    ("病院", "A病院", "要確認", "E_001_20260420"),
                )
                conn.commit()

            result = main(["build", "--input-dir", str(input_dir), "--db", str(db_path), "--output-dir", str(output_dir)])
            self.assertEqual(result, 0)

            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT source_type, source_name, memo FROM episodes WHERE episode_id = ?",
                    ("E_001_20260420",),
                ).fetchone()
            self.assertEqual(row, ("病院", "A病院", "要確認"))

    def test_cli_fills_discharge_fields_from_schedule_events_without_overriding_manual_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "input"
            input_dir.mkdir()
            output_dir = root / "output"
            db_path = root / "arbos.sqlite3"
            manual_csv = root / "manual.csv"

            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260501.csv",
                [
                    {"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2026/04/21", "部屋": "201", "Bed": "01", "形態": "長期"},
                ],
            )
            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260502.csv",
                [
                    {"患者ID": "001", "入院日": "2026/04/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2026/04/21", "部屋": "201", "Bed": "01", "形態": "長期"},
                ],
            )
            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260503.csv",
                [{"患者ID": "999", "入院日": "2026/04/01", "部屋": "202", "Bed": "01", "形態": "長期"}],
            )

            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE floor_schedule_events (
                        movement_type TEXT,
                        scheduled_date TEXT,
                        matched_user_id TEXT,
                        matched_segment_start TEXT,
                        matched_segment_end TEXT,
                        match_status TEXT,
                        discharge_destination TEXT,
                        discharge_reason TEXT,
                        followup_exclusion_reason TEXT
                    )
                    """
                )
                conn.executemany(
                    "INSERT INTO floor_schedule_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        (
                            "floor_out",
                            "2026-05-02",
                            "001",
                            "2026-04-20",
                            "2026-05-02",
                            "matched_exact",
                            "特養「あいの詩」",
                            "施設退所",
                            "施設退所",
                        ),
                        (
                            "floor_out",
                            "2026-05-02",
                            "002",
                            "2026-04-21",
                            "2026-05-02",
                            "matched_exact",
                            "死亡",
                            "死亡退所",
                            "死亡退所",
                        ),
                    ],
                )
                conn.commit()

            with manual_csv.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(
                    file,
                    fieldnames=[
                        "episode_id",
                        "source_type",
                        "source_name",
                        "discharge_destination",
                        "discharge_reason",
                        "memo",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "episode_id": "E_002_20260421",
                        "discharge_destination": "病院",
                        "discharge_reason": "病院退所",
                    }
                )

            result = main(
                [
                    "build",
                    "--input-dir",
                    str(input_dir),
                    "--db",
                    str(db_path),
                    "--output-dir",
                    str(output_dir),
                    "--manual-csv",
                    str(manual_csv),
                ]
            )
            self.assertEqual(result, 0)

            with sqlite3.connect(db_path) as conn:
                rows = {
                    user_id: (destination, reason)
                    for user_id, destination, reason in conn.execute(
                        """
                        SELECT user_id, discharge_destination, discharge_reason
                        FROM episodes
                        ORDER BY user_id
                        """
                    ).fetchall()
                }
            self.assertEqual(rows["001"], ("特養「あいの詩」", "施設退所"))
            self.assertEqual(rows["002"], ("病院", "病院退所"))

    def test_schedule_fields_ignore_admission_date_for_legacy_pre_april_2025_episodes_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "input"
            input_dir.mkdir()
            output_dir = root / "output"
            db_path = root / "arbos.sqlite3"

            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260401.csv",
                [
                    {"患者ID": "001", "入院日": "2025/03/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2025/04/02", "部屋": "201", "Bed": "01", "形態": "長期"},
                ],
            )
            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260402.csv",
                [
                    {"患者ID": "001", "入院日": "2025/03/20", "部屋": "200", "Bed": "01", "形態": "長期"},
                    {"患者ID": "002", "入院日": "2025/04/02", "部屋": "201", "Bed": "01", "形態": "長期"},
                ],
            )
            write_daily_csv(
                input_dir / "患者一覧_入所（アルボース医師）_20260403.csv",
                [{"患者ID": "999", "入院日": "2026/04/01", "部屋": "202", "Bed": "01", "形態": "長期"}],
            )

            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE floor_schedule_events (
                        movement_type TEXT,
                        scheduled_date TEXT,
                        matched_user_id TEXT,
                        matched_segment_start TEXT,
                        matched_segment_end TEXT,
                        match_status TEXT,
                        discharge_destination TEXT,
                        discharge_reason TEXT,
                        followup_exclusion_reason TEXT
                    )
                    """
                )
                conn.executemany(
                    "INSERT INTO floor_schedule_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        (
                            "floor_out",
                            "2026-04-02",
                            "001",
                            "2025-04-01",
                            "2026-04-02",
                            "matched_exact",
                            "死亡",
                            "死亡退所",
                            "死亡退所",
                        ),
                        (
                            "floor_out",
                            "2026-04-02",
                            "002",
                            "2025-04-01",
                            "2026-04-02",
                            "matched_exact",
                            "特養",
                            "施設退所",
                            "施設退所",
                        ),
                    ],
                )
                conn.commit()

            result = main(["build", "--input-dir", str(input_dir), "--db", str(db_path), "--output-dir", str(output_dir)])
            self.assertEqual(result, 0)

            with sqlite3.connect(db_path) as conn:
                rows = {
                    user_id: (destination, reason)
                    for user_id, destination, reason in conn.execute(
                        """
                        SELECT user_id, discharge_destination, discharge_reason
                        FROM episodes
                        WHERE user_id IN ('001', '002')
                        ORDER BY user_id
                        """
                    ).fetchall()
                }
            self.assertEqual(rows["001"], ("死亡", "死亡退所"))
            self.assertEqual(rows["002"], ("不明", "不明"))

    def test_user_profiles_split_contact_alerts_and_excluded_users(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sentinel = {"患者ID": "999", "入院日": "2026/04/01", "部屋": "200", "Bed": "04", "形態": "長期"}
            rows_by_date = {
                "20260401": [{"患者ID": "003", "入院日": "2026/04/01", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260402": [{"患者ID": "003", "入院日": "2026/04/01", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260403": [{"患者ID": "003", "入院日": "2026/04/01", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260404": [],
                "20260405": [{"患者ID": "004", "入院日": "2026/04/05", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260406": [{"患者ID": "004", "入院日": "2026/04/05", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260407": [],
                "20260410": [{"患者ID": "003", "入院日": "2026/04/10", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260411": [{"患者ID": "003", "入院日": "2026/04/10", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260412": [{"患者ID": "003", "入院日": "2026/04/10", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260413": [],
                "20260414": [{"患者ID": "004", "入院日": "2026/04/14", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260415": [{"患者ID": "004", "入院日": "2026/04/14", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260416": [],
                "20260419": [{"患者ID": "003", "入院日": "2026/04/19", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260420": [{"患者ID": "003", "入院日": "2026/04/19", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260421": [{"患者ID": "003", "入院日": "2026/04/19", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260422": [],
            }
            for yyyymmdd, rows in rows_by_date.items():
                write_daily_csv(
                    root / f"患者一覧_入所（アルボース医師）_{yyyymmdd}.csv",
                    [sentinel, *rows],
                )

            episodes, _observations, _latest_date = build_episodes(sorted(root.glob("*.csv")))
            death_episode = next(ep for ep in episodes if ep.episode_id == "E_004_20260414")
            death_episode.discharge_destination = "死亡"
            death_episode.discharge_reason = "死亡退院"

            profiles = build_user_profiles(episodes, as_of_date=parse_date("2026/04/22"), alert_days=30)
            contact = next(profile for profile in profiles if profile.user_id == "003")
            excluded = next(profile for profile in profiles if profile.user_id == "004")

            self.assertTrue(contact.followup_alert)
            self.assertFalse(contact.followup_excluded)
            self.assertEqual(contact.average_readmission_interval_days, 7)
            self.assertEqual(contact.next_expected_admission_date.isoformat(), "2026-04-28")

            self.assertFalse(excluded.followup_alert)
            self.assertTrue(excluded.followup_excluded)
            self.assertEqual(excluded.exclusion_reason, "死亡退院")

    def test_user_profiles_put_sixty_day_overdue_in_separate_bucket(self):
        first = Episode(
            episode_id="E_005_20260101",
            user_id="005",
            admission_date=parse_date("2026/01/01"),
            discharge_date=parse_date("2026/01/05"),
            last_seen_date=parse_date("2026/01/05"),
            first_absent_date=parse_date("2026/01/06"),
            is_current=False,
            admission_floor="2F",
            latest_floor="2F",
            room="200",
            bed="01",
            admission_type="短期",
            days_to_readmission=None,
        )
        latest = Episode(
            episode_id="E_005_20260115",
            user_id="005",
            admission_date=parse_date("2026/01/15"),
            discharge_date=parse_date("2026/01/20"),
            last_seen_date=parse_date("2026/01/20"),
            first_absent_date=parse_date("2026/01/21"),
            is_current=False,
            admission_floor="2F",
            latest_floor="2F",
            room="200",
            bed="01",
            admission_type="短期",
            days_to_readmission=10,
        )

        profiles = build_user_profiles([first, latest], as_of_date=parse_date("2026/04/01"), alert_days=30)
        profile = profiles[0]

        self.assertEqual(profile.next_expected_admission_date.isoformat(), "2026-01-30")
        self.assertEqual(profile.days_until_expected_admission, -61)
        self.assertFalse(profile.followup_alert)
        self.assertEqual(profile.followup_priority, "別枠")
        self.assertEqual(profile.followup_category, "60日以上超過")

    def test_cli_writes_contact_alert_and_excluded_user_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_dir = root / "input"
            input_dir.mkdir()
            output_dir = root / "output"
            db_path = root / "arbos.sqlite3"
            manual_csv = root / "manual.csv"
            sentinel = {"患者ID": "999", "入院日": "2026/04/01", "部屋": "200", "Bed": "04", "形態": "長期"}
            rows_by_date = {
                "20260401": [{"患者ID": "003", "入院日": "2026/04/01", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260402": [{"患者ID": "003", "入院日": "2026/04/01", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260403": [{"患者ID": "003", "入院日": "2026/04/01", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260404": [],
                "20260405": [{"患者ID": "004", "入院日": "2026/04/05", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260406": [{"患者ID": "004", "入院日": "2026/04/05", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260407": [],
                "20260410": [{"患者ID": "003", "入院日": "2026/04/10", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260411": [{"患者ID": "003", "入院日": "2026/04/10", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260412": [{"患者ID": "003", "入院日": "2026/04/10", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260413": [],
                "20260414": [{"患者ID": "004", "入院日": "2026/04/14", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260415": [{"患者ID": "004", "入院日": "2026/04/14", "部屋": "303", "Bed": "01", "形態": "短期"}],
                "20260416": [],
                "20260419": [{"患者ID": "003", "入院日": "2026/04/19", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260420": [{"患者ID": "003", "入院日": "2026/04/19", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260421": [{"患者ID": "003", "入院日": "2026/04/19", "部屋": "302", "Bed": "01", "形態": "短期"}],
                "20260422": [],
            }
            for yyyymmdd, rows in rows_by_date.items():
                write_daily_csv(
                    input_dir / f"患者一覧_入所（アルボース医師）_{yyyymmdd}.csv",
                    [sentinel, *rows],
                )
            with manual_csv.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(
                    file,
                    fieldnames=[
                        "episode_id",
                        "source_type",
                        "source_name",
                        "discharge_destination",
                        "discharge_reason",
                        "memo",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "episode_id": "E_004_20260414",
                        "discharge_destination": "死亡",
                        "discharge_reason": "死亡退院",
                    }
                )

            result = main(
                [
                    "build",
                    "--input-dir",
                    str(input_dir),
                    "--db",
                    str(db_path),
                    "--output-dir",
                    str(output_dir),
                    "--manual-csv",
                    str(manual_csv),
                    "--as-of",
                    "2026/04/22",
                ]
            )
            self.assertEqual(result, 0)

            with (output_dir / "contact_alerts_next_month.csv").open(encoding="utf-8-sig") as file:
                contact_rows = list(csv.DictReader(file))
            with (output_dir / "excluded_users.csv").open(encoding="utf-8-sig") as file:
                excluded_rows = list(csv.DictReader(file))
            with sqlite3.connect(db_path) as conn:
                counts = (
                    conn.execute("SELECT count(*) FROM contact_alerts").fetchone()[0],
                    conn.execute("SELECT count(*) FROM excluded_users").fetchone()[0],
                )

            self.assertEqual([row["user_id"] for row in contact_rows], ["003"])
            self.assertEqual(excluded_rows[0]["user_id"], "004")
            self.assertEqual(excluded_rows[0]["exclusion_reason"], "死亡退院")
            self.assertEqual(counts, (1, 1))


if __name__ == "__main__":
    unittest.main()
