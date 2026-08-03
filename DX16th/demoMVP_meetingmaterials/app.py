import json
from datetime import datetime
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from utils.data_loader import DataLoader
from utils.dw309 import build_dw309_forecast, calculate_prediction_error, style_dw309_forecast
from utils.exporter import (
    build_discussion_items_df,
    build_export_filename,
    build_meeting_comments_df,
    build_meeting_snapshot,
    build_order_export_df,
    encode_csv_with_bom,
)
from utils.excel_view import ITEM_COLUMN, create_excel_style_dataframe, style_excel_dataframe
from utils.forecast import calculate_inventory_forecast, style_forecast_dataframe
from utils.order_planning import (
    build_order_dataframe,
    calculate_normal_order_average,
    calculate_usage_average,
    discussion_reasons,
    risk_level,
)
from utils.prediction_review import calculate_prediction_accuracy, style_accuracy_dataframe


@st.cache_data(show_spinner=False)
def load_and_transform_data() -> tuple[list[dict], dict, dict, pd.DataFrame, dict]:
    loader = DataLoader()
    master_items = loader.load_master_items()
    monthly_data = loader.load_monthly_data()
    comments = loader.load_comments()
    df, column_months = create_excel_style_dataframe(master_items, monthly_data)
    return master_items, monthly_data, comments, df, column_months


st.set_page_config(page_title="溶材会議アプリ Phase 2", layout="wide")
st.title("溶材会議アプリ Phase 2")

try:
    master_items, monthly_data, comments, excel_df, column_months = load_and_transform_data()
except FileNotFoundError as exc:
    st.error(f"必要なデータファイルが見つかりません: {exc}")
    st.stop()

if "meeting_date" not in st.session_state:
    st.session_state.meeting_date = datetime.now().astimezone().isoformat(timespec="seconds")
if "meeting_month" not in st.session_state:
    st.session_state.meeting_month = "2026-03"
if "comments" not in st.session_state:
    st.session_state.comments = comments
if "calculation_results" not in st.session_state:
    st.session_state.calculation_results = {}
if "discussion_items" not in st.session_state:
    st.session_state.discussion_items = []
if "order_quantities" not in st.session_state:
    st.session_state.order_quantities = {}
if "focus_key" not in st.session_state:
    st.session_state.focus_key = None


def render_focusable_header(title: str, table_key: str) -> bool:
    title_cols = st.columns([0.88, 0.12])
    with title_cols[0]:
        st.subheader(title)
    with title_cols[1]:
        is_focused = st.session_state.focus_key == table_key
        button_label = "📋" if is_focused else "🔍"
        help_text = "縮小表示" if is_focused else "拡大表示"
        if st.button(button_label, key=f"focus_{table_key}", help=help_text):
            st.session_state.focus_key = None if is_focused else table_key
            is_focused = st.session_state.focus_key == table_key
    return is_focused

normal_items = [item for item in master_items if not item.get("is_long_leadtime")]
long_leadtime_items = [item for item in master_items if item.get("is_long_leadtime")]

st.caption(
    f"マスターデータ: {len(master_items)}品目（通常 {len(normal_items)} / 長期LT {len(long_leadtime_items)}）"
)

excel_tab, meeting_tab = st.tabs(["従来形式", "会議進行"])

with excel_tab:
    st.header("📋 従来形式")
    st.write("7ヶ月×50品目の全体俯瞰表です。月の種類ごとに列名と色を切り替えています。")

    filter_text = st.text_input("品目フィルター", placeholder="DW-001 または 品目001 で検索")
    item_column = ITEM_COLUMN if ITEM_COLUMN in excel_df.columns else "品目名"
    filtered_df = excel_df
    if filter_text:
        filter_key = filter_text.strip().lower()
        id_to_name = {item.get("item_id", ""): item.get("name", "") for item in master_items}
        matched_ids = [
            item_id
            for item_id, name in id_to_name.items()
            if filter_key in item_id.lower() or filter_key in name.lower()
        ]
        filtered_df = excel_df[excel_df[item_column].isin(matched_ids)]

    styled_df = style_excel_dataframe(filtered_df, column_months)

    st.dataframe(
        styled_df,
        use_container_width=True,
        height=600,
        hide_index=True,
    )
    st.caption("単位: kg")

    export_df = filtered_df.fillna("-")
    csv_data = export_df.to_csv(index=False)
    st.download_button(
        "CSVダウンロード",
        data=csv_data,
        file_name="excel_view.csv",
        mime="text/csv",
    )

    st.caption(f"表示件数: {len(filtered_df)} / {len(excel_df)} 品目")

