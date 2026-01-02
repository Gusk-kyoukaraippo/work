"""NCBI E-utilities client with rate limiting and retries."""
from __future__ import annotations

import os
import time
import logging
from typing import Dict, List, Optional, Tuple

import xml.etree.ElementTree as ET

import requests


class RateLimiter:
    def __init__(self, rps: float) -> None:
        self.rps = max(0.1, rps)
        self._min_interval = 1.0 / self.rps
        self._last = 0.0

    def wait(self) -> None:
        now = time.time()
        elapsed = now - self._last
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last = time.time()


class PubMedClient:
    BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

    def __init__(self, email: str, tool: str, rps_no_key: int, rps_with_key: int) -> None:
        self.api_key = os.getenv("NCBI_API_KEY", "")
        self.email = email
        self.tool = tool
        rps = rps_with_key if self.api_key else rps_no_key
        self.rate_limiter = RateLimiter(rps)
        self.session = requests.Session()

    def esearch_count(
        self,
        term: str,
        mindate: str,
        maxdate: str,
        datetype: str,
    ) -> int:
        params: Dict[str, str] = {
            "db": "pubmed",
            "term": term,
            "retmode": "xml",
            "retmax": "0",
            "datetype": datetype,
            "mindate": mindate,
            "maxdate": maxdate,
            "tool": self.tool,
            "email": self.email,
        }
        if self.api_key:
            params["api_key"] = self.api_key

        for attempt in range(6):
            self.rate_limiter.wait()
            try:
                resp = self.session.get(self.BASE, params=params, timeout=30)
            except requests.RequestException as exc:
                logging.warning("Request error: %s", exc)
                self._backoff(attempt)
                continue

            if resp.status_code == 200:
                count = self._parse_count(resp.text)
                return count
            if resp.status_code in (429, 500, 502, 503, 504):
                logging.warning("Rate/Server error %s, retrying", resp.status_code)
                self._backoff(attempt)
                continue
            resp.raise_for_status()

        raise RuntimeError("ESearch failed after retries")

    def esearch_history(
        self,
        term: str,
        mindate: str,
        maxdate: str,
        datetype: str,
    ) -> Tuple[int, str, str]:
        params: Dict[str, str] = {
            "db": "pubmed",
            "term": term,
            "retmode": "xml",
            "retmax": "0",
            "usehistory": "y",
            "datetype": datetype,
            "mindate": mindate,
            "maxdate": maxdate,
            "tool": self.tool,
            "email": self.email,
        }
        if self.api_key:
            params["api_key"] = self.api_key

        for attempt in range(6):
            self.rate_limiter.wait()
            try:
                resp = self.session.get(self.BASE, params=params, timeout=30)
            except requests.RequestException as exc:
                logging.warning("Request error: %s", exc)
                self._backoff(attempt)
                continue

            if resp.status_code == 200:
                return self._parse_esearch(resp.text)
            if resp.status_code in (429, 500, 502, 503, 504):
                logging.warning("Rate/Server error %s, retrying", resp.status_code)
                self._backoff(attempt)
                continue
            resp.raise_for_status()

        raise RuntimeError("ESearch history failed after retries")

    def efetch_journals(
        self,
        webenv: str,
        query_key: str,
        retstart: int,
        retmax: int,
    ) -> List[str]:
        params: Dict[str, str] = {
            "db": "pubmed",
            "query_key": query_key,
            "WebEnv": webenv,
            "retstart": str(retstart),
            "retmax": str(retmax),
            "retmode": "xml",
            "tool": self.tool,
            "email": self.email,
        }
        if self.api_key:
            params["api_key"] = self.api_key

        for attempt in range(6):
            self.rate_limiter.wait()
            try:
                resp = self.session.get(self.EFETCH, params=params, timeout=30)
            except requests.RequestException as exc:
                logging.warning("Request error: %s", exc)
                self._backoff(attempt)
                continue

            if resp.status_code == 200:
                return self._parse_journals(resp.text)
            if resp.status_code in (429, 500, 502, 503, 504):
                logging.warning("Rate/Server error %s, retrying", resp.status_code)
                self._backoff(attempt)
                continue
            resp.raise_for_status()

        raise RuntimeError("EFetch failed after retries")

    @staticmethod
    def _parse_count(xml_text: str) -> int:
        start = xml_text.find("<Count>")
        end = xml_text.find("</Count>")
        if start == -1 or end == -1:
            return 0
        count_text = xml_text[start + 7 : end].strip()
        return int(count_text) if count_text.isdigit() else 0

    @staticmethod
    def _parse_esearch(xml_text: str) -> Tuple[int, str, str]:
        root = ET.fromstring(xml_text)
        count_text = root.findtext(".//Count") or "0"
        count = int(count_text) if count_text.isdigit() else 0
        webenv = root.findtext(".//WebEnv") or ""
        query_key = root.findtext(".//QueryKey") or ""
        return count, webenv, query_key

    @staticmethod
    def _parse_journals(xml_text: str) -> List[str]:
        root = ET.fromstring(xml_text)
        journals = []
        for article in root.findall(".//PubmedArticle"):
            journal = article.findtext(".//Journal/Title") or ""
            journal = " ".join(journal.split())
            journals.append(journal or "Unknown Journal")
        return journals

    @staticmethod
    def _backoff(attempt: int) -> None:
        delay = min(60.0, (2 ** attempt))
        time.sleep(delay + (attempt * 0.1))
