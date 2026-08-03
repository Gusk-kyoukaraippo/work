import json
from pathlib import Path
from typing import Any


class DataLoader:
    """データ読み込み用ユーティリティクラス。"""

    def __init__(self, data_dir: str = "data") -> None:
        self.data_dir = Path(data_dir)

    def _load_json(self, filename: str) -> Any:
        path = self.data_dir / filename
        return json.loads(path.read_text(encoding="utf-8"))

    def load_master_items(self) -> list[dict]:
        return self._load_json("master_items.json")

    def load_monthly_data(self) -> dict:
        return self._load_json("monthly_data.json")

    def load_comments(self) -> dict:
        return self._load_json("comments.json")
