"""溶材会議 注文量決定支援アプリ（Phase 1）。"""

from datetime import datetime

import pandas as pd
import streamlit as st

from data.master import MASTER_ITEMS
from data.sample_data import (
    CURRENT_MONTH_DATA,
    HISTORICAL_DATA,
    LAST_MONTH_DATA,
    LONG_TERM_FORECAST,
    NEXT_MONTH_FORECAST,
)
from utils.calculations import (
    assess_current_risk,
    assess_risk,
    calculate_forecast_error,
    calculate_mape,
    calculate_long_term_inventory,
    calculate_order_deadline,
    calculate_recommended_range,
    calculate_risk_summary,
    calculate_stockout_month,
    detect_anomalies,
    find_stockout_month,
)
from utils.visualizations import (
    create_inventory_trend_chart,
    create_shipment_trend_chart,
    create_stock_trend_chart,
    create_timeline_chart,
)

TITLE = "溶材会議 注文量決定支援アプリ"
NEXT_MONTH_LABEL = "来月（2026年2月）の注文量決定"

# 単位に応じた入力ステップ
UNIT_STEP = {
    "トン": 1.0,
    "kg": 5.0,
    "L": 10.0,
    "箱": 1.0,
}

COLOR_MAP = {
    "red": ("🔴", "#c62828"),
    "orange": ("🟠", "#ef6c00"),
    "green": ("🟢", "#2e7d32"),
}
BADGE_MAP = {"red": "🔴", "orange": "🟠", "green": "🟢"}


st.set_page_config(page_title=TITLE, layout="wide")
st.title(TITLE)

current_by_id = {item["item_id"]: item for item in CURRENT_MONTH_DATA["items"]}
forecast_by_id = {
    item["item_id"]: item for item in NEXT_MONTH_FORECAST["forecasted_shipments"]
}

tab_next, tab_current, tab_prev, tab_history, tab_lt6 = st.tabs(
    ["来月", "今月", "先月", "これまで", "6ヶ月LT品"]
)

with tab_next:
    st.header(NEXT_MONTH_LABEL)

    # 一覧テーブルの構築
    table_rows = []
    for item in MASTER_ITEMS:
        item_id = item["id"]
        current = current_by_id[item_id]
        forecast = forecast_by_id[item_id]
        table_rows.append(
            {
                "品目名": item["name"],
                "単位": item["unit"],
                "現在庫": current["current_stock"],
                "安全在庫": item["safety_stock"],
                "上限在庫": item["max_stock"],
                "来月出庫予測": forecast["amount"],
            }
        )

    st.subheader("品目一覧")
    st.dataframe(pd.DataFrame(table_rows), use_container_width=True, hide_index=True)

    st.subheader("注文量入力とリスク判定")
    for item in MASTER_ITEMS:
        item_id = item["id"]
        current = current_by_id[item_id]
        forecast = forecast_by_id[item_id]

        current_stock = current["current_stock"]
        forecasted_shipment = forecast["amount"]

        min_order, max_order = calculate_recommended_range(
            item, current_stock, forecasted_shipment
        )
        default_order = (min_order + max_order) / 2
        step = UNIT_STEP.get(item["unit"], 1.0)

        with st.expander(f"{item['name']} ({item['unit']})", expanded=True):
            col1, col2, col3 = st.columns(3)
            col1.metric("現在庫", f"{current_stock} {item['unit']}")
            col2.metric("来月出庫予測", f"{forecasted_shipment} {item['unit']}")
            col3.metric("推奨レンジ", f"[{min_order:.0f}-{max_order:.0f}]")

            order_amount = st.number_input(
                f"注文量 ({item['unit']})",
                min_value=0.0,
                value=float(default_order),
                step=float(step),
                key=f"order_{item_id}",
            )

            risk = assess_risk(
                order_amount,
                current_stock,
                forecasted_shipment,
                item["safety_stock"],
                item["max_stock"],
            )

            emoji, color = COLOR_MAP[risk["color"]]
            st.markdown(
                (
                    f"<div style='font-size: 1.1rem;'>"
                    f"{emoji} 予測在庫: <strong>{risk['stock']:.1f} {item['unit']}</strong>"
                    f" → <span style='color:{color}; font-weight:700;'>{risk['level']}</span>"
                    f"</div>"
                ),
                unsafe_allow_html=True,
            )

