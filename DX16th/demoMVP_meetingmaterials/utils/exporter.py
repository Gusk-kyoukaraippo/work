from __future__ import annotations

import json
from datetime import datetime
from typing import Dict, List

import pandas as pd


def encode_csv_with_bom(df: pd.DataFrame) -> bytes:
    csv_text = df.to_csv(index=False)
    return ("\ufeff" + csv_text).encode("utf-8")


def build_order_export_df(
    master_items: List[Dict],
    orders: Dict[str, float],
    calculation_results: Dict[str, Dict],
    comments: Dict,
) -> pd.DataFrame:
    rows = []
    comment_map = comments.get("翌々月発注量", {}).get("品目別", {})
    dw309_comment = comments.get("DW-309-Mol", {}).get("決定理由", "")

    for item in master_items:
        item_id = item.get("item_id", "")
        decision_comment = comment_map.get(item_id, "")
        if item_id == "DW-309-Mol":
            decision_comment = dw309_comment

        calc = calculation_results.get(item_id, {})
        rows.append(
            {
                "品目ID": item_id,
                "品目名": item.get("name", ""),
                "発注量": orders.get(item_id, 0),
                "単位": item.get("unit", "kg"),
                "翌々月末在庫予測": calc.get("翌々月末在庫予測", ""),
                "リスクレベル": calc.get("リスクレベル", ""),
                "決定理由": decision_comment,
            }
        )

    return pd.DataFrame(rows)


def build_meeting_comments_df(comments: Dict) -> pd.DataFrame:
    rows = []
    for section, payload in comments.items():
        display_section = "今月翌月見込み" if section == "今月来月見込み" else section
        if section in {"先月振り返り", "今月来月見込み"}:
            rows.append({"セクション": display_section, "カテゴリ": "工場全体", "品目ID": "", "コメント": payload.get("工場全体", "")})
            for item_id, comment in payload.get("品目別", {}).items():
                rows.append(
                    {"セクション": display_section, "カテゴリ": "品目別", "品目ID": item_id, "コメント": comment}
                )
        elif section == "翌々月発注量":
            for item_id, comment in payload.get("品目別", {}).items():
                rows.append(
                    {"セクション": display_section, "カテゴリ": "品目別", "品目ID": item_id, "コメント": comment}
                )
        elif section == "DW-309-Mol":
            rows.append(
                {"セクション": "DW-309-Mol", "カテゴリ": "専用", "品目ID": "", "コメント": payload.get("決定理由", "")}
            )
        else:
            rows.append({"セクション": display_section, "カテゴリ": "", "品目ID": "", "コメント": json.dumps(payload, ensure_ascii=False)})

    return pd.DataFrame(rows)


def build_discussion_items_df(discussion_items: List[Dict]) -> pd.DataFrame:
    if not discussion_items:
        return pd.DataFrame(
            columns=[
                "品目ID",
                "品目名",
                "リスクレベル",
                "要議論理由",
                "翌々月末在庫予測",
                "安全在庫",
                "上限在庫",
            ]
        )

    rows = []
    for item in discussion_items:
        rows.append(
            {
                "品目ID": item.get("品目ID", item.get("品目名", "")),
                "品目名": item.get("品目名", ""),
                "リスクレベル": item.get("リスク", ""),
                "要議論理由": item.get("要議論理由", ""),
                "翌々月末在庫予測": item.get("翌々月末在庫予測", ""),
                "安全在庫": item.get("安全在庫", ""),
                "上限在庫": item.get("上限在庫", ""),
            }
        )

    return pd.DataFrame(rows)


def build_meeting_snapshot(
    comments: Dict,
    orders: Dict[str, float],
    calculation_results: Dict[str, Dict],
    discussion_items: List[Dict],
    meeting_date: str,
    meeting_month: str,
) -> Dict:
    return {
        "会議日時": meeting_date,
        "会議対象月": meeting_month,
        "コメント": comments,
        "発注量": orders,
        "計算結果": calculation_results,
        "要議論品目": discussion_items,
    }


def build_export_filename(prefix: str, meeting_date: str) -> str:
    try:
        dt = datetime.fromisoformat(meeting_date)
    except ValueError:
        dt = datetime.now()
    return f"{prefix}_{dt.strftime('%Y%m%d')}.csv"
