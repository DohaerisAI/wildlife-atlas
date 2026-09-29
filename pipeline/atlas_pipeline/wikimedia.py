"""Polite JSON client for Wikidata, Wikipedia and Wikimedia Commons.

Descriptive User-Agent, a small pause between requests (one at a time), and retry with backoff on
HTTP 429/5xx, dropped connections or a maxlag reply. Read-only, so no `maxlag` is sent (Wikidata replication lag often sits above 5 s). Everything else fails loudly with WikimediaError.
"""

import logging
import time
from collections.abc import Callable, Iterable, Iterator
from typing import Any, TypeVar

import requests

log = logging.getLogger(__name__)

WD_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "wildlife-atlas/0.1 (https://github.com/DohaerisAI/wildlife-atlas)"

PAUSE_S = 0.2
MAX_ATTEMPTS = 6
BACKOFF_S = 2.0
MAX_BACKOFF_S = 120.0

GetJson = Callable[[str, dict[str, Any]], dict[str, Any]]
T = TypeVar("T")


class WikimediaError(RuntimeError):
    pass


def chunks(items: Iterable[T], size: int) -> Iterator[list[T]]:
    batch: list[T] = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def _retry_after(resp: requests.Response, attempt: int) -> float:
    header = resp.headers.get("Retry-After", "")
    wait = float(header) if header.isdigit() else BACKOFF_S * 2 ** attempt
    return min(wait, MAX_BACKOFF_S)


def make_get_json(session: requests.Session | None = None, sleep: Callable[[float], None] = time.sleep, pause: float = PAUSE_S) -> GetJson:
    http = session or requests.Session()
    http.headers["User-Agent"] = USER_AGENT

    def get(url: str, params: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(MAX_ATTEMPTS):
            sleep(pause)
            try:
                resp = http.get(url, params=params, timeout=60)
            except (requests.ConnectionError, requests.Timeout) as exc:
                wait = min(BACKOFF_S * 2 ** attempt, MAX_BACKOFF_S)
                log.warning("network error for %s (%s); retrying in %.0f s", url, type(exc).__name__, wait)
                sleep(wait)
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                wait = _retry_after(resp, attempt)
                log.warning("HTTP %d from %s; retrying in %.0f s", resp.status_code, url, wait)
                sleep(wait)
                continue
            if resp.status_code != 200:
                raise WikimediaError(f"HTTP {resp.status_code} for {resp.url}")
            body = resp.json()
            if isinstance(body, dict) and body.get("error", {}).get("code") == "maxlag":
                wait = _retry_after(resp, attempt)
                log.warning("Wikidata maxlag; retrying in %.0f s", wait)
                sleep(wait)
                continue
            return body
        raise WikimediaError(f"gave up on {url} after {MAX_ATTEMPTS} attempts")

    return get
