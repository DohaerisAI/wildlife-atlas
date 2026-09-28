"""Probe GBIF SQL downloads: validate candidate queries, then run the smallest one end to end.

Needs GBIF_USER / GBIF_PASSWORD / GBIF_EMAIL in the environment. Prints GBIF's replies verbatim
(minus credentials) so we learn which SQL features our account can use.
"""

import io
import json
import os
import sys
import time
import zipfile

import requests

API = "https://api.gbif.org/v1/occurrence/download/request"
AUTH = (os.environ["GBIF_USER"], os.environ["GBIF_PASSWORD"])
EMAIL = os.environ["GBIF_EMAIL"]
POLL_S, MAX_WAIT_S = 30, 50 * 60

WHERE = "species = 'Falco amurensis' AND countrycode = 'IN' AND occurrencestatus = 'PRESENT' AND hascoordinate = TRUE"
CANDIDATES = {
    # Which key does the SQL table use for this species? Filter by name, report keys alongside the grid.
    "by_name_with_keys": (
        'SELECT specieskey, taxonkey, "month", FLOOR(decimallatitude) AS lat0, FLOOR(decimallongitude) AS lng0, COUNT(*) AS n '
        f'FROM occurrence WHERE {WHERE} GROUP BY specieskey, taxonkey, "month", FLOOR(decimallatitude), FLOOR(decimallongitude)'
    ),
}


def body(sql: str) -> dict:
    return {"sendNotification": False, "notificationAddresses": [EMAIL], "format": "SQL_TSV_ZIP", "sql": sql}


def validate(name: str, sql: str) -> bool:
    r = requests.post(f"{API}/validate", json=body(sql), auth=AUTH, timeout=60)
    print(f"--- validate {name}: HTTP {r.status_code}\n{r.text[:800]}\n")
    return r.status_code in (200, 201)  # GBIF answers a valid query with 201


def run(name: str, sql: str) -> int:
    r = requests.post(API, json=body(sql), auth=AUTH, timeout=60)
    print(f"--- submit {name}: HTTP {r.status_code} {r.text[:300]}")
    if r.status_code not in (200, 201):
        return 1
    key = r.text.strip()
    waited = 0
    while waited < MAX_WAIT_S:
        info = requests.get(f"https://api.gbif.org/v1/occurrence/download/{key}", timeout=60).json()
        status = info.get("status")
        print(f"    {waited:>5}s status={status}")
        if status == "SUCCEEDED":
            print(f"    DOI: {info.get('doi')}  records: {info.get('totalRecords')}  size: {info.get('size')}")
            z = requests.get(info["downloadLink"], timeout=300)
            with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
                for n in zf.namelist():
                    rows = zf.read(n).decode("utf-8", "replace").splitlines()
                    print(f"    {n}: {len(rows)} lines")
                    print("\n".join("      " + x for x in rows[:12]))
            return 0
        if status in ("FAILED", "KILLED", "CANCELLED"):
            print(json.dumps(info, indent=1)[:1500])
            return 1
        time.sleep(POLL_S)
        waited += POLL_S
    print("    timed out waiting; the download continues on GBIF and can be fetched later by key", key)
    return 1


def main() -> int:
    who = requests.get("https://api.gbif.org/v1/user/login", auth=AUTH, timeout=30)
    print(f"--- login check: HTTP {who.status_code}")
    if who.status_code != 200:
        print("GBIF rejected the username/password; check the GBIF_USER and GBIF_PASSWORD secrets.")
        return 1
    ok = [n for n, sql in CANDIDATES.items() if validate(n, sql)]
    print(f"valid queries: {ok}")
    if not ok:
        return 1
    return run(ok[0], CANDIDATES[ok[0]])


if __name__ == "__main__":
    sys.exit(main())
