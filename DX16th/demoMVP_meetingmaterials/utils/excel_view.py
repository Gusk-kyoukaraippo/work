from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd

ITEM_COLUMN = ("品目", "品目名")

MONTH_COLUMN_LABELS: Dict[str, Tuple[str, str, str]] = {
    "2025-09": ("入庫", "出庫", "在庫"),
    "2025-10": ("入庫", "出庫", "在庫"),
    "2025-11": ("入庫", "出庫", "在庫"),
    "2025-12": ("入庫", "出庫", "在庫"),
    "2026-01": ("入荷見込み", "-", "-"),
    "2026-02": ("手配済み", "-", "-"),
    "2026-03": ("発注予定", "-", "-"),
}

MONTH_CATEGORIES: Dict[str, str] = {
    "2025-09": "past",
    "2025-10": "past",
    "2025-11": "past",
    "2025-12": "past",
    "2026-01": "current",
    "2026-02": "next",
    "2026-03": "future",
}

CATEGORY_COLORS = {
    "past": "#f0f4f8",
    "current": "#e3f2fd",
    "next": "#e8f5e9",
    "future": "#fff8e1",
}


def _ordered_months(monthly_data: Dict[str, Dict]) -> List[str]:
    months = [month for month in MONTH_COLUMN_LABELS if month in monthly_data]
    if months:
        return months
    return sorted(monthly_data.keys())


def _column_name(month: str, label: str) -> tuple[str, str]:
    return (month, label)


def _value_for_label(month: str, label: str, item_payload: Dict[str, int]) -> int | None:
    if label.startswith("-"):
        return None
    if month == "2026-03" and label == "発注予定":
        return item_payload.get("使用量予測")
    return item_payload.get(label)


def create_excel_style_dataframe(
    master_items: List[Dict],
    monthly_data: Dict[str, Dict],
) -> Tuple[pd.DataFrame, Dict[tuple[str, str], str]]:
    months = _ordered_months(monthly_data)
    column_months: Dict[tuple[str, str], str] = {}
    columns: List[tuple[str, str]] = [ITEM_COLUMN]

    for month in months:
        labels = MONTH_COLUMN_LABELS.get(month, ("-", "-", "-"))
        dash_count = 0
        for label in labels:
            label_display = label
            if label == "-":
                dash_count += 1
                label_display = " " * dash_count
            column = _column_name(month, label_display)
            columns.append(column)
            column_months[column] = month

    rows: List[Dict[str, int | str | None]] = []
    for item in sorted(master_items, key=lambda item: item.get("item_id", "")):
        item_id = item.get("item_id", "")
        row: Dict[tuple[str, str], int | str | None] = {ITEM_COLUMN: item_id}
        for month in months:
            item_payload = monthly_data.get(month, {}).get(item_id, {})
            labels = MONTH_COLUMN_LABELS.get(month, ("-", "-", "-"))
            dash_count = 0
            for label in labels:
                label_display = label
                if label == "-":
                    dash_count += 1
                    label_display = " " * dash_count
                column = _column_name(month, label_display)
                row[column] = _value_for_label(month, label, item_payload)
        rows.append(row)

    df = pd.DataFrame(rows, columns=columns)
    if not isinstance(df.columns, pd.MultiIndex):
        df.columns = pd.MultiIndex.from_tuples(columns)
    return df, column_months


def _format_value(value: int | float | None) -> str:
    if value is None or pd.isna(value):
        return "-"
    return f"{value:,.0f}"


def style_excel_dataframe(
    df: pd.DataFrame,
    column_months: Dict[tuple[str, str], str],
) -> pd.io.formats.style.Styler:
    item_column = ITEM_COLUMN if ITEM_COLUMN in df.columns else "品目名"
    numeric_columns = [col for col in df.columns if col != item_column]

    def apply_column_color(column: pd.Series) -> List[str]:
        if column.name == item_column:
            return ["background-color: #f7f7f7"] * len(column)
        month = column_months.get(column.name, "")
        category = MONTH_CATEGORIES.get(month)
        color = CATEGORY_COLORS.get(category, "#ffffff")
        return [f"background-color: {color}"] * len(column)

    styler = df.style.format(_format_value, subset=numeric_columns)
    styler = styler.apply(apply_column_color, axis=0)
    if item_column in df.columns:
        styler = styler.set_properties(
            subset=[item_column],
            **{"text-align": "left", "color": "#1b1b1b"},
        )
    styler = styler.set_properties(
        subset=numeric_columns,
        **{"text-align": "right", "color": "#1b1b1b"},
    )
    styler = styler.set_table_styles(
        [
            {
                "selector": "th",
                "props": [
                    ("background-color", "#263238"),
                    ("color", "#ffffff"),
                    ("text-align", "center"),
                    ("font-weight", "600"),
                ],
            },
            {
                "selector": "td",
                "props": [
                    ("border", "1px solid #e0e0e0"),
                ],
            },
        ],
        overwrite=False,
    )
    return styler
