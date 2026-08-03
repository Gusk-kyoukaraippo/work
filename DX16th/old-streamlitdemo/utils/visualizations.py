"""履歴タブのグラフ生成。"""

import plotly.graph_objects as go


ITEM_COLORS = {
    "M001": "#1f77b4",
    "M002": "#ff7f0e",
    "M003": "#2ca02c",
    "M004": "#d62728",
    "M005": "#9467bd",
    "M006": "#8c564b",
}


def _build_series(historical_data, item_id, value_key):
    """
    指定品目の月次系列を生成。

    Args:
        historical_data (list): HISTORICAL_DATA
        item_id (str): 品目ID
        value_key (str): "shipment" or "stock"

    Returns:
        tuple: (months, values)
    """
    months = []
    values = []
    for month in historical_data:
        item = next(i for i in month["items"] if i["item_id"] == item_id)
        months.append(month["month"])
        values.append(item[value_key])
    return months, values


def create_shipment_trend_chart(historical_data, selected_items, master_items):
    """
    出庫量推移の折れ線グラフを生成。
    """
    fig = go.Figure()
    name_map = {item["id"]: item["name"] for item in master_items}

    for item_id in selected_items:
        months, values = _build_series(historical_data, item_id, "shipment")
        fig.add_trace(
            go.Scatter(
                x=months,
                y=values,
                mode="lines+markers",
                name=name_map.get(item_id, item_id),
                line={"color": ITEM_COLORS.get(item_id, "#333333")},
            )
        )

    fig.update_layout(
        title="出庫量の推移",
        xaxis_title="月",
        yaxis_title="出庫量",
        hovermode="x unified",
    )
    return fig


def create_stock_trend_chart(historical_data, selected_items, master_items):
    """
    在庫量推移の折れ線グラフを生成。
    """
    fig = go.Figure()
    name_map = {item["id"]: item["name"] for item in master_items}

    for item_id in selected_items:
        months, values = _build_series(historical_data, item_id, "stock")
        fig.add_trace(
            go.Scatter(
                x=months,
                y=values,
                mode="lines+markers",
                name=name_map.get(item_id, item_id),
                line={"color": ITEM_COLORS.get(item_id, "#333333")},
            )
        )

    fig.update_layout(
        title="在庫量の推移",
        xaxis_title="月",
        yaxis_title="在庫量",
        hovermode="x unified",
    )
    return fig


def create_inventory_trend_chart(inventory_results, safety_stock, max_stock):
    """
    予測在庫推移の折れ線グラフを生成。
    """
    months = [result["month"] for result in inventory_results]
    stocks = [result["closing_stock"] for result in inventory_results]

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=months,
            y=stocks,
            mode="lines+markers",
            name="予測在庫",
            line={"color": "#1f77b4"},
        )
    )

    fig.add_hline(
        y=safety_stock,
        line_dash="dash",
        line_color="#c62828",
        annotation_text="安全在庫",
        annotation_position="top left",
    )
    fig.add_hline(
        y=max_stock,
        line_dash="dot",
        line_color="#ef6c00",
        annotation_text="上限在庫",
        annotation_position="top left",
    )

    fig.update_layout(
        title="6ヶ月先の予測在庫推移",
        xaxis_title="月",
        yaxis_title="在庫量",
        hovermode="x unified",
    )
    return fig


def create_timeline_chart(current_month, pending_orders, stockout_info, deadline):
    """
    発注→入庫のタイムラインを生成。
    """
    from datetime import datetime

    from dateutil.relativedelta import relativedelta

    fig = go.Figure()
    now = datetime.strptime(current_month, "%Y-%m")

    timeline_months = []
    for i in range(13):
        month = now + relativedelta(months=i)
        timeline_months.append(month.strftime("%Y-%m"))

    for index, order in enumerate(pending_orders):
        fig.add_trace(
            go.Scatter(
                x=[order["order_date"], order["arrival_date"]],
                y=[index + 1, index + 1],
                mode="lines+markers",
                name=f"発注#{index + 1} ({order['amount']}トン)",
                line=dict(width=10, color="#1f77b4"),
                marker=dict(size=12, symbol=["diamond", "circle"]),
            )
        )

    if deadline:
        fig.add_vline(
            x=deadline,
            line_dash="dash",
            line_color="red",
            annotation_text="⚠️ 発注期限",
            annotation_position="top",
        )

    if stockout_info:
        fig.add_vline(
            x=stockout_info["month"],
            line_dash="dot",
            line_color="orange",
            annotation_text="在庫底打ち",
            annotation_position="top",
        )

    fig.update_layout(
        title="発注タイムライン（6ヶ月リードタイム）",
        xaxis_title="月",
        yaxis_title="発注番号",
        height=300,
        showlegend=True,
    )
    fig.update_xaxes(categoryorder="array", categoryarray=timeline_months)
    return fig
