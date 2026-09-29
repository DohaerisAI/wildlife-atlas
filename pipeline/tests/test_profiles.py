import json
import re

import pytest

from atlas_pipeline import profile_sources as src
from atlas_pipeline import profiles as pf
from atlas_pipeline import wikimedia as wm


def snak(value, rank="normal"):
    return {"rank": rank, "mainsnak": {"datavalue": {"value": value}}}


def item(qid_ref):
    return snak({"id": qid_ref})


FALCON = {
    "labels": {"en": {"value": "Amur Falcon"}}, "descriptions": {"en": {"value": "species of bird"}},
    "aliases": {"en": [{"value": "Eastern Red-footed Falcon"}, {"value": "amur falcon"}, {"value": "Falco amurensis"}]},
    "sitelinks": {"enwiki": {"title": "Amur falcon"}},
    "claims": {
        "P225": [snak("Falco amurensis")], "P846": [snak("2481139")], "P171": [item("Q_GENUS")],
        "P18": [snak("Amur Falcon male.jpg"), snak("Amur Falcon (F).jpg"), snak("no licence.jpg")],
        "P2050": [snak({"amount": "+69.5", "lowerBound": "+63", "upperBound": "+76", "unit": "http://www.wikidata.org/entity/Q174728"})],
        "P2067": [snak({"amount": "+125", "unit": "http://www.wikidata.org/entity/Q41803"}), snak({"amount": "+0.15", "unit": "http://www.wikidata.org/entity/Q11570"})],
        "P141": [snak({"id": "Q211005"})],
    },
}
# A thin duplicate item with the same taxon name but no GBIF key or Wikipedia article.
DUPLICATE = {"labels": {"en": {"value": "Falco amurensis"}}, "claims": {"P225": [snak("Falco amurensis")]}}
CRANE = {"labels": {"en": {"value": "Demoiselle crane"}}, "claims": {"P225": [snak("Grus virgo")]}}
TAXA = {
    "Q_GENUS": {"labels": {"en": {"value": "Falco"}}, "claims": {"P225": [snak("Falco")], "P105": [item("Q34740")], "P171": [item("Q_FAMILY")]}},
    "Q_FAMILY": {"labels": {"en": {"value": "falcons"}}, "claims": {"P225": [snak("Falconidae")], "P105": [item("Q35409")], "P171": [item("Q_ORDER")]}},
    "Q_ORDER": {"labels": {"en": {"value": "Falconiformes"}}, "claims": {"P225": [snak("Falconiformes")], "P105": [item("Q36602")], "P171": [item("Q_CLASS")]}},
    "Q_CLASS": {"labels": {"en": {"value": "bird"}}, "claims": {"P225": [snak("Aves")], "P105": [item("Q37517")]}},
}


class FakeWikimedia:
    """Answers the handful of API calls profiles make, and records them."""

    def __init__(self, entities=None, articles=None):
        self.entities = {"Q481742": FALCON, "Q9": DUPLICATE, "Q23759614": CRANE, **TAXA, **(entities or {})}
        self.articles = articles if articles is not None else {
            "Amur falcon": "The Amur falcon (Falco amurensis) is a small raptor.\nIt migrates.",
            "Grus virgo": "The demoiselle crane (Grus virgo) is a species of crane.",
        }
        self.calls = []

    def __call__(self, url, params):
        self.calls.append((url, dict(params)))
        if url == wm.WD_API and params["action"] == "query":
            return self.search(params["srsearch"])
        if url == wm.WD_API and params["action"] == "wbgetentities":
            ids = params["ids"].split("|")
            return {"entities": {q: (self.entities[q] if q in self.entities else {"missing": ""}) for q in ids}}
        if url == wm.WIKI_API:
            return self.wiki(params["titles"].split("|"))
        if url == wm.COMMONS_API:
            return self.commons(params["titles"].split("|"), params["iiurlwidth"], "extmetadata" in params["iiprop"])
        raise AssertionError(url)

    def search(self, query):
        clauses = re.fullmatch(r'haswbstatement:"(.*)"', query).group(1).split("|")
        hits = [q for q, e in self.entities.items() for c in clauses
                if any(v == c.split("=", 1)[1] for v in src.claim_values(e, c.split("=", 1)[0]))]
        return {"query": {"search": [{"title": q} for q in hits]}}

    def wiki(self, titles):
        pages = {str(i): ({"title": t, "extract": self.articles[t], "fullurl": f"https://en.wikipedia.org/wiki/{t.replace(' ', '_')}"}
                          if t in self.articles else {"title": t, "missing": ""}) for i, t in enumerate(titles)}
        return {"query": {"pages": pages}}

    def commons(self, titles, width, with_meta):
        pages = {}
        for i, t in enumerate(titles):
            md = {} if "no licence" in t else {"LicenseShortName": {"value": "CC BY-SA 2.0"}, "Artist": {"value": "<a href='x'>Bernard &amp; Co</a>"}}
            info = {"thumburl": f"https://img/{width}px-{t}?utm_source=commons&utm_campaign=imageinfo", "url": f"https://img/{t}", "descriptionurl": "https://commons/x"}
            pages[str(-i)] = {"title": t, "imageinfo": [{**info, **({"extmetadata": md} if with_meta else {})}]}
        return {"query": {"pages": pages}}


