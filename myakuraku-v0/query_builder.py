"""Build PubMed queries from config."""
from __future__ import annotations

from typing import List

from models import AppConfig, DepartmentConfig, UniversityConfig


def _or_terms(terms: List[str], field: str) -> str:
    if not terms:
        return ""
    escaped = [f'"{t}"[{field}]' for t in terms]
    return "(" + " OR ".join(escaped) + ")"


def build_topic_query(cfg: AppConfig) -> str:
    mesh = _or_terms(cfg.topic.mesh_terms, "MeSH Terms") if cfg.topic.mesh_terms else ""
    tiab = _or_terms(cfg.topic.tiab_terms, "Title/Abstract") if cfg.topic.tiab_terms else ""
    if mesh and tiab:
        return f"({mesh} OR {tiab})"
    return mesh or tiab or ""


def build_affiliation_query(univ: UniversityConfig, dept: DepartmentConfig) -> str:
    univ_part = _or_terms(univ.affiliation_aliases, "AD")
    dept_part = _or_terms(dept.affiliation_terms, "AD")
    parts = [p for p in [univ_part, dept_part] if p]
    if not parts:
        return ""
    return "(" + " AND ".join(parts) + ")"


def build_pubtype_query(cfg: AppConfig) -> str:
    include = _or_terms(cfg.pub_types.include, "Publication Type")
    exclude = _or_terms(cfg.pub_types.exclude, "Publication Type")
    if include and exclude:
        return f"({include} NOT {exclude})"
    if include:
        return include
    if exclude:
        return f"NOT {exclude}"
    return ""


def build_language_query(cfg: AppConfig) -> str:
    if not cfg.language_filter.enabled:
        return ""
    return f'"{cfg.language_filter.language}"[Language]'


def build_query(univ: UniversityConfig, dept: DepartmentConfig, cfg: AppConfig) -> str:
    parts = [
        build_affiliation_query(univ, dept),
        build_topic_query(cfg),
        build_pubtype_query(cfg),
        build_language_query(cfg),
    ]
    parts = [p for p in parts if p]
    return " AND ".join(parts)
