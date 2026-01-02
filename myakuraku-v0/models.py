"""Data models and config parsing."""
from __future__ import annotations

from dataclasses import dataclass
import os
from typing import List, Optional
import yaml


@dataclass
class TopicConfig:
    mesh_terms: List[str]
    tiab_terms: List[str]


@dataclass
class DepartmentConfig:
    key: str
    name: str
    affiliation_terms: List[str]


@dataclass
class UniversityConfig:
    key: str
    name: str
    affiliation_aliases: List[str]


@dataclass
class DateRangeConfig:
    start_year: int
    end_year: int
    datetype: str


@dataclass
class PubTypesConfig:
    include: List[str]
    exclude: List[str]


@dataclass
class LanguageFilterConfig:
    enabled: bool
    language: str


@dataclass
class IFPolicyConfig:
    mode: str
    constant_value: float
    csv_path: str
    default_if: float


@dataclass
class PubMedConfig:
    email: str
    tool: str
    rate_limit_rps_no_key: int
    rate_limit_rps_with_key: int
    cache_db_path: str
    efetch_batch_size: int


@dataclass
class AppConfig:
    config_dir: str
    topic: TopicConfig
    departments: List[DepartmentConfig]
    universities: List[UniversityConfig]
    date_range: DateRangeConfig
    pub_types: PubTypesConfig
    language_filter: LanguageFilterConfig
    if_policy: IFPolicyConfig
    pubmed: PubMedConfig


def _get_list(data, key: str) -> List[str]:
    return list(data.get(key, []) or [])


def load_config(path: str) -> AppConfig:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    topic = data.get("topic", {})
    department = data.get("department", {})
    departments_data = data.get("departments", [])
    date_range = data.get("date_range", {})
    pub_types = data.get("pub_types", {})
    language_filter = data.get("language_filter", {})
    if_policy = data.get("if_policy", {})
    pubmed = data.get("pubmed", {})

    universities = []
    for u in data.get("universities", []):
        universities.append(
            UniversityConfig(
                key=u.get("key", u.get("name", "")),
                name=u.get("name", ""),
                affiliation_aliases=_get_list(u, "affiliation_aliases"),
            )
        )

    departments = []
    if departments_data:
        for d in departments_data:
            name = d.get("name", "")
            key = d.get("key", name)
            departments.append(
                DepartmentConfig(
                    key=key,
                    name=name,
                    affiliation_terms=_get_list(d, "affiliation_terms"),
                )
            )
    elif department:
        name = department.get("name", "")
        key = department.get("key", name)
        departments.append(
            DepartmentConfig(
                key=key,
                name=name,
                affiliation_terms=_get_list(department, "affiliation_terms"),
            )
        )

    if not departments:
        departments.append(
            DepartmentConfig(key="all", name="All Departments", affiliation_terms=[])
        )

    return AppConfig(
        config_dir=os.path.dirname(path),
        topic=TopicConfig(
            mesh_terms=_get_list(topic, "mesh_terms"),
            tiab_terms=_get_list(topic, "tiab_terms"),
        ),
        departments=departments,
        universities=universities,
        date_range=DateRangeConfig(
            start_year=int(date_range.get("start_year", 2000)),
            end_year=int(date_range.get("end_year", 2000)),
            datetype=date_range.get("datetype", "pdat"),
        ),
        pub_types=PubTypesConfig(
            include=_get_list(pub_types, "include"),
            exclude=_get_list(pub_types, "exclude"),
        ),
        language_filter=LanguageFilterConfig(
            enabled=bool(language_filter.get("enabled", False)),
            language=language_filter.get("language", "English"),
        ),
        if_policy=IFPolicyConfig(
            mode=if_policy.get("mode", "constant"),
            constant_value=float(if_policy.get("constant_value", 1.0)),
            csv_path=if_policy.get("csv_path", ""),
            default_if=float(if_policy.get("default_if", 0.0)),
        ),
        pubmed=PubMedConfig(
            email=pubmed.get("email", ""),
            tool=pubmed.get("tool", "PubMedAffiliationCounter"),
            rate_limit_rps_no_key=int(pubmed.get("rate_limit_rps_no_key", 3)),
            rate_limit_rps_with_key=int(pubmed.get("rate_limit_rps_with_key", 10)),
            cache_db_path=pubmed.get("cache_db_path", "cache.sqlite"),
            efetch_batch_size=int(pubmed.get("efetch_batch_size", 200)),
        ),
    )