FALCON_ROW = {"k": "2481139", "sci": "Falco amurensis", "name": "Amur Falcon", "family": "Falconidae"}


def test_profile_fields_and_units():
    p = pf.build_profile("Falco amurensis", FakeWikimedia())
    assert p["qid"] == "Q481742" and p["name"] == "Amur Falcon"
    assert p["facts"]["wingspan"] == {"min": 63.0, "max": 76.0, "unit": "cm"}
    assert p["facts"]["mass"] == {"min": 125.0, "max": 150.0, "unit": "g"}  # kg converted
    assert p["facts"]["status"] == {"code": "LC", "label": "Least Concern"}
    assert "length" not in p["facts"]
    assert p["extract"] == "The Amur falcon (Falco amurensis) is a small raptor."
    assert p["sources"][1] == {"label": "Wikipedia", "url": "https://en.wikipedia.org/wiki/Amur_falcon"}


def test_images_need_a_licence_and_carry_full_and_thumb_urls():
    p = pf.build_profile("Falco amurensis", FakeWikimedia())
    assert [i["caption"] for i in p["images"]] == ["Male", "Female"]
    first = p["images"][0]
    assert first["artist"] == "Bernard & Co" and first["license"] == "CC BY-SA 2.0"
    assert first["url"] == f"https://img/{src.FULL_WIDTH}px-File:Amur Falcon male.jpg"  # tracking query dropped
    assert first["thumb"] == f"https://img/{src.THUMB_WIDTH}px-File:Amur Falcon male.jpg"


def test_identity_taxonomy_and_other_names():
    p = pf.build_profiles([FALCON_ROW], FakeWikimedia())["Falco amurensis"]
    assert p["taxonomy"] == {
        "genus": {"scientific": "Falco"}, "family": {"scientific": "Falconidae", "name": "falcons"},
        "order": {"scientific": "Falconiformes"}, "class": {"scientific": "Aves", "name": "bird"},
    }
    assert p["other_names"] == ["Eastern Red-footed Falcon"]  # own name and scientific name dropped


def test_missing_values_stay_absent_and_family_falls_back_to_species_list():
    p = pf.build_profiles([{"sci": "Grus virgo", "family": "Gruidae"}], FakeWikimedia(articles={}))["Grus virgo"]
    assert p["images"] == [] and p["facts"] == {} and p["extract"] == ""
    assert "other_names" not in p
    assert p["taxonomy"] == {"family": {"scientific": "Gruidae"}}
    assert [s["label"] for s in p["sources"]] == ["Wikidata"]


def test_article_found_by_scientific_name_must_mention_it():
    fake = FakeWikimedia()
    assert pf.build_profile("Grus virgo", fake)["extract"].startswith("The demoiselle crane (Grus virgo)")
    fake = FakeWikimedia(articles={"Grus virgo": "Grus is a genus of large birds."})
    assert pf.build_profile("Grus virgo", fake)["extract"] == ""


def test_resolution_prefers_gbif_key_and_wikipedia_article_over_duplicates():
    items = src.resolve_items([FALCON_ROW], FakeWikimedia())
    assert items["Falco amurensis"]["id"] == "Q481742"


def test_unknown_species_raises():
    with pytest.raises(pf.ProfileError):
        pf.build_profile("Falco imaginarius", FakeWikimedia())