with meeting_tab:
    st.header("1️⃣ 先月振り返り")
    st.write("先月（2025-12）の予測出庫と実績出庫を比較し、誤差率を確認します。")

    if "comments" not in st.session_state:
        st.session_state.comments = comments

    factory_comment = st.text_area(
        "🏭 工場全体コメント",
        value=st.session_state.comments.get("先月振り返り", {}).get("工場全体", ""),
        height=120,
    )

    accuracy_df = calculate_prediction_accuracy(monthly_data, last_month="2025-12")
    positive_df = accuracy_df[accuracy_df["誤差率(%)"] > 0].sort_values("誤差率(%)", ascending=False)
    negative_df = accuracy_df[accuracy_df["誤差率(%)"] < 0].sort_values("誤差率(%)")

    def _with_links(df: pd.DataFrame) -> pd.DataFrame:
        display_df = df.copy()
        return display_df[["品目", "予測出庫", "実績出庫", "差分", "誤差率(%)"]]

    positive_focused = render_focusable_header(
        "＋誤差の大きい順（予測より実績が多かった品目）",
        "review_positive",
    )
    if positive_df.empty:
        st.caption("対象なし")
    else:
        st.dataframe(
            style_accuracy_dataframe(_with_links(positive_df)),
            use_container_width=True,
            height=600 if positive_focused else 300,
            hide_index=True,
        )

    negative_focused = render_focusable_header(
        "－誤差の大きい順（予測より実績が少なかった品目）",
        "review_negative",
    )
    if negative_df.empty:
        st.caption("対象なし")
    else:
        st.dataframe(
            style_accuracy_dataframe(_with_links(negative_df)),
            use_container_width=True,
            height=600 if negative_focused else 300,
            hide_index=True,
        )

    st.markdown("---")
    st.subheader("🔍 品目別詳細")
    item_ids = accuracy_df["品目"].tolist()

    def _get_query_value(key: str) -> "str | None":
        try:
            value = st.query_params.get(key)
            if isinstance(value, list):
                return value[0]
            return value
        except AttributeError:
            params = st.experimental_get_query_params()
            return params.get(key, [None])[0]

    def _get_query_item() -> "str | None":
        return _get_query_value("item")

    query_item = _get_query_item()
    default_index = item_ids.index(query_item) if query_item in item_ids else 0
    selected_item = st.selectbox("品目を選択", item_ids, index=default_index)

    try:
        st.query_params["item"] = selected_item
    except AttributeError:
        st.experimental_set_query_params(item=selected_item)

    detail_row = accuracy_df[accuracy_df["品目"] == selected_item].iloc[0]
    main_columns = st.columns(4)
    main_columns[0].metric("予測出庫", f"{detail_row['予測出庫']:.0f} kg")
    main_columns[1].metric("実績出庫", f"{detail_row['実績出庫']:.0f} kg")
    main_columns[2].metric("差分", f"{detail_row['差分']:.0f} kg")
    main_columns[3].metric("誤差率", f"{detail_row['誤差率(%)']:.1f}%")

    st.caption("参考: 予測在庫 vs 実績在庫")
    stock_columns = st.columns(3)
    stock_columns[0].metric("予測在庫", f"{detail_row['予測在庫']:.0f} kg")
    stock_columns[1].metric("実績在庫", f"{detail_row['実績在庫']:.0f} kg")
    stock_columns[2].metric(
        "差分",
        f"{detail_row['実績在庫'] - detail_row['予測在庫']:.0f} kg",
    )

    item_comment = st.text_area(
        "📝 外れた理由",
        value=st.session_state.comments.get("先月振り返り", {})
        .get("品目別", {})
        .get(selected_item, ""),
        height=120,
    )

    if st.button("💾 コメントを保存"):
        st.session_state.comments.setdefault("先月振り返り", {})
        st.session_state.comments["先月振り返り"]["工場全体"] = factory_comment
        st.session_state.comments["先月振り返り"].setdefault("品目別", {})
        st.session_state.comments["先月振り返り"]["品目別"][selected_item] = item_comment
        with open("data/comments.json", "w", encoding="utf-8") as file:
            json.dump(st.session_state.comments, file, ensure_ascii=False, indent=2)
        st.success("✅ コメントを保存しました")

    st.markdown("---")
    st.header("2️⃣ 今月・翌月見込み")
    st.write("確定値は🔒、予測値は📊として表示します。")

    if "今月来月見込み" not in st.session_state.comments:
        st.session_state.comments["今月来月見込み"] = {"工場全体": "", "品目別": {}}

    forecast_factory_comment = st.text_area(
        "🏭 工場全体の状況",
        value=st.session_state.comments.get("今月来月見込み", {}).get("工場全体", ""),
        height=120,
    )

    forecast_df = calculate_inventory_forecast(monthly_data, master_items)
    current_columns = ["品目名", "現在庫", "入荷見込み", "今月使用予測", "今月末予測"]
    next_columns = ["品目名", "今月末予測", "手配済み", "来月使用予測", "来月末予測"]

    current_table = forecast_df[current_columns].rename(
        columns={
            "現在庫": "現在庫🔒",
            "入荷見込み": "入荷見込み🔒",
            "今月使用予測": "今月使用予測📊",
            "今月末予測": "今月末の予測在庫📊",
        }
    )
    next_table = forecast_df[next_columns].rename(
        columns={
            "今月末予測": "翌月頭の予測在庫📊",
            "手配済み": "手配済み🔒",
            "来月使用予測": "翌月出庫予測📊",
            "来月末予測": "翌月末の予測在庫📊",
        }
    )

    current_focused = render_focusable_header("📅 今月（2026年1月）", "forecast_current")
    st.dataframe(
        style_forecast_dataframe(
            current_table,
            locked_columns=["現在庫🔒", "入荷見込み🔒"],
            forecast_columns=["今月使用予測📊", "今月末の予測在庫📊"],
        ),
        use_container_width=True,
        height=600 if current_focused else 300,
        hide_index=True,
    )

    next_focused = render_focusable_header("📅 翌月（2026年2月）", "forecast_next")
    st.dataframe(
        style_forecast_dataframe(
            next_table,
            locked_columns=["手配済み🔒"],
            forecast_columns=["翌月頭の予測在庫📊", "翌月出庫予測📊", "翌月末の予測在庫📊"],
        ),
        use_container_width=True,
        height=600 if next_focused else 300,
        hide_index=True,
    )

    warning_items = forecast_df[forecast_df["来月末予測"] < forecast_df["安全在庫"]]
    if not warning_items.empty:
        item_list = ", ".join(warning_items["品目名"].tolist())
        st.warning(
            "⚠️ **翌月末在庫が安全在庫を下回る警告**\n\n"
            f"以下の品目で翌月末在庫が安全在庫を下回る予測です: {item_list}"
        )

    st.subheader("📝 品目別特記事項")
    selected_forecast_item = st.selectbox("品目を選択", item_ids, index=0, key="forecast_item")
    selected_row = forecast_df[forecast_df["品目名"] == selected_forecast_item].iloc[0]
    st.write(
        f"今月末予測: {selected_row['今月末予測']} kg / "
        f"翌月末予測: {selected_row['来月末予測']} kg"
    )

    forecast_item_comment = st.text_area(
        "特記事項",
        value=st.session_state.comments.get("今月来月見込み", {})
        .get("品目別", {})
        .get(selected_forecast_item, ""),
        height=120,
    )

    if st.button("💾 コメントを保存", key="save_forecast_comment"):
        st.session_state.comments["今月来月見込み"]["工場全体"] = forecast_factory_comment
        st.session_state.comments["今月来月見込み"].setdefault("品目別", {})
        st.session_state.comments["今月来月見込み"]["品目別"][selected_forecast_item] = (
            forecast_item_comment
        )
        with open("data/comments.json", "w", encoding="utf-8") as file:
            json.dump(st.session_state.comments, file, ensure_ascii=False, indent=2)
        st.success("✅ コメントを保存しました")

    st.markdown("---")
    st.header("3️⃣ 翌々月発注量決定（通常49品目）")
    st.write("DW-001〜DW-049の発注量を決定します。DW-309-Molは対象外です。")

    if "翌々月発注量" not in st.session_state.comments:
        st.session_state.comments["翌々月発注量"] = {"品目別": {}}

    normal_items_only = [item for item in master_items if not item.get("is_long_leadtime")]
    item_ids = [item.get("item_id", "") for item in normal_items_only]

    if "orders" not in st.session_state:
        st.session_state.orders = {item_id: 0 for item_id in item_ids}
    if "safety_factor" not in st.session_state:
        st.session_state.safety_factor = 1.2

    next_month_forecast = dict(zip(forecast_df["品目名"], forecast_df["来月末予測"]))
    name_map = {item.get("item_id", ""): item.get("name", "") for item in master_items}

    def build_discussion_rows(source_df: pd.DataFrame, factor: float) -> list[dict]:
        rows = []
        for _, row in source_df.iterrows():
            item_id = row["品目名"]
            normal_avg = calculate_normal_order_average(monthly_data, item_id)
            next_month_end = row["来月末在庫予測"]
            priority, reasons = discussion_reasons(row, normal_avg, next_month_end, factor)
            if reasons:
                rows.append(
                    {
                        "priority": priority,
                        "品目ID": item_id,
                        "品目名": name_map.get(item_id, item_id),
                        "来月末在庫予測": row["来月末在庫予測"],
                        "翌々月使用量予測": row["翌々月使用量予測"],
                        "発注量": row["発注量"],
                        "翌々月末在庫予測": row["翌々月末在庫予測"],
                        "リスク": row["リスク"],
                        "要議論理由": " / ".join(reasons),
                        "安全在庫": row["安全在庫"],
                        "上限在庫": row["上限在庫"],
                    }
                )
        return rows

    def filter_discussion_df(source_df: pd.DataFrame) -> pd.DataFrame:
        return source_df

    if "applied_orders" not in st.session_state:
        st.session_state.applied_orders = dict(st.session_state.orders)
    if "applied_safety_factor" not in st.session_state:
        st.session_state.applied_safety_factor = float(st.session_state.safety_factor)
    if "discussion_items_initialized" not in st.session_state:
        applied_order_df = build_order_dataframe(
            normal_items_only, monthly_data, next_month_forecast, st.session_state.applied_orders
        )
        applied_order_df["リスク"] = applied_order_df.apply(
            lambda row: risk_level(row["翌々月末在庫予測"], row["安全在庫"], row["上限在庫"]),
            axis=1,
        )
        st.session_state.discussion_items = build_discussion_rows(
            applied_order_df, float(st.session_state.applied_safety_factor)
        )
        st.session_state.discussion_items_initialized = True
    button_cols = st.columns(3)
    recalc_clicked = button_cols[0].button("🔄 再計算して反映", key="recalculate_discussion")
    demo_clicked = button_cols[1].button("デモ用の仮数値を投入")
    reset_clicked = button_cols[2].button("全品目をゼロにリセット")

    auto_recalc = False
    if demo_clicked:
        discussion_targets = ["DW-005", "DW-012"]
        fallback_targets = [item_id for item_id in item_ids if item_id not in discussion_targets]
        discussion_targets = [
            item_id for item_id in discussion_targets if item_id in item_ids
        ] + fallback_targets[: max(0, 2 - len(discussion_targets))]

        sample_orders = {}
        for item in master_items:
            item_id = item.get("item_id", "")
            if item_id == "DW-309-Mol":
                sample_orders[item_id] = round(
                    (item.get("safety_stock", 0) + item.get("max_stock", 0)) / 2
                )
                continue

            next_month_end = next_month_forecast.get(item_id, 0)
            next_next_usage = monthly_data.get("2026-03", {}).get(item_id, {}).get("使用量予測", 0)
            safety_stock = item.get("safety_stock", 0)
            max_stock = item.get("max_stock", 0)

            min_order = max(0, safety_stock - next_month_end + next_next_usage)
            max_order = max(0, max_stock - next_month_end + next_next_usage)
            target_end = (safety_stock + max_stock) / 2
            order_qty = max(0, round(target_end - next_month_end + next_next_usage))
            order_qty = min(max(order_qty, min_order), max_order)

            avg = calculate_normal_order_average(monthly_data, item_id)
            if avg > 0 and order_qty >= avg * 2:
                order_qty = max(0, round(avg * 1.5))

            if item_id in discussion_targets:
                order_qty = 0

            sample_orders[item_id] = max(order_qty, 0)

        st.session_state.orders.update(
            {item_id: qty for item_id, qty in sample_orders.items() if item_id in item_ids}
        )
        st.session_state.dw309_order = sample_orders.get("DW-309-Mol", st.session_state.dw309_order)
        st.session_state.order_quantities.update(sample_orders)
        st.session_state.safety_factor = 1.0
        st.session_state.demo_discussion_targets = discussion_targets
        st.session_state.demo_orders = {
            item_id: sample_orders.get(item_id, 0) for item_id in item_ids
        }
        auto_recalc = True
    if reset_clicked:
        st.session_state.orders = {item_id: 0 for item_id in item_ids}
        st.session_state.dw309_order = 0
        for key in list(st.session_state.order_quantities.keys()):
            st.session_state.order_quantities[key] = 0
        st.session_state.pop("demo_discussion_targets", None)
        st.session_state.pop("demo_orders", None)
        auto_recalc = True

    order_df = build_order_dataframe(
        normal_items_only, monthly_data, next_month_forecast, st.session_state.orders
    )
    order_df["リスク"] = order_df.apply(
        lambda row: risk_level(row["翌々月末在庫予測"], row["安全在庫"], row["上限在庫"]), axis=1
    )

    current_factor = float(st.session_state.safety_factor)
    needs_recalc = (
        st.session_state.orders != st.session_state.applied_orders
        or current_factor != float(st.session_state.applied_safety_factor)
    )
    def _apply_recalculation(success_message: str, show_message: bool = True) -> pd.DataFrame:
        st.session_state.applied_orders = dict(st.session_state.orders)
        st.session_state.applied_safety_factor = float(current_factor)
        applied_order_df = build_order_dataframe(
            normal_items_only,
            monthly_data,
            next_month_forecast,
            st.session_state.applied_orders,
        )
        applied_order_df["リスク"] = applied_order_df.apply(
            lambda row: risk_level(row["翌々月末在庫予測"], row["安全在庫"], row["上限在庫"]),
            axis=1,
        )
        st.session_state.discussion_items = build_discussion_rows(
            applied_order_df,
            float(st.session_state.applied_safety_factor),
        )
        if show_message:
            st.success(success_message)
        return filter_discussion_df(pd.DataFrame(st.session_state.discussion_items))

    if recalc_clicked:
        discussion_df = _apply_recalculation("✅ 再計算して反映しました")
        if not discussion_df.empty:
            discussion_df = discussion_df.sort_values(["priority", "品目名"])
        needs_recalc = False
    elif auto_recalc:
        discussion_df = _apply_recalculation("✅ 再計算して反映しました", show_message=False)
        if not discussion_df.empty:
            discussion_df = discussion_df.sort_values(["priority", "品目名"])
        needs_recalc = False

    safety_factor = st.slider(
        "翌月末の安全在庫×係数（判定）",
        min_value=1.0,
        max_value=1.5,
        value=float(st.session_state.safety_factor),
        step=0.05,
        key="safety_factor",
    )

    discussion_df = filter_discussion_df(pd.DataFrame(st.session_state.discussion_items))
    if not discussion_df.empty:
        discussion_df = discussion_df.sort_values(["priority", "品目名"])

    notice_placeholder = st.empty()
    discussion_placeholder = st.empty()

    if "order_mode" not in st.session_state:
        st.session_state.order_mode = "品目別詳細"
    requested_item = _get_query_value("order_item")
    if requested_item in item_ids and requested_item != st.session_state.get("last_order_item_query"):
        st.session_state.order_mode = "品目別詳細"
        st.session_state.order_detail_item = requested_item
        st.session_state.last_order_item_query = requested_item

    mode = st.radio("表示モード", ["全体俯瞰", "品目別詳細"], horizontal=True, key="order_mode")

    if mode == "全体俯瞰":
        editable_df = order_df[
            [
                "品目名",
                "来月末在庫予測",
                "翌々月使用量予測",
                "発注量",
                "翌々月末在庫予測",
                "リスク",
            ]
        ].copy()
        editable_df = editable_df.rename(columns={"来月末在庫予測": "翌月末在庫予測"})
        editable_df["要議論理由"] = ""
        if not discussion_df.empty:
            reason_map = discussion_df.set_index("品目名")["要議論理由"].to_dict()
            editable_df["要議論理由"] = editable_df["品目名"].map(reason_map).fillna("")

        with st.expander("📋 全品目一覧（49品目）", expanded=False):
            updated_df = st.data_editor(
                editable_df,
                use_container_width=True,
                height=600,
                key="order_editor",
                column_config={
                    "発注量": st.column_config.NumberColumn("発注量", min_value=0, step=1),
                },
                disabled=[
                    "品目名",
                    "翌月末在庫予測",
                    "翌々月使用量予測",
                    "翌々月末在庫予測",
                    "リスク",
                    "要議論理由",
                ],
            )

            st.session_state.orders = dict(zip(updated_df["品目名"], updated_df["発注量"]))

            order_df = build_order_dataframe(
                normal_items_only, monthly_data, next_month_forecast, st.session_state.orders
            )
            order_df["リスク"] = order_df.apply(
                lambda row: risk_level(row["翌々月末在庫予測"], row["安全在庫"], row["上限在庫"]), axis=1
            )
            st.caption("発注量入力後に翌々月末在庫予測とリスクレベルを再計算します。")

    else:
        default_index = 0
        if st.session_state.get("order_detail_item") in item_ids:
            default_index = item_ids.index(st.session_state.order_detail_item)
        selected_order_item = st.selectbox(
            "品目を選択",
            item_ids,
            index=default_index,
            key="order_detail_item",
        )
        detail_row = order_df[order_df["品目名"] == selected_order_item].iloc[0]
        forecast_row = forecast_df[forecast_df["品目名"] == selected_order_item].iloc[0]
        last_month_end = detail_row["来月末在庫予測"]
        next_next_usage = detail_row["翌々月使用量予測"]
        usage_avg = calculate_usage_average(
            monthly_data, selected_order_item, ["2025-09", "2025-10", "2025-11"]
        )
        normal_avg = calculate_normal_order_average(monthly_data, selected_order_item)

        st.write(
            f"📊 翌々月使用量予測: {next_next_usage} kg "
            f"(根拠: 過去3ヶ月平均 {usage_avg:.1f} kg)"
        )

        order_cols = st.columns([0.7, 0.3])
        with order_cols[0]:
            order_qty = st.number_input(
                "発注量入力 (kg)",
                min_value=0,
                value=int(st.session_state.orders.get(selected_order_item, 0)),
                step=1,
            )
        with order_cols[1]:
            item_recalc_clicked = st.button("🔄 再計算して反映", key="recalculate_single_item")
        st.session_state.orders[selected_order_item] = order_qty

        if normal_avg > 0 and order_qty >= normal_avg * 2:
            st.warning("⚠️ 発注量が通常平均の2倍以上です。")

        if item_recalc_clicked:
            discussion_df = _apply_recalculation("✅ 再計算して反映しました")
            if not discussion_df.empty:
                discussion_df = discussion_df.sort_values(["priority", "品目名"])
            needs_recalc = False

        next_next_end = last_month_end + order_qty - next_next_usage
        risk = risk_level(next_next_end, detail_row["安全在庫"], detail_row["上限在庫"])
        st.metric("翌々月末在庫予測", f"{next_next_end} kg")
        st.metric("リスクレベル", risk)
        st.write(
            f"安全在庫: {detail_row['安全在庫']} kg / 上限在庫: {detail_row['上限在庫']} kg"
        )

        decision_comment = st.text_area(
            "決定理由",
            value=st.session_state.comments.get("翌々月発注量", {})
            .get("品目別", {})
            .get(selected_order_item, ""),
            height=120,
        )
        if st.button("💾 コメントを保存", key="save_order_comment"):
            st.session_state.comments["翌々月発注量"].setdefault("品目別", {})
            st.session_state.comments["翌々月発注量"]["品目別"][selected_order_item] = decision_comment
            with open("data/comments.json", "w", encoding="utf-8") as file:
                json.dump(st.session_state.comments, file, ensure_ascii=False, indent=2)
            st.success("✅ コメントを保存しました")

        trend_months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]
        trend_values = []
        for month in trend_months:
            payload = monthly_data.get(month, {}).get(selected_order_item, {})
            if month in {"2025-09", "2025-10", "2025-11", "2025-12"}:
                value = payload.get("在庫", 0)
            elif month == "2026-01":
                value = forecast_row["今月末予測"]
            else:
                value = forecast_row["来月末予測"]
            trend_values.append({"月": month, "在庫": value})

        trend_df = pd.DataFrame(trend_values)
        fig = px.line(trend_df, x="月", y="在庫", markers=True, title="過去6ヶ月の在庫トレンド")
        st.plotly_chart(fig, use_container_width=True)

    if needs_recalc:
        notice_placeholder.info("編集後は「🔄 再計算して反映」を押すと要議論品目が更新されます。")
    else:
        notice_placeholder.empty()

    if not discussion_df.empty:
        with discussion_placeholder.container():
            discussion_display_df = discussion_df.rename(columns={"来月末在庫予測": "翌月末在庫予測"})
            with st.expander(f"⚠️ 要議論品目（{len(discussion_df)}件）", expanded=True):
                st.dataframe(
                    discussion_display_df.drop(columns=["priority", "品目名"]),
                    use_container_width=True,
                    hide_index=True,
                )
    else:
        discussion_placeholder.empty()
    order_df = build_order_dataframe(
        normal_items_only, monthly_data, next_month_forecast, st.session_state.orders
    )
    order_df["リスク"] = order_df.apply(
        lambda row: risk_level(row["翌々月末在庫予測"], row["安全在庫"], row["上限在庫"]), axis=1
    )
    st.session_state.order_quantities = {**st.session_state.orders}

    calculation_results = st.session_state.calculation_results
    for _, row in order_df.iterrows():
        calculation_results[row["品目名"]] = {
            "来月末在庫予測": row["来月末在庫予測"],
            "翌々月使用量予測": row["翌々月使用量予測"],
            "翌々月末在庫予測": row["翌々月末在庫予測"],
            "リスクレベル": row["リスク"],
        }
    st.session_state.calculation_results = calculation_results

    st.markdown("---")
    st.header("4️⃣ 🔔 DW-309-Mol 発注量決定（6か月リードタイム品）")

    dw309_item = next((item for item in master_items if item.get("item_id") == "DW-309-Mol"), None)
    if dw309_item is None:
        st.error("DW-309-Mol がマスターデータに見つかりません。")
    else:
        dw309_current = monthly_data.get("2026-01", {}).get("DW-309-Mol", {})
        current_stock = dw309_current.get("現在庫", 0)
        safety_stock = dw309_item.get("safety_stock", 0)
        max_stock = dw309_item.get("max_stock", 0)

        st.write(
            f"現在在庫: {current_stock} kg ｜ 安全在庫: {safety_stock} kg ｜ 上限在庫: {max_stock} kg"
        )
        st.write("リードタイム: 6か月 → 今月発注分は7か月後（2026-08）入庫")

        if "dw309_order" not in st.session_state:
            st.session_state.dw309_order = 0
        if "DW-309-Mol" not in st.session_state.comments:
            st.session_state.comments["DW-309-Mol"] = {"決定理由": ""}

        dw309_order_qty = st.number_input(
            "発注量（7か月後入庫）",
            min_value=0,
            value=int(st.session_state.dw309_order),
            step=1,
        )
        st.session_state.dw309_order = dw309_order_qty

        forecast_table, summary = build_dw309_forecast(
            monthly_data,
            "DW-309-Mol",
            current_stock,
            safety_stock,
            max_stock,
            dw309_order_qty,
        )
        final_month = summary["final_month"]
        final_month_end = summary["final_month_end"]
        usage_avg = summary["usage_avg"]

        st.subheader("【7か月間の在庫推移予測（入庫まで）】")
        st.dataframe(
            style_dw309_forecast(forecast_table, safety_stock, max_stock),
            use_container_width=True,
            height=350,
            hide_index=True,
        )

        below_safety = (forecast_table["月末📊"] < safety_stock).any()
        above_max = final_month_end > max_stock
        if below_safety:
            st.error("⚠️ 重大リスク: 期間中に安全在庫を下回る月があります。")
        elif above_max:
            st.warning("⚠️ 注意: 7か月後末在庫が上限在庫を超える予測です。")
        else:
            st.success("✅ 適正: 安全在庫と上限在庫の範囲内です。")

        avg_error = calculate_prediction_error(monthly_data, "DW-309-Mol")
        if avg_error is not None and avg_error >= 20:
            st.warning(f"💡 確認推奨: 過去予測の平均誤差 {avg_error:.1f}%")

        st.subheader(f"【7か月後（{final_month}）の予測】")
        st.write(f"📊 7か月後使用量予測: {usage_avg:.1f} kg（±15%）")
        st.write("🔒 7か月後入庫予定（確定分）: 0 kg")

        st.subheader("【発注量決定】")
        st.write(f"→ 7か月後末在庫予測: {final_month_end:.1f} kg")
        risk = "欠品" if below_safety else "過剰" if above_max else "適正"
        st.write(f"→ リスクレベル: {risk}")
        st.session_state.order_quantities["DW-309-Mol"] = dw309_order_qty
        st.session_state.calculation_results["DW-309-Mol"] = {
            "翌々月末在庫予測": round(final_month_end, 1),
            "リスクレベル": risk,
        }

        trend_df = forecast_table.copy()
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=trend_df["月"],
                y=trend_df["月末📊"],
                mode="lines+markers",
                name="在庫推移",
            )
        )
        incoming_markers = trend_df[trend_df["入庫🔒"] > 0]
        if not incoming_markers.empty:
            fig.add_trace(
                go.Scatter(
                    x=incoming_markers["月"],
                    y=incoming_markers["月末📊"],
                    mode="markers",
                    marker=dict(size=12, color="#1976d2"),
                    name="入庫予定",
                )
            )
        fig.add_hrect(
            y0=safety_stock,
            y1=max_stock,
            fillcolor="rgba(76, 175, 80, 0.1)",
            line_width=0,
        )
        fig.add_hline(y=safety_stock, line_dash="dash", line_color="red", annotation_text="安全在庫")
        fig.add_hline(y=max_stock, line_dash="dash", line_color="orange", annotation_text="上限在庫")
        fig.update_layout(height=350, margin=dict(l=20, r=20, t=30, b=20))
        st.plotly_chart(fig, use_container_width=True)

        decision_comment = st.text_area(
            "決定理由",
            value=st.session_state.comments.get("DW-309-Mol", {}).get("決定理由", ""),
            height=140,
            placeholder="6か月リードタイムを考慮した発注理由を記録...",
        )
        if st.button("💾 コメントを保存", key="save_dw309_comment"):
            st.session_state.comments["DW-309-Mol"]["決定理由"] = decision_comment
            with open("data/comments.json", "w", encoding="utf-8") as file:
                json.dump(st.session_state.comments, file, ensure_ascii=False, indent=2)
            st.success("✅ コメントを保存しました")

    with st.expander("コメント雛形"):
        display_comments = dict(comments)
        if "今月来月見込み" in display_comments:
            display_comments["今月翌月見込み"] = display_comments.pop("今月来月見込み")
        st.json(display_comments)

    with st.expander("長期リードタイム品目"):
        st.dataframe(
            pd.DataFrame(long_leadtime_items),
            use_container_width=True,
            hide_index=True,
        )

