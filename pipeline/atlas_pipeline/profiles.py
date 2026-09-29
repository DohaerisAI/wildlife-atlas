"""Species profiles from Wikidata, Wikipedia and Wikimedia Commons: photos with licences, size, status, identity.

Every value keeps its source. Quantities are normalised to centimetres and grams. Runs from the dev
laptop (Wikimedia is reachable there) and writes small JSON files that are committed as content. Photos are
hotlinked from Commons (a ~1280 px `url` and a 320 px `thumb`), never downloaded.
"""

import json
import logging
import re
from pathlib import Path

import requests

from . import profile_sources as src
from .wikimedia import GetJson, WikimediaError, chunks, make_get_json

log = logging.getLogger(__name__)

__all__ = ["ProfileError", "build_profile", "build_profiles", "make_get_json", "slug", "write_index", "write_profiles"]

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
MAX_OTHER_NAMES = 8
SPECIES_BATCH = 50
LICENCE_NOTE = "Text from Wikipedia (CC BY-SA 4.0). Photos from Wikimedia Commons under the licence shown with each."


class ProfileError(RuntimeError):
    pass


def slug(scientific: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", scientific.lower()).strip("-")


def quantity_range(entity: dict, prop: str) -> dict | None:
    """Min and max across all values and bounds, converted to cm or g. None when absent."""
    nums, unit = [], None
    for v in src.claim_values(entity, prop):
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
    for v in src.claim_values(entity, "P141"):
        code = IUCN.get(v.get("id", ""))
        if code:
            return {"code": code[0], "label": code[1]}
    return None


def caption_for(filename: str) -> str:
    f = filename.lower()
    if re.search(r"\bfemale\b|\(f\)|_f\b| f\.", f):
        return "Female"
    if re.search(r"\bmale\b|\(m\)", f):
        return "Male"
    return ""


def _files(entity: dict) -> list[str]:
    return [f for f in src.claim_values(entity, "P18") if isinstance(f, str)][:MAX_IMAGES]


def _name(entity: dict, sp: dict, wiki_title: str) -> str:
    label = entity.get("labels", {}).get("en", {}).get("value", "")
    sci = sp["sci"]
    name = next((n for n in (label, sp.get("name", ""), wiki_title) if n and n.lower() != sci.lower()), sci)
    return name[:1].upper() + name[1:]


def _identity(sp: dict, entity: dict, ranks: dict, name: str) -> dict:
    tax = dict(ranks)
    if "family" not in tax and sp.get("family"):
        tax["family"] = {"scientific": sp["family"]}  # GBIF backbone family from species.json
    other = src.english_aliases(entity, {name, sp["sci"], entity.get("labels", {}).get("en", {}).get("value", "")})[:MAX_OTHER_NAMES]
    return {**({"taxonomy": tax} if tax else {}), **({"other_names": other} if other else {})}


def assemble(sp: dict, entity: dict, ranks: dict, intro: dict | None, images: dict[str, dict]) -> dict:
    """One profile from already fetched pieces. Missing pieces stay absent."""
    qid = entity["id"]
    wiki_title = entity.get("sitelinks", {}).get("enwiki", {}).get("title", "")
    name = _name(entity, sp, wiki_title)
    photos = [{**images[f], "caption": caption_for(f)} for f in _files(entity) if f in images]
    intro = intro or {}
    return {
        "scientific": sp["sci"], "name": name, "qid": qid,
        "description": entity.get("descriptions", {}).get("en", {}).get("value", ""),
        "extract": intro.get("extract", ""),
        "images": photos,
        "facts": {k: v for k, v in {
            "wingspan": quantity_range(entity, "P2050"), "length": quantity_range(entity, "P2043"),
            "mass": quantity_range(entity, "P2067"), "status": iucn_status(entity),
        }.items() if v},
        **_identity(sp, entity, ranks, name),
        "sources": [
            {"label": "Wikidata", "url": f"https://www.wikidata.org/wiki/{qid}"},
            *([{"label": "Wikipedia", "url": intro["url"]}] if intro.get("url") else []),
        ],
        "licence_note": LICENCE_NOTE,
    }


def build_profiles(species: list[dict], get: GetJson) -> dict[str, dict]:
    """Scientific name -> profile for a batch of species ({sci, k?, name?, family?}). Unresolved species are left out."""
    items = src.resolve_items(species, get)
    ranks = src.taxonomy(items, get)
    linked = {sci: e.get("sitelinks", {}).get("enwiki", {}).get("title") for sci, e in items.items()}
    titles = {sci: t or sci for sci, t in linked.items()}  # no sitelink: try the article the scientific name leads to
    fetched = src.wiki_intros(list(titles.values()), get)
    intros = {sci: i for sci in items if (i := fetched.get(titles[sci])) and (linked[sci] or sci.lower() in i["extract"].lower())}
    images = src.commons_images([f for e in items.values() for f in _files(e)], get)
    by_sci = {s["sci"]: s for s in species}
    return {sci: assemble(by_sci[sci], e, ranks.get(sci, {}), intros.get(sci), images) for sci, e in items.items()}


def build_profile(scientific: str, get: GetJson) -> dict:
    profile = build_profiles([{"sci": scientific}], get).get(scientific)
    if not profile:
        raise ProfileError(f"No Wikidata item has taxon name {scientific!r}")
    return profile


def write_index(out_dir: Path) -> dict[str, dict]:
    """index.json: {slug: {name, sci, thumb}} for every profile on disk, thumb null when there is no photo."""
    index = {}
    for f in sorted(out_dir.glob("*.json")):
        if f.stem == "index":
            continue
        p = json.loads(f.read_text())
        index[f.stem] = {"name": p["name"], "sci": p["scientific"], "thumb": next((i.get("thumb") for i in p.get("images", [])), None)}
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return index


def write_profiles(species: list[dict | str], out_dir: Path, get: GetJson, refresh: bool = False) -> list[str]:
    """Write one profile per species, batch by batch. Existing files are kept unless `refresh` (resumable)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = [{"sci": s} if isinstance(s, str) else s for s in species]
    todo = [s for s in wanted if refresh or not (out_dir / f"{slug(s['sci'])}.json").exists()]
    log.info("profiles: %d to fetch, %d already on disk", len(todo), len(wanted) - len(todo))
    done = []
    for batch in chunks(todo, SPECIES_BATCH):
        try:
            built = build_profiles(batch, get)
        except (WikimediaError, requests.RequestException, KeyError, ValueError) as exc:
            log.warning("profile batch starting %s skipped: %s", batch[0]["sci"], exc)
            continue
        for s in batch:
            profile = built.get(s["sci"])
            if not profile:
                log.warning("no Wikidata item for %s", s["sci"])
                continue
            (out_dir / f"{slug(s['sci'])}.json").write_text(json.dumps(profile, ensure_ascii=False, indent=1))
            done.append(s["sci"])
        log.info("profiles: %d/%d written", len(done), len(todo))
    write_index(out_dir)
    return done