with tab_current:
    st.header("📊 今月（現状把握）")

    summary = calculate_risk_summary(CURRENT_MONTH_DATA["items"], MASTER_ITEMS)
    col1, col2, col3 = st.columns(3)
    col1.metric("🔴 欠品リスク", f"{summary['shortage']}件")
    col2.metric("🟠 過剰在庫", f"{summary['excess']}件")
    col3.metric("🟢 適正在庫", f"{summary['ok']}件")

    st.divider()

    lt_item = current_by_id["M005"]
    lt_master = next(item for item in MASTER_ITEMS if item["id"] == "M005")
    lt_risk = assess_current_risk(
        lt_item["current_stock"], lt_master["safety_stock"], lt_master["max_stock"]
    )
    lt_forecast = forecast_by_id["M005"]["amount"]
    lt_stockout = calculate_stockout_month(
        lt_item["current_stock"], lt_forecast, lt_master["safety_stock"]
    )
    if lt_stockout is None:
        lt_stockout_label = "計算不可"
    elif lt_stockout == 0:
        lt_stockout_label = "⚠️ 既に欠品リスク"
    elif lt_stockout < 3:
        lt_stockout_label = f"⚠️ {lt_stockout}ヶ月後"
    else:
        lt_stockout_label = f"{lt_stockout}ヶ月後"

    with st.expander("⚠️ 重要品目（6ヶ月リードタイム品）", expanded=True):
        col_left, col_right = st.columns([2, 1])
        with col_left:
            st.write(f"**品目**: {lt_master['name']}")
            st.write(
                f"**現在庫**: {lt_item['current_stock']} {lt_master['unit']}"
            )
            st.write(
                f"**安全在庫**: {lt_master['safety_stock']} {lt_master['unit']}"
            )
            st.write(f"**底打ち月**: {lt_stockout_label}")
        with col_right:
            st.write(f"**リスク**: {BADGE_MAP[lt_risk['color']]} {lt_risk['level']}")
            st.write(lt_risk["message"])
            st.info("⚠️ 発注には6ヶ月必要です")

    st.divider()

    st.subheader("📋 全品目の在庫状況")
    table_rows = []
    for item in CURRENT_MONTH_DATA["items"]:
        master = next(m for m in MASTER_ITEMS if m["id"] == item["item_id"])
        risk = assess_current_risk(
            item["current_stock"], master["safety_stock"], master["max_stock"]
        )
        forecast_amount = forecast_by_id[item["item_id"]]["amount"]
        stockout_month = calculate_stockout_month(
            item["current_stock"], forecast_amount, master["safety_stock"]
        )
        if stockout_month is None:
            stockout_text = "計算不可"
        elif stockout_month == 0:
            stockout_text = "⚠️ 既に欠品リスク"
        elif stockout_month < 3:
            stockout_text = f"⚠️ {stockout_month}ヶ月後"
        else:
            stockout_text = f"{stockout_month}ヶ月後"

        table_rows.append(
            {
                "品目名": master["name"],
                "単位": master["unit"],
                "現在庫": item["current_stock"],
                "安全在庫": master["safety_stock"],
                "上限在庫": master["max_stock"],
                "リスクレベル": f"{BADGE_MAP[risk['color']]} {risk['level']}",
                "底打ち月": stockout_text,
            }
        )

    st.dataframe(
        pd.DataFrame(table_rows), use_container_width=True, hide_index=True
    )