with st.sidebar:
    st.header("📥 データ保存・出力")
    meeting_date = st.text_input("会議日時", value=st.session_state.meeting_date)
    meeting_month = st.text_input("決定対象月", value=st.session_state.meeting_month)
    st.session_state.meeting_date = meeting_date
    st.session_state.meeting_month = meeting_month

    snapshot = build_meeting_snapshot(
        st.session_state.comments,
        st.session_state.order_quantities,
        st.session_state.calculation_results,
        st.session_state.discussion_items,
        meeting_date,
        meeting_month,
    )

    if st.button("💾 JSON保存"):
        data_dir = Path("data")
        data_dir.mkdir(parents=True, exist_ok=True)
        filename = f"meeting_snapshot_{datetime.now().strftime('%Y%m%d')}.json"
        (data_dir / filename).write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        st.success(f"✅ {filename} に保存しました")

    if uploaded := st.file_uploader("JSONを読み込む", type=["json"]):
        try:
            payload = json.loads(uploaded.read().decode("utf-8"))
            st.session_state.meeting_date = payload.get("会議日時", meeting_date)
            st.session_state.meeting_month = payload.get("会議対象月", meeting_month)
            st.session_state.comments = payload.get("コメント", st.session_state.comments)
            st.session_state.order_quantities = payload.get(
                "発注量", st.session_state.order_quantities
            )
            st.session_state.calculation_results = payload.get(
                "計算結果", st.session_state.calculation_results
            )
            st.session_state.discussion_items = payload.get(
                "要議論品目", st.session_state.discussion_items
            )
            st.session_state.orders.update(
                {k: v for k, v in st.session_state.order_quantities.items() if k != "DW-309-Mol"}
            )
            st.session_state.dw309_order = st.session_state.order_quantities.get("DW-309-Mol", 0)
            st.success("✅ JSONを読み込みました")
        except (json.JSONDecodeError, UnicodeDecodeError):
            st.error("JSONの読み込みに失敗しました。形式を確認してください。")

    order_export_df = build_order_export_df(
        master_items,
        st.session_state.order_quantities,
        st.session_state.calculation_results,
        st.session_state.comments,
    )
    comments_export_df = build_meeting_comments_df(st.session_state.comments)
    discussion_export_df = build_discussion_items_df(st.session_state.discussion_items)

    st.download_button(
        "発注量CSVをダウンロード",
        data=encode_csv_with_bom(order_export_df),
        file_name=build_export_filename("発注量", meeting_date),
        mime="text/csv",
    )
    st.download_button(
        "会議記録CSVをダウンロード",
        data=encode_csv_with_bom(comments_export_df),
        file_name=build_export_filename("会議記録", meeting_date),
        mime="text/csv",
    )
    st.download_button(
        "要議論品目CSVをダウンロード",
        data=encode_csv_with_bom(discussion_export_df),
        file_name=build_export_filename("要議論品目", meeting_date),
        mime="text/csv",
    )
