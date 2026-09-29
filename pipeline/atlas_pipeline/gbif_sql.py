"""GBIF SQL downloads: validate, submit (or find the one already submitted), wait, fetch the zip.

Resumable: the download key is written to `state_dir/download.json` as soon as GBIF accepts the
query, and the user's recent downloads are searched for an identical query before submitting again,
so a re-run after a timeout waits on the same download instead of starting a new one.
GBIF answers a valid query with HTTP 201. Credentials come from the environment only.
"""

import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import requests

log = logging.getLogger(__name__)

API = "https://api.gbif.org/v1/occurrence/download"
DONE = "SUCCEEDED"
FAILED = frozenset({"FAILED", "KILLED", "CANCELLED", "FILE_ERASED"})
ACTIVE = frozenset({"PREPARING", "RUNNING", "SUSPENDED", DONE})
USER_AGENT = "wildlife-atlas-prototype/0.1 (noncommercial research prototype)"


class SqlDownloadError(RuntimeError):
    pass


class StillRunning(RuntimeError):
    """The download is accepted but not finished; re-run later to resume."""


class Transport(Protocol):
    def post(self, url: str, body: dict[str, Any]) -> tuple[int, str]: ...
    def get_json(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]: ...
    def fetch_file(self, url: str, dest: Path) -> None: ...


@dataclass(frozen=True)
class Credentials:
    user: str
    password: str
    email: str

    @staticmethod
    def from_env() -> "Credentials":
        missing = [k for k in ("GBIF_USER", "GBIF_PASSWORD", "GBIF_EMAIL") if not os.environ.get(k)]
        if missing:
            raise SqlDownloadError(f"Missing GBIF credentials in the environment: {', '.join(missing)}")
        return Credentials(os.environ["GBIF_USER"], os.environ["GBIF_PASSWORD"], os.environ["GBIF_EMAIL"])


class RequestsTransport:
    def __init__(self, creds: Credentials, timeout_s: float = 120.0):
        self._s = requests.Session()
        self._s.auth = (creds.user, creds.password)
        self._s.headers["User-Agent"] = USER_AGENT
        self._timeout = timeout_s

    def post(self, url: str, body: dict[str, Any]) -> tuple[int, str]:
        r = self._s.post(url, json=body, timeout=self._timeout)
        return r.status_code, r.text

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        for attempt in range(1, 8):
            r = self._s.get(url, params=params, timeout=self._timeout)
            if r.status_code == 200:
                return r.json()
            wait = min(900.0, 60.0 * 2 ** (attempt - 1)) if r.status_code in (429, 503) else 2.0**attempt
            log.warning("GET %s: HTTP %d, retrying in %.0fs", url, r.status_code, wait)
            time.sleep(wait)
        raise SqlDownloadError(f"GET {url} kept failing (last HTTP {r.status_code}: {r.text[:200]!r})")

    def fetch_file(self, url: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with self._s.get(url, stream=True, timeout=self._timeout) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 22):
                    f.write(chunk)
        tmp.replace(dest)


def request_body(sql: str, creds: Credentials) -> dict[str, Any]:
    return {"sendNotification": False, "notificationAddresses": [creds.email], "format": "SQL_TSV_ZIP", "sql": sql}


def validate(sql: str, creds: Credentials, http: Transport) -> None:
    status, text = http.post(f"{API}/request/validate", request_body(sql, creds))
    if status not in (200, 201):
        raise SqlDownloadError(f"GBIF rejected the SQL (HTTP {status}): {text[:800]}")


def find_existing(sql: str, creds: Credentials, http: Transport, running_only: bool = False) -> str | None:
    """Key of a recent download of the same query that is running (or, unless `running_only`, succeeded)."""
    wanted = ACTIVE - {DONE} if running_only else ACTIVE
    body = http.get_json(f"{API}/user/{creds.user}", {"limit": 50})
    for d in body.get("results", []):
        if (d.get("request") or {}).get("sql", "").strip() == sql.strip() and d.get("status") in wanted:
            return d["key"]
    return None


def submit(sql: str, creds: Credentials, http: Transport) -> str:
    status, text = http.post(f"{API}/request", request_body(sql, creds))
    if status not in (200, 201):
        raise SqlDownloadError(f"GBIF refused the download (HTTP {status}): {text[:800]}")
    return text.strip()


def _read_state(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text()) if path.exists() else {}


def _write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(path)


def ensure_submitted(sql: str, state_dir: Path, creds: Credentials, http: Transport, reuse: bool = True) -> str:
    """Download key for this query: from saved state, from GBIF's list of the user's downloads, or new.

    `reuse=False` (a refresh) ignores finished downloads of the same query but still resumes a running one.
    """
    path = state_dir / "download.json"
    state = _read_state(path)
    if state.get("sql") == sql and state.get("key") and (reuse or not state.get("doi")):
        info = http.get_json(f"{API}/{state['key']}")
        if info.get("status") not in FAILED:
            return state["key"]
        log.warning("saved download %s is %s; submitting again", state["key"], info.get("status"))
    key = find_existing(sql, creds, http, running_only=not reuse)
    if key:
        log.info("found this query already submitted as %s", key)
    else:
        validate(sql, creds, http)
        key = submit(sql, creds, http)
        log.info("submitted GBIF SQL download %s", key)
    _write_state(path, {"sql": sql, "key": key, "submitted": int(time.time())})
    return key


def wait_for(key: str, http: Transport, max_wait_s: float, poll_s: float = 60.0,
             sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    """Poll until the download succeeds. Raises StillRunning at the deadline, SqlDownloadError on failure."""
    waited = 0.0
    while True:
        info = http.get_json(f"{API}/{key}")
        status = info.get("status")
        if status == DONE:
            return info
        if status in FAILED:
            raise SqlDownloadError(f"GBIF download {key} ended {status}")
        if waited >= max_wait_s:
            raise StillRunning(f"GBIF download {key} is still {status} after {waited:.0f}s; re-run to resume")
        log.info("download %s: %s (%.0f min)", key, status, waited / 60)
        sleep(poll_s)
        waited += poll_s


def fetch_download(sql: str, state_dir: Path, creds: Credentials, http: Transport, max_wait_s: float,
                   poll_s: float = 60.0, sleep: Callable[[float], None] = time.sleep, reuse: bool = True) -> tuple[Path, dict[str, Any]]:
    """Resumable end to end: the zip on disk plus GBIF's download record (DOI, record count)."""
    key = ensure_submitted(sql, state_dir, creds, http, reuse)
    info = wait_for(key, http, max_wait_s, poll_s, sleep)
    zip_path = state_dir / f"{key}.zip"
    if not zip_path.exists():
        http.fetch_file(info["downloadLink"], zip_path)
    _write_state(state_dir / "download.json", {**_read_state(state_dir / "download.json"),
                                               "doi": info.get("doi"), "totalRecords": info.get("totalRecords"),
                                               "size": info.get("size"), "created": info.get("created")})
    return zip_path, info