def test_calls_are_batched():
    rows = [{"k": str(1000 + i), "sci": f"Species number{i}"} for i in range(120)]
    many = {f"Q{1000 + i}": {"labels": {"en": {"value": f"Bird {i}"}}, "claims": {"P225": [snak(r["sci"])], "P846": [snak(r["k"])], "P18": [snak(f"b{i}.jpg")]}}
            for i, r in enumerate(rows)}
    fake = FakeWikimedia(entities=many, articles={})
    built = pf.build_profiles(rows, fake)
    assert len(built) == 120 and all(p["images"] for p in built.values())
    by_action = lambda action: [p for u, p in fake.calls if u == wm.WD_API and p["action"] == action]  # noqa: E731
    gets = by_action("wbgetentities")
    assert all(len(p["ids"].split("|")) <= src.ENTITY_BATCH for p in gets)
    assert len([p for p in gets if p["props"] != "labels|claims"]) == 3  # 120 items in 50-id batches
    assert len(by_action("query")) == 2 * 5  # 120 keys and 120 names, 25 clauses a search
    commons = [p for u, p in fake.calls if u == wm.COMMONS_API]
    assert len(commons) == 2 * 3 and all(len(p["titles"].split("|")) <= src.TITLE_BATCH for p in commons)
    assert all(len(p["titles"].split("|")) <= src.EXTRACT_BATCH for u, p in fake.calls if u == wm.WIKI_API)


def test_write_profiles_skips_failures_and_indexes_as_object(tmp_path):
    done = pf.write_profiles([FALCON_ROW, "Falco imaginarius", {"sci": "Grus virgo"}], tmp_path, FakeWikimedia())
    assert done == ["Falco amurensis", "Grus virgo"]
    index = json.loads((tmp_path / "index.json").read_text())
    assert index == {
        "falco-amurensis": {"name": "Amur Falcon", "sci": "Falco amurensis", "thumb": f"https://img/{src.THUMB_WIDTH}px-File:Amur Falcon male.jpg"},
        "grus-virgo": {"name": "Demoiselle crane", "sci": "Grus virgo", "thumb": None},
    }


def test_write_profiles_is_resumable(tmp_path):
    pf.write_profiles([FALCON_ROW], tmp_path, FakeWikimedia())
    again = FakeWikimedia()
    assert pf.write_profiles([FALCON_ROW], tmp_path, again) == [] and again.calls == []
    assert "falco-amurensis" in json.loads((tmp_path / "index.json").read_text())
    assert pf.write_profiles([FALCON_ROW], tmp_path, FakeWikimedia(), refresh=True) == ["Falco amurensis"]


def test_slug():
    assert pf.slug("Falco amurensis") == "falco-amurensis"


class FakeResponse:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self.body, self.headers, self.url = status, body or {}, headers or {}, "https://x"

    def json(self):
        return self.body


class FakeSession:
    def __init__(self, responses):
        self.headers, self.responses, self.seen = {}, list(responses), []

    def get(self, url, params, timeout):
        self.seen.append(params)
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def test_client_backs_off_on_429_and_5xx_then_succeeds():
    waits = []
    session = FakeSession([FakeResponse(429, headers={"Retry-After": "7"}), FakeResponse(503), FakeResponse(200, {"ok": 1})])
    get = wm.make_get_json(session, sleep=waits.append, pause=0.1)
    assert get(wm.WD_API, {"a": 1}) == {"ok": 1}
    assert session.headers["User-Agent"] == wm.USER_AGENT
    assert waits == [0.1, 7.0, 0.1, wm.BACKOFF_S * 2, 0.1]


def test_client_retries_dropped_connections():
    import requests

    session = FakeSession([requests.ConnectionError("dns"), FakeResponse(200, {"ok": 1})])
    assert wm.make_get_json(session, sleep=lambda s: None)(wm.WD_API, {}) == {"ok": 1}


def test_client_retries_maxlag_and_gives_up():
    session = FakeSession([FakeResponse(200, {"error": {"code": "maxlag"}})] * wm.MAX_ATTEMPTS)
    with pytest.raises(wm.WikimediaError):
        wm.make_get_json(session, sleep=lambda s: None)(wm.WD_API, {})


def test_client_fails_fast_on_other_errors():
    with pytest.raises(wm.WikimediaError):
        wm.make_get_json(FakeSession([FakeResponse(404)]), sleep=lambda s: None)(wm.WD_API, {})


def test_chunks():
    assert list(wm.chunks(range(5), 2)) == [[0, 1], [2, 3], [4]]
