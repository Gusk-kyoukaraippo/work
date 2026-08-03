from __future__ import annotations

from typing import Dict

import pandas as pd


def calculate_prediction_accuracy(monthly_data: Dict, last_month: str = "2025-12") -> pd.DataFrame:
    results = []
    month_payload = monthly_data.get(last_month, {})
    previous_month = "2025-11"

    for item_id, data in month_payload.items():
        start_stock = monthly_data.get(previous_month, {}).get(item_id, {}).get("在庫", 0)
        incoming = data.get("入庫", 0)
        predicted_stock = data.get("予測在庫", 0)
        actual_stock = data.get("在庫", 0)

        predicted_usage = start_stock + incoming - predicted_stock
        actual_usage = start_stock + incoming - actual_stock
        diff = actual_usage - predicted_usage
        error_rate = (diff / predicted_usage * 100) if predicted_usage != 0 else 0
        results.append(
            {
                "品目": item_id,
                "予測出庫": predicted_usage,
                "実績出庫": actual_usage,
                "差分": diff,
                "誤差率(%)": round(error_rate, 1),
                "予測在庫": predicted_stock,
                "実績在庫": actual_stock,
            }
        )

    return pd.DataFrame(results)


def style_accuracy_dataframe(df: pd.DataFrame) -> pd.io.formats.style.Styler:
    def highlight_row(row: pd.Series) -> list[str]:
        error_rate = row.get("誤差率(%)", 0)
        if error_rate >= 20:
            color = "#ffebee"
        elif error_rate >= 10:
            color = "#fff8e1"
        else:
            color = "#ffffff"
        return [f"background-color: {color}"] * len(row)

    numeric_columns = [col for col in df.columns if col != "品目"]
    styler = df.style.format({"誤差率(%)": "{:.1f}"}, subset=["誤差率(%)"])
    styler = styler.format("{:.0f}", subset=[col for col in numeric_columns if col != "誤差率(%)"])
    styler = styler.apply(highlight_row, axis=1)
    styler = styler.set_properties(**{"text-align": "right", "color": "#1b1b1b"})
    styler = styler.set_properties(
        subset=["品目"],
        **{"text-align": "left", "color": "#1b1b1b"},
    )
    return styler
