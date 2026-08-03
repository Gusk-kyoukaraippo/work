import json
import random
from pathlib import Path

SEED = 42
MONTHS = [
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
]


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _data_dir() -> Path:
    return _project_root() / "data"


def generate_master_items() -> list[dict]:
    random.seed(SEED)
    items = []
    for idx in range(1, 50):
        safety_stock = random.randint(30, 100)
        max_stock = safety_stock * random.randint(3, 5)
        items.append(
            {
                "item_id": f"DW-{idx:03d}",
                "name": f"品目{idx:03d}",
                "unit": "kg",
                "safety_stock": safety_stock,
                "max_stock": max_stock,
                "lead_time_months": 2,
                "is_long_leadtime": False,
            }
        )
    items.append(
        {
            "item_id": "DW-309-Mol",
            "name": "DW-309-Mol",
            "unit": "kg",
            "safety_stock": 100,
            "max_stock": 500,
            "lead_time_months": 6,
            "is_long_leadtime": True,
        }
    )
    return items


def _usage_range(safety_stock: int) -> tuple[int, int]:
    low = max(5, safety_stock // 2)
    high = safety_stock * 2
    return low, high


def _random_value(safety_stock: int) -> int:
    low, high = _usage_range(safety_stock)
    return random.randint(low, high)


def generate_monthly_data(master_items: list[dict]) -> dict:
    random.seed(SEED + 1)
    monthly_data: dict[str, dict] = {}
    safety_by_item = {item["item_id"]: item["safety_stock"] for item in master_items}
    max_by_item = {item["item_id"]: item["max_stock"] for item in master_items}

    for month in MONTHS:
        month_payload: dict[str, dict] = {}
        for item_id, safety_stock in safety_by_item.items():
            if month in {"2025-09", "2025-10", "2025-11"}:
                month_payload[item_id] = {
                    "入庫": _random_value(safety_stock),
                    "出庫": _random_value(safety_stock),
                    "在庫": _random_value(safety_stock),
                }
            elif month == "2025-12":
                stock = _random_value(safety_stock)
                forecast = max(0, stock + random.randint(-15, 15))
                month_payload[item_id] = {
                    "入庫": _random_value(safety_stock),
                    "出庫": _random_value(safety_stock),
                    "在庫": stock,
                    "予測在庫": forecast,
                }
            elif month == "2026-01":
                month_payload[item_id] = {
                    "現在庫": _random_value(safety_stock),
                    "入荷見込み": _random_value(safety_stock),
                    "使用量予測": _random_value(safety_stock),
                }
            elif month == "2026-02":
                month_payload[item_id] = {
                    "手配済み": _random_value(safety_stock),
                    "使用量予測": _random_value(safety_stock),
                }
            elif month == "2026-03":
                month_payload[item_id] = {
                    "使用量予測": _random_value(safety_stock),
                }
        monthly_data[month] = month_payload
    _adjust_next_month_shortages(monthly_data, safety_by_item)
    _stabilize_dw309_start(monthly_data, safety_by_item, max_by_item)
    _extend_dw309_plan(monthly_data, safety_by_item, max_by_item)
    return monthly_data


def _adjust_next_month_shortages(
    monthly_data: dict[str, dict],
    safety_by_item: dict[str, int],
    target_warning_item: str = "DW-005",
) -> None:
    warning_item = (
        target_warning_item
        if target_warning_item in safety_by_item
        else next(iter(safety_by_item.keys()))
    )

    for item_id, safety_stock in safety_by_item.items():
        current_data = monthly_data.get("2026-01", {}).get(item_id)
        next_data = monthly_data.get("2026-02", {}).get(item_id)
        if not current_data or not next_data:
            continue

        current_stock = current_data.get("現在庫", 0)
        incoming = current_data.get("入荷見込み", 0)
        usage_current = current_data.get("使用量予測", 0)
        month_end = current_stock + incoming - usage_current

        prepared = next_data.get("手配済み", 0)
        usage_next = next_data.get("使用量予測", 0)
        next_month_end = month_end + prepared - usage_next

        if item_id == warning_item:
            target = safety_stock - 5
            if next_month_end >= target:
                adjust = next_month_end - target + 1
                next_data["使用量予測"] = usage_next + adjust
            continue

        if next_month_end < safety_stock:
            adjust = safety_stock - next_month_end + 5
            next_data["手配済み"] = prepared + adjust


def _extend_dw309_plan(
    monthly_data: dict[str, dict],
    safety_by_item: dict[str, int],
    max_by_item: dict[str, int],
    item_id: str = "DW-309-Mol",
) -> None:
    if item_id not in safety_by_item:
        return

    current_data = monthly_data.get("2026-01", {}).get(item_id)
    next_data = monthly_data.get("2026-02", {}).get(item_id)
    third_data = monthly_data.get("2026-03", {}).get(item_id)
    if not current_data or not next_data or not third_data:
        return

    safety_stock = safety_by_item[item_id]
    max_stock = max_by_item[item_id]

    usage_values = [
        current_data.get("使用量予測", 0),
        next_data.get("使用量予測", 0),
        third_data.get("使用量予測", 0),
    ]
    usage_values = [value for value in usage_values if value is not None]
    usage_avg = sum(usage_values) / len(usage_values) if usage_values else safety_stock
    usage_avg = max(usage_avg, safety_stock * 0.6)

    month_end = (
        current_data.get("現在庫", 0)
        + current_data.get("入荷見込み", 0)
        - current_data.get("使用量予測", 0)
    )
    month_end = month_end + next_data.get("手配済み", 0) - next_data.get("使用量予測", 0)
    month_end = month_end + third_data.get("入庫", 0) - third_data.get("使用量予測", 0)

    for month in ("2026-04", "2026-05", "2026-06", "2026-07"):
        usage = round(usage_avg)
        target = safety_stock + 15
        incoming = max(round(usage_avg * 0.5), target - (month_end - usage))
        month_end_candidate = month_end + incoming - usage
        if month_end_candidate > max_stock:
            incoming = max(0, incoming - (month_end_candidate - max_stock))
            month_end_candidate = month_end + incoming - usage

        monthly_data.setdefault(month, {})[item_id] = {
            "入庫": max(0, incoming),
            "使用量予測": max(0, usage),
        }
        month_end = month_end_candidate


def _stabilize_dw309_start(
    monthly_data: dict[str, dict],
    safety_by_item: dict[str, int],
    max_by_item: dict[str, int],
    item_id: str = "DW-309-Mol",
) -> None:
    if item_id not in safety_by_item:
        return

    current_data = monthly_data.get("2026-01", {}).get(item_id)
    next_data = monthly_data.get("2026-02", {}).get(item_id)
    third_data = monthly_data.get("2026-03", {}).get(item_id)
    if not current_data or not next_data or not third_data:
        return

    safety_stock = safety_by_item[item_id]
    min_target = safety_stock + 10

    current_stock = current_data.get("現在庫", 0)
    current_stock = max(current_stock, safety_stock * 2)
    current_data["現在庫"] = current_stock

    incoming = current_data.get("入荷見込み", 0)
    usage_current = current_data.get("使用量予測", 0)
    month_end = current_stock + incoming - usage_current
    if month_end < min_target:
        adjust = min_target - month_end
        current_data["入荷見込み"] = incoming + adjust
        month_end += adjust

    prepared = next_data.get("手配済み", 0)
    usage_next = next_data.get("使用量予測", 0)
    next_month_end = month_end + prepared - usage_next
    if next_month_end < min_target:
        adjust = min_target - next_month_end
        next_data["手配済み"] = prepared + adjust
        next_month_end += adjust

    incoming_third = third_data.get("入庫", 0)
    usage_third = third_data.get("使用量予測", 0)
    third_month_end = next_month_end + incoming_third - usage_third
    if third_month_end < min_target:
        adjust = min_target - third_month_end
        third_data["入庫"] = incoming_third + adjust


def generate_comments_template() -> dict:
    return {
        "先月振り返り": {"工場全体": "", "品目別": {}},
        "今月来月見込み": {"工場全体": "", "品目別": {}},
        "翌々月発注量": {"品目別": {}},
    }


def write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    master_items = generate_master_items()
    monthly_data = generate_monthly_data(master_items)
    comments = generate_comments_template()

    write_json(data_dir / "master_items.json", master_items)
    write_json(data_dir / "monthly_data.json", monthly_data)
    write_json(data_dir / "comments.json", comments)


if __name__ == "__main__":
    main()