with tab_prev:
    st.header("📈 先月（振り返り）")

    mape = calculate_mape(LAST_MONTH_DATA["items"])
    over_forecast = 0
    under_forecast = 0
    accurate = 0

    for item in LAST_MONTH_DATA["items"]:
        error = calculate_forecast_error(
            item["forecasted_shipment"], item["actual_shipment"]
        )
        if error["error_rate"] is not None:
            if abs(error["error_rate"]) <= 10:
                accurate += 1
            elif error["difference"] > 0:
                under_forecast += 1
            else:
                over_forecast += 1

    col1, col2, col3, col4 = st.columns(4)
    col1.metric(
        "MAPE",
        f"{mape}%" if mape is not None else "N/A",
        help="10%未満=優秀、20%以上=要改善",
    )
    col2.metric("過大予測", f"{over_forecast}件")
    col3.metric("過小予測", f"{under_forecast}件")
    col4.metric("的中", f"{accurate}件")

    st.divider()

    st.subheader("⚠️ 誤差が大きかった品目（上位3件）")
    items_with_errors = []
    for item in LAST_MONTH_DATA["items"]:
        master = next(m for m in MASTER_ITEMS if m["id"] == item["item_id"])
        error = calculate_forecast_error(
            item["forecasted_shipment"], item["actual_shipment"]
        )
        items_with_errors.append(
            {
                "item": master,
                "data": item,
                "error": error,
                "abs_error": error["abs_error_rate"] or 0,
            }
        )

    items_with_errors.sort(key=lambda x: x["abs_error"], reverse=True)

    for index, entry in enumerate(items_with_errors[:3], 1):
        master = entry["item"]
        data = entry["data"]
        error = entry["error"]
        error_rate = error["error_rate"] or 0
        difference = error["difference"]

        with st.expander(
            f"{index}位: {master['name']} ({error_rate:+.1f}%)",
            expanded=index == 1,
        ):
            col_left, col_right = st.columns(2)
            with col_left:
                st.write(
                    f"**予測**: {data['forecasted_shipment']} {master['unit']}"
                )
                st.write(
                    f"**実績**: {data['actual_shipment']} {master['unit']}"
                )
            with col_right:
                st.write(
                    f"**差分**: {difference:+.0f} {master['unit']}"
                )
                st.write(f"**誤差率**: {error_rate:+.1f}%")
            if data["memo"]:
                st.caption(f"理由: {data['memo']}")
            else:
                st.caption("理由: （記載なし）")

    st.divider()

    st.subheader("📋 先月の予測と実績（誤差率順）")
    table_rows = []
    for entry in items_with_errors:
        master = entry["item"]
        data = entry["data"]
        error = entry["error"]
        error_rate = error["error_rate"]
        if error_rate is None:
            error_text = "N/A"
        else:
            error_text = f"{error_rate:+.1f}%"

        table_rows.append(
            {
                "品目名": master["name"],
                "単位": master["unit"],
                "予測値": data["forecasted_shipment"],
                "実績値": data["actual_shipment"],
                "差分": f"{error['difference']:+.0f}",
                "誤差率(%)": error_text,
                "外れ理由メモ": data["memo"] or "",
            }
        )

    st.dataframe(
        pd.DataFrame(table_rows), use_container_width=True, hide_index=True
    )

with tab_history:
    st.header("📊 これまで（履歴）")
    st.subheader("🔍 表示品目の選択")

    item_options = {item["id"]: item["name"] for item in MASTER_ITEMS}
    col_left, col_right = st.columns([3, 1])
    with col_left:
        selected_items = st.multiselect(
            "グラフに表示する品目を選択",
            options=list(item_options.keys()),
            default=list(item_options.keys()),
            format_func=lambda x: item_options[x],
        )
    with col_right:
        show_lt6_only = st.checkbox("6ヶ月LT品のみ表示", value=False)
        if show_lt6_only:
            selected_items = ["M005"]

    st.divider()
    st.subheader("📈 出庫量の推移")
    fig_shipment = create_shipment_trend_chart(
        HISTORICAL_DATA, selected_items, MASTER_ITEMS
    )
    st.plotly_chart(fig_shipment, use_container_width=True)

    st.subheader("📦 在庫量の推移")
    fig_stock = create_stock_trend_chart(
        HISTORICAL_DATA, selected_items, MASTER_ITEMS
    )
    st.plotly_chart(fig_stock, use_container_width=True)

    st.divider()
    st.subheader("⚠️ 異常値の検出（前月比±50%以上変動）")
    anomalies = detect_anomalies(HISTORICAL_DATA)
    if not anomalies:
        st.success("異常値は検出されませんでした。")
    else:
        master_map = {item["id"]: item for item in MASTER_ITEMS}
        anomaly_rows = []
        for anomaly in anomalies:
            master = master_map[anomaly["item_id"]]
            anomaly_rows.append(
                {
                    "月": anomaly["month"],
                    "品目名": master["name"],
                    "単位": master["unit"],
                    "前月出庫": anomaly["prev_value"],
                    "当月出庫": anomaly["curr_value"],
                    "変動率(%)": f"{anomaly['change_rate']:+.1f}",
                }
            )
        st.warning("前月比±50%以上の変動が検出されました。")
        st.dataframe(
            pd.DataFrame(anomaly_rows),
            use_container_width=True,
            hide_index=True,
        )

