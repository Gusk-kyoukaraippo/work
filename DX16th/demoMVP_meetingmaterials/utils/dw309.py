from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Tuple

from dateutil.relativedelta import relativedelta
import pandas as pd


def _month_range(start_month: str, months_ahead: int) -> List[str]:
    start = datetime.strptime(start_month, "%Y-%m")
    return [
        (start + relativedelta(months=offset)).strftime("%Y-%m")
        for offset in range(months_ahead + 1)
    ]


def calculate_usage_average(monthly_data: Dict, item_id: str) -> float:
    candidates = []
    for month in ("2026-01", "2026-02", "2026-03"):
        value = monthly_data.get(month, {}).get(item_id, {}).get("使用量予測")
        if value is not None:
            candidates.append(value)
    if not candidates:
        for month in ("2025-10", "2025-11", "2025-12"):
            value = monthly_data.get(month, {}).get(item_id, {}).get("出庫")
            if value is not None:
                candidates.append(value)
    if not candidates:
        return 0
    return sum(candidates) / len(candidates)


def calculate_prediction_error(monthly_data: Dict, item_id: str) -> float | None:
    errors = []
    for month, payload in monthly_data.items():
        item_payload = payload.get(item_id, {})
        if "予測在庫" in item_payload and "在庫" in item_payload:
            predicted = item_payload.get("予測在庫", 0)
            actual = item_payload.get("在庫", 0)
            if predicted:
                errors.append(abs(actual - predicted) / predicted * 100)
    if not errors:
        return None
    errors = errors[-3:]
    return sum(errors) / len(errors)


def build_dw309_forecast(
    monthly_data: Dict,
    item_id: str,
    current_stock: float,
    safety_stock: float,
    max_stock: float,
    order_qty: float,
    start_month: str = "2026-01",
    months_ahead: int = 7,
) -> Tuple[pd.DataFrame, Dict[str, float]]:
    months = _month_range(start_month, months_ahead)
    usage_avg = calculate_usage_average(monthly_data, item_id)

    rows = []
    month_start = current_stock
    for index, month in enumerate(months):
        payload = monthly_data.get(month, {}).get(item_id, {})
        if month == "2026-01":
            incoming = payload.get("入荷見込み", 0)
            usage = payload.get("使用量予測", usage_avg)
        elif month == "2026-02":
            incoming = payload.get("手配済み", 0)
            usage = payload.get("使用量予測", usage_avg)
        elif month == "2026-03":
            incoming = payload.get("入庫", 0)
            usage = payload.get("使用量予測", usage_avg)
        else:
            incoming = payload.get("入庫", 0)
            usage = payload.get("使用量予測", usage_avg)

        if index == len(months) - 1:
            incoming += order_qty

        month_end = month_start + incoming - usage

        if month_end < 0:
            status = "🔴欠品"
        elif month_end < safety_stock:
            status = "🔴危険"
        elif month_end > max_stock:
            status = "🟠過剰"
        else:
            status = "✅適正"

        rows.append(
            {
                "月": month,
                "月初在庫": round(month_start, 1),
                "入庫🔒": round(incoming, 1),
                "使用📊": round(usage, 1),
                "月末📊": round(month_end, 1),
                "状態": status,
            }
        )
        month_start = month_end

    df = pd.DataFrame(rows)
    summary = {
        "usage_avg": usage_avg,
        "final_month_end": month_start,
        "final_month": months[-1],
    }
    return df, summary


def style_dw309_forecast(df: pd.DataFrame, safety_stock: float, max_stock: float) -> pd.io.formats.style.Styler:
    def highlight_row(row: pd.Series) -> list[str]:
        month_end = row.get("月末📊", 0)
        if month_end < safety_stock:
            color = "#ffebee"
        elif month_end > max_stock:
            color = "#fff3e0"
        else:
            color = "#ffffff"
        return [f"background-color: {color}"] * len(row)

    styler = df.style.apply(highlight_row, axis=1)
    styler = styler.set_properties(**{"text-align": "right", "color": "#1b1b1b"})
    styler = styler.set_properties(subset=["月", "状態"], **{"text-align": "left", "color": "#1b1b1b"})
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
            }
        ],
        overwrite=False,
    )
    return styler
