"""計算ロジック。"""


def calculate_recommended_range(item_master, current_stock, forecasted_shipment):
    """
    推奨注文量レンジを計算。

    Args:
        item_master (dict): 品目マスター情報
        current_stock (float): 現在庫
        forecasted_shipment (float): 来月出庫予測

    Returns:
        tuple: (min_order, max_order)
    """
    # 下限は安全在庫を割らないための最低注文量
    min_order = max(
        0, item_master["safety_stock"] + forecasted_shipment - current_stock
    )
    # 上限は上限在庫を超えないための最大注文量
    max_order = item_master["max_stock"] + forecasted_shipment - current_stock
    return (min_order, max_order)


def assess_risk(order_amount, current_stock, forecasted_shipment, safety_stock, max_stock):
    """
    注文量に基づくリスクを判定。

    Args:
        order_amount (float): 注文量
        current_stock (float): 現在庫
        forecasted_shipment (float): 来月出庫予測
        safety_stock (float): 安全在庫
        max_stock (float): 上限在庫

    Returns:
        dict: {"level": str, "color": str, "stock": float}
    """
    predicted_stock = current_stock + order_amount - forecasted_shipment

    if predicted_stock < safety_stock:
        return {"level": "欠品リスク", "color": "red", "stock": predicted_stock}
    if predicted_stock > max_stock:
        return {"level": "過剰在庫", "color": "orange", "stock": predicted_stock}
    return {"level": "適正", "color": "green", "stock": predicted_stock}


def assess_current_risk(current_stock, safety_stock, max_stock):
    """
    現在庫のリスクレベルを判定。

    Args:
        current_stock (float): 現在庫
        safety_stock (float): 安全在庫
        max_stock (float): 上限在庫

    Returns:
        dict: {"level": str, "color": str, "message": str}
    """
    # 安全在庫を下回ると欠品リスク、上限在庫を超えると過剰在庫
    if current_stock < safety_stock:
        shortage_rate = (safety_stock - current_stock) / safety_stock * 100
        return {
            "level": "欠品リスク",
            "color": "red",
            "message": f"安全在庫を{int(shortage_rate)}%下回っています",
        }
    if current_stock > max_stock:
        excess_rate = (current_stock - max_stock) / max_stock * 100
        return {
            "level": "過剰在庫",
            "color": "orange",
            "message": f"上限在庫を{int(excess_rate)}%超過しています",
        }
    return {"level": "適正", "color": "green", "message": "在庫は適正範囲内です"}


def calculate_stockout_month(current_stock, monthly_shipment, safety_stock):
    """
    在庫が底を打つ月数を計算（簡易版）。

    Args:
        current_stock (float): 現在庫
        monthly_shipment (float): 月次出庫量（来月出庫予測を流用）
        safety_stock (float): 安全在庫

    Returns:
        float | None: 0なら既に欠品、Noneなら計算不可
    """
    # 出庫がない場合は計算不可
    if monthly_shipment == 0:
        return None

    available_stock = current_stock - safety_stock
    if available_stock <= 0:
        return 0

    months_until_stockout = available_stock / monthly_shipment
    return round(months_until_stockout, 1)


def calculate_risk_summary(current_items, master_items):
    """
    リスクサマリ（欠品/過剰/適正）を集計。

    Args:
        current_items (list): CURRENT_MONTH_DATA["items"]
        master_items (list): MASTER_ITEMS

    Returns:
        dict: {"shortage": int, "excess": int, "ok": int}
    """
    master_by_id = {item["id"]: item for item in master_items}
    summary = {"shortage": 0, "excess": 0, "ok": 0}

    for item in current_items:
        master = master_by_id[item["item_id"]]
        risk = assess_current_risk(
            item["current_stock"], master["safety_stock"], master["max_stock"]
        )
        if risk["color"] == "red":
            summary["shortage"] += 1
        elif risk["color"] == "orange":
            summary["excess"] += 1
        else:
            summary["ok"] += 1

    return summary


