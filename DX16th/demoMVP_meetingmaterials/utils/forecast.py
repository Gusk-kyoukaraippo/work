from __future__ import annotations

from typing import Dict, List

import pandas as pd


def calculate_inventory_forecast(monthly_data: Dict, master_items: List[Dict]) -> pd.DataFrame:
    results = []
    for item in master_items:
        item_id = item["item_id"]
        current_data = monthly_data["2026-01"][item_id]
        next_data = monthly_data["2026-02"][item_id]

        current_stock = current_data["現在庫"]
        incoming = current_data["入荷見込み"]
        usage_current = current_data["使用量予測"]
        month_end_forecast = current_stock + incoming - usage_current

        prepared = next_data["手配済み"]
        usage_next = next_data["使用量予測"]
        next_month_end_forecast = month_end_forecast + prepared - usage_next

        results.append(
            {
                "品目名": item_id,
                "現在庫": current_stock,
                "入荷見込み": incoming,
                "今月使用予測": usage_current,
                "今月末予測": month_end_forecast,
                "手配済み": prepared,
                "来月使用予測": usage_next,
                "来月末予測": next_month_end_forecast,
                "安全在庫": item["safety_stock"],
                "上限在庫": item["max_stock"],
            }
        )

    return pd.DataFrame(results)


def style_forecast_dataframe(df: pd.DataFrame, locked_columns: List[str], forecast_columns: List[str]) -> pd.io.formats.style.Styler:
    def highlight_column(column: pd.Series) -> List[str]:
        if column.name in locked_columns:
            color = "#e3f2fd"
        elif column.name in forecast_columns:
            color = "#fff3e0"
        else:
            color = "#ffffff"
        return [f"background-color: {color}"] * len(column)

    numeric_columns = [col for col in df.columns if col != "品目名"]
    styler = df.style.format("{:.0f}", subset=numeric_columns)
    styler = styler.apply(highlight_column, axis=0)
    styler = styler.set_properties(**{"text-align": "right", "color": "#1b1b1b"})
    styler = styler.set_properties(
        subset=["品目名"],
        **{"text-align": "left", "color": "#1b1b1b"},
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
            }
        ],
        overwrite=False,
    )
    return styler
