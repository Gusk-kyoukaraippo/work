"""Pipeline for yearly counts and output generation."""
from __future__ import annotations

import csv
import hashlib
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional

import pandas as pd

from models import AppConfig, DepartmentConfig, UniversityConfig
from pubmed_client import PubMedClient
from query_builder import build_query
from storage import CacheDB


def _hash_query(query: str) -> str:
    return hashlib.sha1(query.encode("utf-8")).hexdigest()


def _year_range(start_year: int, end_year: int) -> List[int]:
    return list(range(start_year, end_year + 1))


def _if_weight(cfg: AppConfig) -> float:
    if cfg.if_policy.mode == "constant":
        return float(cfg.if_policy.constant_value)
    return 1.0


def _load_if_table(cfg: AppConfig) -> dict:
    if cfg.if_policy.mode != "csv":
        return {}
    path = cfg.if_policy.csv_path
    if not path:
        return {}
    if not os.path.isabs(path):
        path = os.path.join(cfg.config_dir, path)
    if not os.path.exists(path):
        raise FileNotFoundError(f"IF CSV not found: {path}")
    table = {}
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            journal = (row.get("journal") or "").strip()
            if_value = row.get("if") or row.get("IF") or ""
            if not journal:
                continue
            try:
                table[journal.lower()] = float(if_value)
            except ValueError:
                continue
    return table


def _select_universities(
    universities: List[UniversityConfig],
    selected: Optional[List[str]],
) -> List[UniversityConfig]:
    if not selected:
        return universities
    selected_lower = {s.strip().lower() for s in selected if s.strip()}
    result = []
    for u in universities:
        if u.key.lower() in selected_lower or u.name.lower() in selected_lower:
            result.append(u)
    return result


def _select_departments(
    departments: List[DepartmentConfig],
    selected: Optional[List[str]],
) -> List[DepartmentConfig]:
    if not selected:
        return departments
    selected_lower = {s.strip().lower() for s in selected if s.strip()}
    result = []
    for d in departments:
        if d.key.lower() in selected_lower or d.name.lower() in selected_lower:
            result.append(d)
    return result


def run_pipeline(
    cfg: AppConfig,
    output_dir: str,
    override_start: Optional[int],
    override_end: Optional[int],
    select_universities: Optional[List[str]],
    select_departments: Optional[List[str]],
    no_cache: bool,
) -> Dict[str, str]:
    if not cfg.pubmed.email:
        raise ValueError("pubmed.email is required in config")

    start_year = override_start or cfg.date_range.start_year
    end_year = override_end or cfg.date_range.end_year
    years = _year_range(start_year, end_year)
    universities = _select_universities(cfg.universities, select_universities)
    departments = _select_departments(cfg.departments, select_departments)

    client = PubMedClient(
        email=cfg.pubmed.email,
        tool=cfg.pubmed.tool,
        rps_no_key=cfg.pubmed.rate_limit_rps_no_key,
        rps_with_key=cfg.pubmed.rate_limit_rps_with_key,
    )
    cache = CacheDB(cfg.pubmed.cache_db_path)

    records = []
    weight = _if_weight(cfg)
    if_table = _load_if_table(cfg)
    default_if = float(cfg.if_policy.default_if)

    for dept in departments:
        for u in universities:
            query = build_query(u, dept, cfg)
            query_hash = _hash_query(query)
            for year in years:
                mindate = f"{year}/01/01"
                maxdate = f"{year}/12/31"
                datetype = cfg.date_range.datetype

                if cfg.if_policy.mode == "csv":
                    journal_counts = None if no_cache else cache.get_journal_counts(
                        u.key, year, query_hash, datetype, mindate, maxdate
                    )
                    if journal_counts is not None:
                        logging.info(
                            "Cache hit: %s %s journal counts=%s", u.key, year, len(journal_counts)
                        )
                    else:
                        logging.info("Query[%s]: %s", datetime.utcnow().isoformat(), query)
                        count, webenv, query_key = client.esearch_history(
                            query, mindate, maxdate, datetype
                        )
                        logging.info("Retrieved %s %s count=%s", u.key, year, count)
                        journal_counts = {}
                        if count > 0 and webenv and query_key:
                            batch_size = cfg.pubmed.efetch_batch_size
                            for start in range(0, count, batch_size):
                                journals = client.efetch_journals(
                                    webenv, query_key, start, batch_size
                                )
                                for journal in journals:
                                    journal_counts[journal] = journal_counts.get(journal, 0) + 1
                        cache.set(
                            u.key,
                            year,
                            query_hash,
                            datetype,
                            mindate,
                            maxdate,
                            int(count),
                            datetime.utcnow().isoformat(),
                        )
                        cache.set_journal_counts(
                            u.key,
                            year,
                            query_hash,
                            datetype,
                            mindate,
                            maxdate,
                            journal_counts,
                            datetime.utcnow().isoformat(),
                        )

                    count = sum(journal_counts.values())
                    weighted = 0.0
                    for journal, j_count in journal_counts.items():
                        key = journal.lower()
                        weighted += float(j_count) * float(if_table.get(key, default_if))
                else:
                    cached = None if no_cache else cache.get(
                        u.key, year, query_hash, datetype, mindate, maxdate
                    )
                    if cached is not None:
                        count = cached
                        logging.info("Cache hit: %s %s count=%s", u.key, year, count)
                    else:
                        logging.info("Query[%s]: %s", datetime.utcnow().isoformat(), query)
                        count = client.esearch_count(query, mindate, maxdate, datetype)
                        logging.info("Retrieved %s %s count=%s", u.key, year, count)
                        cache.set(
                            u.key,
                            year,
                            query_hash,
                            datetype,
                            mindate,
                            maxdate,
                            count,
                            datetime.utcnow().isoformat(),
                        )
                    weighted = float(count) * weight

                records.append(
                    {
                        "year": year,
                        "department": dept.name,
                        "university": u.name,
                        "paper_count": int(count),
                        "weighted_count": float(weighted),
                    }
                )

    df = pd.DataFrame.from_records(records)
    by_year_path = f"{output_dir}/results_by_university_year.csv"
    pivot_path = f"{output_dir}/results_pivot.csv"

    df.to_csv(by_year_path, index=False)
    pivot_source = (
        df.groupby(["year", "university"], as_index=False)[["paper_count"]].sum()
    )
    pivot = pivot_source.pivot_table(
        index="year", columns="university", values="paper_count", fill_value=0
    )
    pivot.to_csv(pivot_path)

    return {
        "by_year_csv": by_year_path,
        "pivot_csv": pivot_path,
    }