def calculate_forecast_error(forecasted, actual):
    """
    予測値と実績値の誤差を計算。

    Args:
        forecasted (float): 予測値
        actual (float): 実績値

    Returns:
        dict: {"difference": float, "error_rate": float | None, "abs_error_rate": float | None}
    """
    difference = actual - forecasted

    if forecasted == 0:
        error_rate = None
    else:
        error_rate = (difference / forecasted) * 100

    return {
        "difference": difference,
        "error_rate": error_rate,
        "abs_error_rate": abs(error_rate) if error_rate is not None else None,
    }


def calculate_mape(items_data):
    """
    MAPE（平均絶対パーセント誤差）を計算。

    Args:
        items_data (list): LAST_MONTH_DATA["items"]

    Returns:
        float | None: MAPE
    """
    valid_errors = []

    for item in items_data:
        forecasted = item["forecasted_shipment"]
        actual = item["actual_shipment"]

        if forecasted != 0:
            ape = abs((actual - forecasted) / forecasted) * 100
            valid_errors.append(ape)

    if not valid_errors:
        return None

    mape = sum(valid_errors) / len(valid_errors)
    return round(mape, 2)


ANOMALY_THRESHOLD_PERCENT = 50


def detect_anomalies(historical_data, threshold=ANOMALY_THRESHOLD_PERCENT):
    """
    前月比±threshold%以上変動した月を検出。

    Args:
        historical_data (list): HISTORICAL_DATA
        threshold (float): 変動率の閾値（%）

    Returns:
        list: 異常値リスト
    """
    anomalies = []

    for index in range(1, len(historical_data)):
        prev_month = historical_data[index - 1]
        curr_month = historical_data[index]

        for item in curr_month["items"]:
            item_id = item["item_id"]
            curr_shipment = item["shipment"]
            prev_item = next(p for p in prev_month["items"] if p["item_id"] == item_id)
            prev_shipment = prev_item["shipment"]

            if prev_shipment == 0:
                continue

            change_rate = ((curr_shipment - prev_shipment) / prev_shipment) * 100
            if abs(change_rate) >= threshold:
                anomalies.append(
                    {
                        "month": curr_month["month"],
                        "item_id": item_id,
                        "change_rate": change_rate,
                        "prev_value": prev_shipment,
                        "curr_value": curr_shipment,
                    }
                )

    return anomalies


def calculate_long_term_inventory(
    current_stock, forecasts, pending_orders, safety_stock, max_stock
):
    """
    6ヶ月先までの予測在庫を月別に計算。

    Args:
        current_stock (float): 現在庫
        forecasts (list): 月次出庫予測
        pending_orders (list): 発注済み（未入庫）
        safety_stock (float): 安全在庫
        max_stock (float): 上限在庫

    Returns:
        list: 月次の在庫推移
    """
    results = []
    stock = current_stock

    for forecast in forecasts:
        month = forecast["month"]
        shipment = forecast["forecasted_shipment"]

        incoming = 0
        for order in pending_orders:
            if order["arrival_date"] == month:
                incoming += order["amount"]

        opening_stock = stock
        stock = stock + incoming - shipment

        if stock < safety_stock:
            risk_level = "shortage"
        elif stock > max_stock:
            risk_level = "excess"
        else:
            risk_level = "ok"

        results.append(
            {
                "month": month,
                "opening_stock": opening_stock,
                "incoming": incoming,
                "shipment": shipment,
                "closing_stock": stock,
                "risk_level": risk_level,
            }
        )

    return results


def find_stockout_month(inventory_results, safety_stock):
    """
    在庫が底を打つ月を特定。

    Args:
        inventory_results (list): calculate_long_term_inventoryの結果
        safety_stock (float): 安全在庫

    Returns:
        dict | None: 底打ち情報
    """
    for result in inventory_results:
        if result["closing_stock"] < safety_stock:
            return {
                "month": result["month"],
                "stock": result["closing_stock"],
                "shortage": safety_stock - result["closing_stock"],
            }
    return None


def calculate_order_deadline(stockout_month, lead_time_months=6):
    """
    発注期限を計算（底打ち月の指定ヶ月前）。
    """
    from datetime import datetime

    from dateutil.relativedelta import relativedelta

    if stockout_month is None:
        return None

    stockout_date = datetime.strptime(stockout_month, "%Y-%m")
    deadline_date = stockout_date - relativedelta(months=lead_time_months)
    return deadline_date.strftime("%Y-%m")
