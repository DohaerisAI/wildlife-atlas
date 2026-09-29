"""Batched lookups behind species profiles: Wikidata items, the taxon parent chain, Wikipedia intros, Commons images.

Each function takes many species at once and asks the APIs in batches (50 ids per `wbgetentities`, 50 titles
per Commons `imageinfo`, 20 per Wikipedia `extracts`). Nothing is guessed: a value that is not found stays out.
"""

import html
import re

from .wikimedia import COMMONS_API, WD_API, WIKI_API, GetJson, chunks

ENTITY_BATCH = 50
SEARCH_BATCH = 25
TITLE_BATCH = 50
EXTRACT_BATCH = 20
MAX_PARENT_LEVELS = 12
THUMB_WIDTH = 320
FULL_WIDTH = 1280

# Wikidata taxon rank items (P105) kept for the Identity section.
RANKS = {"Q34740": "genus", "Q35409": "family", "Q36602": "order", "Q37517": "class"}


def claim_values(entity: dict, prop: str) -> list:
    """Values of a property, preferred rank first, deprecated ones dropped."""
    claims = [c for c in entity.get("claims", {}).get(prop, []) if c.get("rank") != "deprecated" and "datavalue" in c.get("mainsnak", {})]
    claims.sort(key=lambda c: c.get("rank") != "preferred")
    return [c["mainsnak"]["datavalue"]["value"] for c in claims]


def search_items(clauses: list[str], get: GetJson) -> list[str]:
    """QIDs of items matching any `haswbstatement` clause, following search continuation."""
    query = f'haswbstatement:"{"|".join(clauses)}"'
    params = {"action": "query", "list": "search", "srsearch": query, "srlimit": 50, "srprop": "", "format": "json"}
    found: list[str] = []
    while True:
        body = get(WD_API, params)
        found.extend(hit["title"] for hit in body.get("query", {}).get("search", []))
        offset = body.get("continue", {}).get("sroffset")
        if offset is None:
            return found
        params = {**params, "sroffset": offset}


def get_entities(ids: list[str], get: GetJson, props: str = "labels|descriptions|aliases|claims|sitelinks") -> dict[str, dict]:
    out: dict[str, dict] = {}
    for batch in chunks(sorted(set(ids)), ENTITY_BATCH):
        body = get(WD_API, {"action": "wbgetentities", "ids": "|".join(batch), "props": props, "languages": "en", "sitefilter": "enwiki", "format": "json"})
        for qid, entity in body.get("entities", {}).items():
            if "missing" not in entity:
                out[qid] = entity
    return out


def _score(entity: dict, key: str | None, sci: str) -> tuple[int, int, int]:
    return (
        int(bool(key) and key in claim_values(entity, "P846")),
        int(sci in claim_values(entity, "P225")),
        int("enwiki" in entity.get("sitelinks", {})),
    )


def resolve_items(species: list[dict], get: GetJson) -> dict[str, dict]:
    """Scientific name -> best Wikidata item, matched by GBIF taxon key (P846) or taxon name (P225)."""
    keys = [str(s["k"]) for s in species if s.get("k")]
    names = [s["sci"] for s in species]
    candidates: list[str] = []
    for batch in chunks(keys, SEARCH_BATCH):
        candidates += search_items([f"P846={k}" for k in batch], get)
    for batch in chunks(names, SEARCH_BATCH):
        candidates += search_items([f"P225={n}" for n in batch], get)
    entities = get_entities(candidates, get)
    out: dict[str, dict] = {}
    for s in species:
        key = str(s["k"]) if s.get("k") else None
        scored = [(_score(e, key, s["sci"]), qid) for qid, e in entities.items()]
        matches = [(sc, qid) for sc, qid in scored if sc[0] or sc[1]]
        if matches:
            best = max(matches, key=lambda m: (m[0][0] + m[0][1], m[0][2], -int(m[1][1:] or 0)))
            out[s["sci"]] = {**entities[best[1]], "id": best[1]}
    return out


def _parent(entity: dict) -> str | None:
    parents = [v.get("id") for v in claim_values(entity, "P171") if isinstance(v, dict)]
    return parents[0] if parents else None


def _taxon(entity: dict) -> dict | None:
    names = claim_values(entity, "P225")
    if not names:
        return None
    label = entity.get("labels", {}).get("en", {}).get("value", "")
    return {"scientific": names[0], **({"name": label} if label and label.lower() != names[0].lower() else {})}