with tab_lt6:
    st.header("⚠️ 6ヶ月LT品（特殊鋼材）")

    master = next(item for item in MASTER_ITEMS if item["id"] == "M005")
    current_month = "2026-01"

    st.warning("⚠️ この品目は発注から入庫まで6ヶ月かかります")
    col1, col2, col3 = st.columns(3)
    col1.metric("現在庫", f"{LONG_TERM_FORECAST['current_stock']} {master['unit']}")
    col2.metric("安全在庫", f"{master['safety_stock']} {master['unit']}")
    col3.metric("発注残", f"{len(LONG_TERM_FORECAST['pending_orders'])}件")

    st.divider()

    inventory_results = calculate_long_term_inventory(
        LONG_TERM_FORECAST["current_stock"],
        LONG_TERM_FORECAST["forecasts"],
        LONG_TERM_FORECAST["pending_orders"],
        master["safety_stock"],
        master["max_stock"],
    )
    stockout_info = find_stockout_month(inventory_results, master["safety_stock"])
    deadline = None
    months_until_deadline = None
    if stockout_info:
        deadline = calculate_order_deadline(stockout_info["month"], lead_time_months=6)
        if deadline:
            now = datetime.strptime(current_month, "%Y-%m")
            deadline_date = datetime.strptime(deadline, "%Y-%m")
            months_until_deadline = (
                (deadline_date.year - now.year) * 12
                + (deadline_date.month - now.month)
            )

    if deadline is None:
        st.success("安全在庫を下回る予測がないため、発注期限は発生していません。")
    elif months_until_deadline is not None and months_until_deadline <= 0:
        st.error(
            f"🚨 今打たないと間に合いません。発注期限: {deadline}（期限超過）"
        )
    elif months_until_deadline is not None and months_until_deadline <= 2:
        st.error(
            f"🚨 今すぐ発注が必要です。発注期限: {deadline}（あと{months_until_deadline}ヶ月）"
        )
    elif months_until_deadline is not None and months_until_deadline <= 4:
        st.warning(
            f"⚠️ 発注を検討してください。発注期限: {deadline}（あと{months_until_deadline}ヶ月）"
        )
    else:
        st.info(f"発注期限: {deadline}")

    st.subheader("📋 6ヶ月先の予測在庫")
    risk_label = {"shortage": "🔴 欠品", "excess": "🟠 過剰", "ok": "🟢 適正"}
    table_rows = []
    for result in inventory_results:
        table_rows.append(
            {
                "月": result["month"],
                "期首在庫": result["opening_stock"],
                "入庫": result["incoming"],
                "出庫予測": result["shipment"],
                "期末在庫": result["closing_stock"],
                "リスク": risk_label[result["risk_level"]],
            }
        )
    st.dataframe(
        pd.DataFrame(table_rows), use_container_width=True, hide_index=True
    )

    st.subheader("📈 予測在庫推移")
    fig_inventory = create_inventory_trend_chart(
        inventory_results, master["safety_stock"], master["max_stock"]
    )
    st.plotly_chart(fig_inventory, use_container_width=True)

    st.subheader("🧭 発注タイムライン")
    fig_timeline = create_timeline_chart(
        current_month,
        LONG_TERM_FORECAST["pending_orders"],
        stockout_info,
        deadline,
    )
    st.plotly_chart(fig_timeline, use_container_width=True)
