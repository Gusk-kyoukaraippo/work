from __future__ import annotations

import sqlite3
from dataclasses import dataclass


DB_PATH = "data/cache.sqlite"


@dataclass
class RunRecord:
    run_id: str
    computed_at: str
    if_policy: str
    notes: str


def connect(db_path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            computed_at TEXT,
            if_policy TEXT,
            notes TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS agg_year_univ_dept (
            run_id TEXT,
            year INTEGER,
            university_id TEXT,
            department_id TEXT,
            paper_count INTEGER,
            total_if REAL,
            unknown_if_count INTEGER,
            PRIMARY KEY (run_id, year, university_id, department_id)
        )
        """
    )
    conn.commit()


def insert_run(conn: sqlite3.Connection, run: RunRecord) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO runs (run_id, computed_at, if_policy, notes) VALUES (?, ?, ?, ?)",
        (run.run_id, run.computed_at, run.if_policy, run.notes),
    )
    conn.commit()


def upsert_agg(
    conn: sqlite3.Connection,
    run_id: str,
    year: int,
    university_id: str,
    department_id: str,
    paper_count: int,
    total_if: float,
    unknown_if_count: int,
) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO agg_year_univ_dept
            (run_id, year, university_id, department_id, paper_count, total_if, unknown_if_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (run_id, year, university_id, department_id, paper_count, total_if, unknown_if_count),
    )
    conn.commit()
    saved = conn.execute(
        """
        SELECT paper_count, total_if FROM agg_year_univ_dept
        WHERE run_id = ? AND year = ? AND university_id = ? AND department_id = ?
        """,
        (run_id, year, university_id, department_id),
    ).fetchone()
    if saved:
        print(
            "[DEBUG] Saved and verified: "
            f"paper_count={int(saved['paper_count'])}, total_if={float(saved['total_if'])}"
        )


def get_latest_run_id(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        "SELECT run_id FROM runs ORDER BY computed_at DESC LIMIT 1"
    ).fetchone()
    return row["run_id"] if row else None


def get_available_years(conn: sqlite3.Connection, run_id: str) -> list[int]:
    rows = conn.execute(
        """
        SELECT DISTINCT year FROM agg_year_univ_dept
        WHERE run_id = ?
        ORDER BY year
        """,
        (run_id,),
    ).fetchall()
    return [int(row["year"]) for row in rows]


def get_agg_for_year(
    conn: sqlite3.Connection, run_id: str, year: int, department_id: str
) -> dict[str, sqlite3.Row]:
    rows = conn.execute(
        """
        SELECT university_id, paper_count, total_if, unknown_if_count
        FROM agg_year_univ_dept
        WHERE run_id = ? AND year = ? AND department_id = ?
        """,
        (run_id, year, department_id),
    ).fetchall()
    return {row["university_id"]: row for row in rows}


def get_latest_agg(
    conn: sqlite3.Connection, year: int, university_id: str, department_id: str
) -> sqlite3.Row | None:
    row = conn.execute(
        """
        SELECT a.paper_count, a.total_if, a.unknown_if_count
        FROM agg_year_univ_dept a
        JOIN runs r ON r.run_id = a.run_id
        WHERE a.year = ? AND a.university_id = ? AND a.department_id = ?
        ORDER BY r.computed_at DESC
        LIMIT 1
        """,
        (year, university_id, department_id),
    ).fetchone()
    return row