def taxonomy(items: dict[str, dict], get: GetJson) -> dict[str, dict]:
    """Scientific name -> {genus, family, order, class} walked up P171, level by level for all species at once."""
    cursor = {sci: _parent(e) for sci, e in items.items()}
    found: dict[str, dict] = {sci: {} for sci in items}
    cache: dict[str, dict] = {}
    for _ in range(MAX_PARENT_LEVELS):
        wanted = {q for q in cursor.values() if q and q not in cache}
        cache.update(get_entities(list(wanted), get, props="labels|claims"))
        nxt: dict[str, str | None] = {}
        for sci, qid in cursor.items():
            parent = cache.get(qid or "")
            if not parent or "class" in found[sci]:
                continue
            rank = RANKS.get(next((v.get("id") for v in claim_values(parent, "P105") if isinstance(v, dict)), ""))
            taxon = _taxon(parent)
            if rank and taxon and rank not in found[sci]:
                found[sci] = {**found[sci], rank: taxon}
            nxt[sci] = _parent(parent)
        cursor = nxt
        if not cursor:
            break
    return found


def _title_map(query: dict) -> dict[str, str]:
    """Requested title -> final title, through `normalized` and `redirects`."""
    step = {n["from"]: n["to"] for n in query.get("normalized", [])}
    redirect = {r["from"]: r["to"] for r in query.get("redirects", [])}
    return {k: redirect.get(v, v) for k, v in step.items()} | {k: v for k, v in redirect.items() if k not in step}


def wiki_intros(titles: list[str], get: GetJson) -> dict[str, dict]:
    """Requested title -> {extract (first intro paragraph), url} for existing, non-disambiguation articles."""
    out: dict[str, dict] = {}
    for batch in chunks(sorted(set(titles)), EXTRACT_BATCH):
        body = get(WIKI_API, {
            "action": "query", "titles": "|".join(batch), "redirects": 1, "prop": "extracts|info|pageprops",
            "exintro": 1, "explaintext": 1, "exlimit": EXTRACT_BATCH, "inprop": "url", "ppprop": "disambiguation", "format": "json",
        })
        query = body.get("query", {})
        pages = {p.get("title"): p for p in query.get("pages", {}).values()}
        final = _title_map(query)
        for title in batch:
            page = pages.get(final.get(title, title), {})
            if not page or "missing" in page or "disambiguation" in page.get("pageprops", {}):
                continue
            para = next((p.strip() for p in page.get("extract", "").split("\n") if p.strip()), "")
            out[title] = {"extract": para, "url": page.get("fullurl", "")}
    return out


def _clean(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def _imageinfo(filenames: list[str], get: GetJson, width: int, props: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for batch in chunks(sorted(set(filenames)), TITLE_BATCH):
        requested = [f"File:{f}" for f in batch]
        params = {"action": "query", "titles": "|".join(requested), "prop": "imageinfo", "iiprop": props, "iiurlwidth": width, "format": "json"}
        if "extmetadata" in props:
            params["iiextmetadatafilter"] = "LicenseShortName|Artist"
        query = get(COMMONS_API, params).get("query", {})
        pages = {p.get("title"): p for p in query.get("pages", {}).values()}
        final = _title_map(query)
        for name, title in zip(batch, requested):
            info = (pages.get(final.get(title, title), {}).get("imageinfo") or [None])[0]
            if info:
                out[name] = info
    return out


def _strip_tracking(url: str | None) -> str | None:
    """Drop the utm_* query Commons appends to thumbnail URLs; the file URL itself is unchanged."""
    if not url or "?" not in url:
        return url
    base, query = url.split("?", 1)
    kept = [p for p in query.split("&") if not p.startswith("utm_")]
    return f"{base}?{'&'.join(kept)}" if kept else base


def commons_images(filenames: list[str], get: GetJson) -> dict[str, dict]:
    """Commons filename -> {url, thumb, page, license, artist}. Files without a known licence are left out."""
    full = _imageinfo(filenames, get, FULL_WIDTH, "url|extmetadata")
    thumbs = _imageinfo(list(full), get, THUMB_WIDTH, "url")
    out: dict[str, dict] = {}
    for name, info in full.items():
        md = info.get("extmetadata", {})
        lic = _clean(md.get("LicenseShortName", {}).get("value", ""))
        if not lic:
            continue  # never show an image without a known licence
        thumb = thumbs.get(name, {})
        out[name] = {
            "url": _strip_tracking(info.get("thumburl") or info.get("url")),
            "thumb": _strip_tracking(thumb.get("thumburl") or thumb.get("url") or info.get("thumburl") or info.get("url")),
            "page": info.get("descriptionurl"), "license": lic,
            "artist": _clean(md.get("Artist", {}).get("value", "")) or "Unknown",
        }
    return out


def english_aliases(entity: dict, exclude: set[str]) -> list[str]:
    seen = {e.lower() for e in exclude}
    out: list[str] = []
    for alias in entity.get("aliases", {}).get("en", []):
        value = alias.get("value", "").strip()
        if value and value.lower() not in seen:
            seen.add(value.lower())
            out.append(value)
    return out

