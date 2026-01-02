"""SQLite cache for PubMed counts."""
from __future__ import annotations

import sqlite3
from typing import Optional


class CacheDB:
    def __init__(self, path: str) -> None:
        self.path = path
        self._init()

    def _init(self) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS counts (
                    university TEXT NOT NULL,
                    year INTEGER NOT NULL,
                    query_hash TEXT NOT NULL,
                    datetype TEXT NOT NULL,
                    mindate TEXT NOT NULL,
                    maxdate TEXT NOT NULL,
                    count INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (university, year, query_hash, datetype, mindate, maxdate)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS journal_counts (
                    university TEXT NOT NULL,
                    year INTEGER NOT NULL,
                    query_hash TEXT NOT NULL,
                    datetype TEXT NOT NULL,
                    mindate TEXT NOT NULL,
                    maxdate TEXT NOT NULL,
                    journal TEXT NOT NULL,
                    count INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (university, year, query_hash, datetype, mindate, maxdate, journal)
                )
                """
            )
            conn.commit()

    def get(
        self,
        university: str,
        year: int,
        query_hash: str,
        datetype: str,
        mindate: str,
        maxdate: str,
    ) -> Optional[int]:
        with sqlite3.connect(self.path) as conn:
            cur = conn.execute(
                """
                SELECT count FROM counts
                WHERE university = ? AND year = ? AND query_hash = ?
                  AND datetype = ? AND mindate = ? AND maxdate = ?
                """,
                (university, year, query_hash, datetype, mindate, maxdate),
            )
            row = cur.fetchone()
            return int(row[0]) if row else None

    def set(
        self,
        university: str,
        year: int,
        query_hash: str,
        datetype: str,
        mindate: str,
        maxdate: str,
        count: int,
        created_at: str,
    ) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO counts
                (university, year, query_hash, datetype, mindate, maxdate, count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (university, year, query_hash, datetype, mindate, maxdate, count, created_at),
            )
            conn.commit()

    def get_journal_counts(
        self,
        university: str,
        year: int,
        query_hash: str,
        datetype: str,
        mindate: str,
        maxdate: str,
    ) -> Optional[dict]:
        with sqlite3.connect(self.path) as conn:
            cur = conn.execute(
                """
                SELECT journal, count FROM journal_counts
                WHERE university = ? AND year = ? AND query_hash = ?
                  AND datetype = ? AND mindate = ? AND maxdate = ?
                """,
                (university, year, query_hash, datetype, mindate, maxdate),
            )
            rows = cur.fetchall()
            if not rows:
                return None
            return {journal: int(count) for journal, count in rows}

    def set_journal_counts(
        self,
        university: str,
        year: int,
        query_hash: str,
        datetype: str,
        mindate: str,
        maxdate: str,
        journal_counts: dict,
        created_at: str,
    ) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO journal_counts
                (university, year, query_hash, datetype, mindate, maxdate, journal, count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        university,
                        year,
                        query_hash,
                        datetype,
                        mindate,
                        maxdate,
                        journal,
                        int(count),
                        created_at,
                    )
                    for journal, count in journal_counts.items()
                ],
            )
            conn.commit()
