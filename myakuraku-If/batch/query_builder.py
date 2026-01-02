from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


def _term_to_field(term: str, field: str) -> str:
    clean = term.strip()
    if not clean:
        return ""
    if f"[{field}]" in clean:
        return clean
    escaped = clean.replace('"', "\\\"")
    return f'"{escaped}"[{field}]'


def _join_or(terms: Iterable[str]) -> str:
    items = [t for t in (term.strip() for term in terms) if t]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return "(" + " OR ".join(items) + ")"


@dataclass(frozen=True)
class Department:
    id: str
    label_ja: str
    label_en: str
    aff_patterns: list[str]
    aff_exclude_patterns: list[str]
    mesh_terms: list[str]


@dataclass(frozen=True)
class University:
    id: str
    name_ja: str
    name_en: str
    lat: float
    lon: float
    aff_patterns: list[str]
    aff_exclude_patterns: list[str]


def build_aff_query(patterns: list[str], exclude_patterns: list[str], field: str = "AD") -> str:
    included = [_term_to_field(term, field) for term in patterns]
    include_query = _join_or([t for t in included if t])

    excluded = [_term_to_field(term, field) for term in exclude_patterns]
    exclude_query = _join_or([t for t in excluded if t])

    if include_query and exclude_query:
        return f"({include_query}) NOT {exclude_query}"
    if include_query:
        return include_query
    if exclude_query:
        return f"NOT {exclude_query}"
    return ""


def build_year_range(year: int) -> str:
    return f"{year}/01/01:{year}/12/31[DP]"


def build_department_query(department: Department) -> str:
    # Policy B: Affiliation [AD] OR MeSH [MH] for department matching.
    aff_query = build_aff_query(department.aff_patterns, department.aff_exclude_patterns, field="AD")
    mesh_query = _join_or([_term_to_field(term, "MH") for term in department.mesh_terms if term])

    if aff_query and mesh_query:
        return f"({aff_query} OR {mesh_query})"
    if aff_query:
        return aff_query
    if mesh_query:
        return mesh_query
    raise ValueError(
        f"Department {department.id} must define aff_patterns or mesh_terms for query generation."
    )


def build_university_query(university: University) -> str:
    return build_aff_query(university.aff_patterns, university.aff_exclude_patterns, field="AD")


def build_full_query(university: University, department: Department, year: int) -> str:
    university_query = build_university_query(university)
    department_query = build_department_query(department)
    year_query = build_year_range(year)
    parts = [q for q in [university_query, department_query, year_query] if q]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return " AND ".join(f"({part})" for part in parts)
