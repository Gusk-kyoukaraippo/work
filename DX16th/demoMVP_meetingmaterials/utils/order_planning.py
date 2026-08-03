from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd


def calculate_normal_order_average(monthly_data: Dict, item_id: str) -> float:
    values = []
    for month in ("2025-09", "2025-10", "2025-11", "2025-12"):
        values.append(monthly_data.get(month, {}).get(item_id, {}).get("入庫", 0))
    values.append(monthly_data.get("2026-01", {}).get(item_id, {}).get("入荷見込み", 0))
    values.append(monthly_data.get("2026-02", {}).get(item_id, {}).get("手配済み", 0))
    cleaned = [value for value in values if value is not None]
    if not cleaned:
        return 0
    return sum(cleaned) / len(cleaned)


def calculate_usage_average(monthly_data: Dict, item_id: str, months: List[str]) -> float:
    values = []
    for month in months:
        values.append(monthly_data.get(month, {}).get(item_id, {}).get("出庫", 0))
    cleaned = [value for value in values if value is not None]
    if not cleaned:
        return 0
    return sum(cleaned) / len(cleaned)


def calculate_future_inventory(
    next_month_end: float,
    order_qty: float,
    next_next_usage: float,
) -> float:
    return next_month_end + order_qty - next_next_usage


def risk_level(next_next_end: float, safety_stock: float, max_stock: float) -> str:
    if next_next_end < safety_stock:
        return "欠品"
    if next_next_end > max_stock:
        return "過剰"
    return "適正"


def build_order_dataframe(
    master_items: List[Dict],
    monthly_data: Dict,
    next_month_forecast: Dict[str, float],
    orders: Dict[str, float],
) -> pd.DataFrame:
    rows = []
    for item in master_items:
        item_id = item["item_id"]
        next_month_end = next_month_forecast.get(item_id, 0)
        next_next_usage = monthly_data.get("2026-03", {}).get(item_id, {}).get("使用量予測", 0)
        order_qty = orders.get(item_id, 0)
        next_next_end = calculate_future_inventory(next_month_end, order_qty, next_next_usage)
        rows.append(
            {
                "品目名": item_id,
                "来月末在庫予測": next_month_end,
                "翌々月使用量予測": next_next_usage,
                "発注量": order_qty,
                "翌々月末在庫予測": next_next_end,
                "安全在庫": item["safety_stock"],
                "上限在庫": item["max_stock"],
            }
        )
    return pd.DataFrame(rows)


def discussion_reasons(
    row: pd.Series,
    normal_order_avg: float,
    next_month_buffer: float,
    factor: float,
) -> Tuple[int, List[str]]:
    reasons = []
    priority = 99
    next_next_end = row["翌々月末在庫予測"]
    safety_stock = row["安全在庫"]
    max_stock = row["上限在庫"]
    order_qty = row["発注量"]

    if next_next_end < safety_stock:
        reasons.append("翌々月末在庫が安全在庫を下回る")
        priority = min(priority, 1)
    if next_next_end > max_stock:
        reasons.append("翌々月末在庫過剰")
        priority = min(priority, 2)

    if normal_order_avg > 0:
        if order_qty == 0 or order_qty >= normal_order_avg * 2:
            reasons.append("発注量異常")
            priority = min(priority, 3)
    elif order_qty == 0:
        reasons.append("発注量異常")
        priority = min(priority, 3)

    if next_month_buffer < safety_stock * factor:
        reasons.append("翌月末在庫が安全在庫×係数を下回る")
        priority = min(priority, 3)

    if priority == 99:
        priority = 4
    return priority, reasons
