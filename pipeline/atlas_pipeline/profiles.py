"""Species profiles from Wikidata, Wikipedia and Wikimedia Commons: photos with licences, size, status.

Every value keeps its source. Quantities are normalised to centimetres and grams. Runs from the dev
laptop (Wikimedia is reachable there) and writes small JSON files that are committed as content.
"""

import html
import json
import logging
import re
import urllib.parse
from collections.abc import Callable
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)

WD_API = "https://www.wikidata.org/w/api.php"
WD_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
USER_AGENT = "wildlife-atlas/0.1 (https://github.com/DohaerisAI/wildlife-atlas)"

GetJson = Callable[[str, dict[str, Any]], dict[str, Any]]

# Wikidata unit items -> (target unit, factor)
UNITS = {
    "Q174728": ("cm", 1.0), "Q11573": ("cm", 100.0), "Q174789": ("cm", 0.1),
    "Q41803": ("g", 1.0), "Q11570": ("g", 1000.0),
}
IUCN = {
    "Q211005": ("LC", "Least Concern"), "Q719675": ("NT", "Near Threatened"), "Q278113": ("VU", "Vulnerable"),
    "Q11394": ("EN", "Endangered"), "Q219127": ("CR", "Critically Endangered"), "Q239509": ("EW", "Extinct in the Wild"),
    "Q237350": ("EX", "Extinct"), "Q3245245": ("DD", "Data Deficient"),
}
MAX_IMAGES = 3


class ProfileError(RuntimeError):
    pass


def make_get_json() -> GetJson:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    def get(url: str, params: dict[str, Any]) -> dict[str, Any]:
        r = session.get(url, params=params, timeout=30)
        if r.status_code != 200:
            raise ProfileError(f"HTTP {r.status_code} for {r.url}")
        return r.json()

    return get


def slug(scientific: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", scientific.lower()).strip("-")


def find_qid(scientific: str, get: GetJson) -> tuple[str, dict]:
    hits = get(WD_API, {"action": "wbsearchentities", "search": scientific, "language": "en", "type": "item", "limit": 7, "format": "json"}).get("search", [])
    for hit in hits:
        entity = get(WD_ENTITY.format(qid=hit["id"]), {})["entities"][hit["id"]]
        if scientific in _values(entity, "P225"):
            return hit["id"], entity
    raise ProfileError(f"No Wikidata item has taxon name {scientific!r}")


def _values(entity: dict, prop: str) -> list:
    return [c["mainsnak"]["datavalue"]["value"] for c in entity.get("claims", {}).get(prop, []) if "datavalue" in c.get("mainsnak", {})]


def quantity_range(entity: dict, prop: str) -> dict | None:
    """Min and max across all values and bounds, converted to cm or g. None when absent."""
    nums, unit = [], None
    for v in _values(entity, prop):
        u = UNITS.get(str(v.get("unit", "")).rsplit("/", 1)[-1])
        if not u:
            continue
        unit = u[0]
        for key in ("amount", "lowerBound", "upperBound"):
            if key in v:
                nums.append(float(v[key]) * u[1])
    if not nums:
        return None
    return {"min": round(min(nums), 1), "max": round(max(nums), 1), "unit": unit}


def iucn_status(entity: dict) -> dict | None:
    for v in _values(entity, "P141"):
        code = IUCN.get(v.get("id", ""))
        if code:
            return {"code": code[0], "label": code[1]}
    return None


def _clean(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def caption_for(filename: str) -> str:
    f = filename.lower()
    if re.search(r"\bfemale\b|\(f\)|_f\b| f\.", f):
        return "Female"
    if re.search(r"\bmale\b|\(m\)", f):
        return "Male"
    return ""


def commons_image(filename: str, get: GetJson) -> dict | None:
    body = get(COMMONS_API, {"action": "query", "titles": f"File:{filename}", "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 900, "format": "json"})
    page = next(iter(body.get("query", {}).get("pages", {}).values()), {})
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return None
    md = info.get("extmetadata", {})
    lic = _clean(md.get("LicenseShortName", {}).get("value", ""))
    if not lic:
        return None  # never show an image without a known licence
    return {
        "url": info.get("thumburl") or info.get("url"), "page": info.get("descriptionurl"),
        "license": lic, "artist": _clean(md.get("Artist", {}).get("value", "")) or "Unknown",
        "caption": caption_for(filename),
    }


def build_profile(scientific: str, get: GetJson) -> dict:
    qid, entity = find_qid(scientific, get)
    title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")
    summary = get(WIKI_SUMMARY.format(title=urllib.parse.quote(title.replace(" ", "_"))), {}) if title else {}
    images = [img for f in _values(entity, "P18")[:MAX_IMAGES] if (img := commons_image(f, get))]
    label = entity.get("labels", {}).get("en", {}).get("value", "")
    name = label if label and label.lower() != scientific.lower() else summary.get("title", "") or scientific
    name = name[:1].upper() + name[1:]
    return {
        "scientific": scientific, "name": name, "qid": qid,
        "description": entity.get("descriptions", {}).get("en", {}).get("value", ""),
        "extract": summary.get("extract", ""),
        "images": images,
        "facts": {k: v for k, v in {
            "wingspan": quantity_range(entity, "P2050"), "length": quantity_range(entity, "P2043"),
            "mass": quantity_range(entity, "P2067"), "status": iucn_status(entity),
        }.items() if v},
        "sources": [
            {"label": "Wikidata", "url": f"https://www.wikidata.org/wiki/{qid}"},
            *([{"label": "Wikipedia", "url": summary["content_urls"]["desktop"]["page"]}] if summary.get("content_urls") else []),
        ],
        "licence_note": "Text from Wikipedia (CC BY-SA 4.0). Photos from Wikimedia Commons under the licence shown with each.",
    }


def write_profiles(names: list[str], out_dir: Path, get: GetJson) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    done = []
    for name in names:
        try:
            profile = build_profile(name, get)
        except (ProfileError, requests.RequestException, KeyError) as exc:
            log.warning("profile skipped for %s: %s", name, exc)
            continue
        (out_dir / f"{slug(name)}.json").write_text(json.dumps(profile, ensure_ascii=False, indent=1))
        done.append(name)
        log.info("profile: %s (%d photos, %s)", profile["name"], len(profile["images"]), ", ".join(profile["facts"]))
    (out_dir / "index.json").write_text(json.dumps(sorted(f.stem for f in out_dir.glob("*.json") if f.stem != "index")))
    return done
