"""ダミー月次データ。"""

CURRENT_MONTH_DATA = {
    "month": "2026-01",
    "items": [
        {"item_id": "M001", "current_stock": 120, "forecasted_shipment": 85},
        {"item_id": "M002", "current_stock": 80, "forecasted_shipment": 35},
        {"item_id": "M003", "current_stock": 45, "forecasted_shipment": 22},
        {"item_id": "M004", "current_stock": 320, "forecasted_shipment": 150},
        {"item_id": "M005", "current_stock": 25, "forecasted_shipment": 8},
        {"item_id": "M006", "current_stock": 180, "forecasted_shipment": 70},
    ],
}

NEXT_MONTH_FORECAST = {
    "month": "2026-02",
    "forecasted_shipments": [
        {"item_id": "M001", "amount": 90},
        {"item_id": "M002", "amount": 40},
        {"item_id": "M003", "amount": 25},
        {"item_id": "M004", "amount": 160},
        {"item_id": "M005", "amount": 5},
        {"item_id": "M006", "amount": 80},
    ],
}

# 先月（2025年12月）のデータ
LAST_MONTH_DATA = {
    "month": "2025-12",
    "items": [
        {
            "item_id": "M001",
            "forecasted_shipment": 85,
            "actual_shipment": 80,
            "memo": "予測は概ね的中",
        },
        {
            "item_id": "M002",
            "forecasted_shipment": 35,
            "actual_shipment": 45,
            "memo": "急な追加発注があった",
        },
        {
            "item_id": "M003",
            "forecasted_shipment": 22,
            "actual_shipment": 20,
            "memo": "",
        },
        {
            "item_id": "M004",
            "forecasted_shipment": 150,
            "actual_shipment": 130,
            "memo": "工事遅延により使用量減少",
        },
        {
            "item_id": "M005",
            "forecasted_shipment": 8,
            "actual_shipment": 12,
            "memo": "緊急対応案件が発生",
        },
        {
            "item_id": "M006",
            "forecasted_shipment": 70,
            "actual_shipment": 68,
            "memo": "",
        },
    ],
}

# 過去6ヶ月の履歴データ（2025年7月〜12月）
HISTORICAL_DATA = [
    {
        "month": "2025-07",
        "items": [
            {"item_id": "M001", "shipment": 75, "stock": 110},
            {"item_id": "M002", "shipment": 30, "stock": 75},
            {"item_id": "M003", "shipment": 18, "stock": 40},
            {"item_id": "M004", "shipment": 140, "stock": 300},
            {"item_id": "M005", "shipment": 6, "stock": 22},
            {"item_id": "M006", "shipment": 65, "stock": 170},
        ],
    },
    {
        "month": "2025-08",
        "items": [
            {"item_id": "M001", "shipment": 85, "stock": 115},
            {"item_id": "M002", "shipment": 38, "stock": 82},
            {"item_id": "M003", "shipment": 20, "stock": 43},
            {"item_id": "M004", "shipment": 155, "stock": 315},
            {"item_id": "M005", "shipment": 7, "stock": 24},
            {"item_id": "M006", "shipment": 72, "stock": 175},
        ],
    },
    {
        "month": "2025-09",
        "items": [
            {"item_id": "M001", "shipment": 82, "stock": 118},
            {"item_id": "M002", "shipment": 35, "stock": 79},
            {"item_id": "M003", "shipment": 22, "stock": 46},
            {"item_id": "M004", "shipment": 148, "stock": 310},
            {"item_id": "M005", "shipment": 9, "stock": 26},
            {"item_id": "M006", "shipment": 68, "stock": 178},
        ],
    },
    {
        "month": "2025-10",
        "items": [
            {"item_id": "M001", "shipment": 78, "stock": 122},
            {"item_id": "M002", "shipment": 32, "stock": 76},
            {"item_id": "M003", "shipment": 19, "stock": 44},
            {"item_id": "M004", "shipment": 135, "stock": 305},
            {"item_id": "M005", "shipment": 5, "stock": 23},
            {"item_id": "M006", "shipment": 70, "stock": 182},
        ],
    },
    {
        "month": "2025-11",
        "items": [
            {"item_id": "M001", "shipment": 88, "stock": 125},
            {"item_id": "M002", "shipment": 40, "stock": 85},
            {"item_id": "M003", "shipment": 23, "stock": 47},
            {"item_id": "M004", "shipment": 160, "stock": 325},
            {"item_id": "M005", "shipment": 8, "stock": 25},
            {"item_id": "M006", "shipment": 75, "stock": 185},
        ],
    },
    {
        "month": "2025-12",
        "items": [
            {"item_id": "M001", "shipment": 80, "stock": 120},
            {"item_id": "M002", "shipment": 45, "stock": 80},
            {"item_id": "M003", "shipment": 20, "stock": 45},
            {"item_id": "M004", "shipment": 130, "stock": 320},
            {"item_id": "M005", "shipment": 12, "stock": 25},
            {"item_id": "M006", "shipment": 68, "stock": 180},
        ],
    },
]

# 来月〜6ヶ月先の出庫予測（M005のみ）
LONG_TERM_FORECAST = {
    "item_id": "M005",
    "forecasts": [
        {"month": "2026-02", "forecasted_shipment": 5},
        {"month": "2026-03", "forecasted_shipment": 6},
        {"month": "2026-04", "forecasted_shipment": 7},
        {"month": "2026-05", "forecasted_shipment": 5},
        {"month": "2026-06", "forecasted_shipment": 8},
        {"month": "2026-07", "forecasted_shipment": 6},
    ],
    "current_stock": 25,
    "pending_orders": [
        {"order_date": "2025-10", "arrival_date": "2026-04", "amount": 15},
        {"order_date": "2025-11", "arrival_date": "2026-05", "amount": 10},
    ],
}
