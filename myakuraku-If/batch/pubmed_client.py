from __future__ import annotations

import random
import time
from dataclasses import dataclass

import requests


@dataclass
class PubMedClient:
    api_key: str | None = None
    max_retries: int = 5
    base_backoff: float = 0.5
    base_url: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    strict: bool = False

    def __post_init__(self) -> None:
        self._last_request_time = 0.0

    def _throttle(self) -> None:
        min_interval = 0.1 if self.api_key else 0.34
        elapsed = time.time() - self._last_request_time
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)

    def _build_url(self, params: dict[str, str]) -> str:
        request = requests.Request("GET", self.base_url, params=params).prepare()
        return request.url or self.base_url

    def _request(self, params: dict[str, str]) -> requests.Response:
        for attempt in range(self.max_retries):
            self._throttle()
            try:
                url = self._build_url(params)
                print("[DEBUG] Calling PubMed ESearch API...")
                print(f"[DEBUG] Request URL: {url}")
                print(f"[DEBUG] Request params: {params}")
                response = requests.get(self.base_url, params=params, timeout=20)
                self._last_request_time = time.time()
                print(f"[DEBUG] Response status code: {response.status_code}")
                print(f"[DEBUG] Response body (first 500 chars): {response.text[:500]}")
                if response.status_code != 200:
                    raise RuntimeError(f"HTTP {response.status_code}")
                return response
            except Exception as exc:
                print(f"[DEBUG] Request error: {exc}")
                if attempt >= self.max_retries - 1:
                    raise
                backoff = self.base_backoff * (2**attempt) + random.uniform(0, 0.1)
                time.sleep(backoff)
        raise RuntimeError("unreachable")

    def _make_params(self, query: str) -> dict[str, str]:
        params: dict[str, str] = {
            "db": "pubmed",
            "term": query,
            "retmode": "json",
            "retmax": "0",
        }
        if self.api_key:
            params["api_key"] = self.api_key
        return params

    def build_esearch_url(self, query: str) -> str:
        return self._build_url(self._make_params(query))

    def esearch_count(self, query: str) -> int:
        params = self._make_params(query)
        try:
            response = self._request(params)
            payload = response.json()
        except Exception as exc:
            print(f"[DEBUG] Failed to fetch PubMed count: {exc}")
            if self.strict:
                raise
            return 0
        count_str = payload.get("esearchresult", {}).get("count", "0")
        try:
            count = int(count_str)
        except ValueError:
            count = 0
        print(f"[DEBUG] Extracted paper_count: {count}")
        return count
