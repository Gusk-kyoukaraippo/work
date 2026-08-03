import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from arbos_schedule_extract import (
    ScheduleEvent,
    classify_discharge_event,
    match_events,
    month_label,
    parse_month_arg,
    parse_sheet_month,
    write_events,
)


def sample_event(**overrides):
    values = {
        "event_id": "S_test",
        "service_area": "ユニット",
        "movement_type": "floor_in",
        "scheduled_date": date(2026, 5, 10),
        "schedule_month": "2026-05",
        "weekday": "日",
        "form": "ショート",
        "count": "1",
        "is_new": "",
        "person_name": "山田　太郎",
        "person_name_key": "山田太郎",
        "time_text": "10:00",
        "transport": "迎",
        "place": "自宅",
        "note": "〜12",
        "source_kind": "excel_workbook",
        "source_file": "schedule.xls",
        "sheet_name": "R8.5月",
        "source_row": 5,
        "source_side": "left",
    }
    values.update(overrides)
    return ScheduleEvent(**values)


class ScheduleExtractTest(unittest.TestCase):
    def test_parse_months_from_common_sheet_names(self):
        self.assertEqual(parse_sheet_month("R7.5月"), (2025, 5))
        self.assertEqual(parse_sheet_month("Ｒ6年10月"), (2024, 10))
        self.assertEqual(parse_sheet_month("平成31年4月"), (2019, 4))
        self.assertEqual(parse_month_arg("2025-06"), (2025, 6))
        self.assertEqual(month_label(2025, 6), "2025-06")

    def test_write_events_creates_separate_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "arbos.sqlite3"
            write_events(
                db_path,
                [
                    sample_event(
                        movement_type="floor_out",
                        place="特養「あいの詩」",
                        discharge_destination="特養「あいの詩」",
                        discharge_reason="施設退所",
                        followup_exclusion_reason="施設退所",
                        match_status="not_matched_not_requested",
                    )
                ],
                table_name="floor_schedule_events",
                replace_area_period=True,
                service_area="ユニット",
                start_month=(2026, 5),
                end_month=(2026, 5),
            )

            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    """
                    SELECT service_area, movement_type, scheduled_date, place,
                           discharge_destination, discharge_reason,
                           followup_exclusion_reason, match_status
                    FROM floor_schedule_events
                    """
                ).fetchone()
            self.assertEqual(
                row,
                (
                    "ユニット",
                    "floor_out",
                    "2026-05-10",
                    "特養「あいの詩」",
                    "特養「あいの詩」",
                    "施設退所",
                    "施設退所",
                    "not_matched_not_requested",
                ),
            )

    def test_classify_discharge_event_derives_reason_from_place_and_note(self):
        self.assertEqual(
            classify_discharge_event(
                movement_type="floor_out",
                form="入所",
                place="住宅型有料「つつじヶ丘」",
                note="",
            ),
            ("住宅型有料「つつじヶ丘」", "施設退所", "施設退所"),
        )
        self.assertEqual(
            classify_discharge_event(
                movement_type="floor_out",
                form="入所",
                place="自宅",
                note="退所後は恵風荘入所",
            ),
            ("退所後は恵風荘入所", "施設退所", "施設退所"),
        )
        self.assertEqual(
            classify_discharge_event(
                movement_type="floor_out",
                form="入所",
                place="",
                note="死亡退所",
            ),
            ("死亡", "死亡退所", "死亡退所"),
        )
        self.assertEqual(
            classify_discharge_event(
                movement_type="floor_in",
                form="入所",
                place="特養",
                note="",
            ),
            ("", "", ""),
        )

    def test_match_events_uses_floor_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "arbos.sqlite3"
            daily_dir = root / "daily"
            daily_dir.mkdir()
            (daily_dir / "patients.csv").write_text(
                "患者ID,氏名\n001,山田　太郎\n",
                encoding="cp932",
            )
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE daily_residents (
                        snapshot_date TEXT,
                        user_id TEXT,
                        admission_date TEXT,
                        room TEXT,
                        bed TEXT,
                        floor TEXT,
                        admission_type TEXT
                    )
                    """
                )
                conn.executemany(
                    "INSERT INTO daily_residents VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [
                        ("2026-05-10", "001", "2026-05-10", "U-1", "01", "ユニット", "短期"),
                        ("2026-05-11", "001", "2026-05-10", "U-1", "01", "ユニット", "短期"),
                    ],
                )
                conn.commit()

            matched = match_events(
                [sample_event()],
                db_path=db_path,
                daily_csv_dir=daily_dir,
                tolerance_days=1,
            )
            self.assertEqual(matched[0].matched_user_id, "001")
            self.assertEqual(matched[0].matched_segment_start, "2026-05-10")
            self.assertEqual(matched[0].match_status, "matched_exact")


if __name__ == "__main__":
    unittest.main()
