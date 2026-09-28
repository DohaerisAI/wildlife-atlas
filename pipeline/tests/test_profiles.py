import json

import pytest

from atlas_pipeline import profiles as pf

ENTITY = {
    "labels": {"en": {"value": "Amur Falcon"}}, "descriptions": {"en": {"value": "species of bird"}},
    "sitelinks": {"enwiki": {"title": "Amur falcon"}},
    "claims": {
        "P225": [{"mainsnak": {"datavalue": {"value": "Falco amurensis"}}}],
        "P18": [{"mainsnak": {"datavalue": {"value": "Amur Falcon male.jpg"}}}, {"mainsnak": {"datavalue": {"value": "Amur Falcon (F).jpg"}}}, {"mainsnak": {"datavalue": {"value": "no licence.jpg"}}}],
        "P2050": [{"mainsnak": {"datavalue": {"value": {"amount": "+69.5", "lowerBound": "+63", "upperBound": "+76", "unit": "http://www.wikidata.org/entity/Q174728"}}}}],
        "P2067": [{"mainsnak": {"datavalue": {"value": {"amount": "+125", "unit": "http://www.wikidata.org/entity/Q41803"}}}}, {"mainsnak": {"datavalue": {"value": {"amount": "+0.15", "unit": "http://www.wikidata.org/entity/Q11570"}}}}],
        "P141": [{"mainsnak": {"datavalue": {"value": {"id": "Q211005"}}}}],
    },
}


def fake_get(url, params):
    if url == pf.WD_API:
        return {"search": [{"id": "Q1"}, {"id": "Q481742"}]}
    if "EntityData/Q1" in url:
        return {"entities": {"Q1": {"claims": {"P225": [{"mainsnak": {"datavalue": {"value": "Something else"}}}]}}}}
    if "EntityData/Q481742" in url:
        return {"entities": {"Q481742": ENTITY}}
    if url == pf.COMMONS_API:
        name = params["titles"]
        md = {} if "no licence" in name else {"LicenseShortName": {"value": "CC BY-SA 2.0"}, "Artist": {"value": "<a href='x'>Bernard &amp; Co</a>"}}
        return {"query": {"pages": {"1": {"imageinfo": [{"thumburl": f"https://img/{name}", "descriptionurl": "https://commons/x", "extmetadata": md}]}}}}
    if "summary" in url:
        return {"extract": "The Amur falcon is a small raptor.", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Amur_falcon"}}}
    raise AssertionError(url)


def test_profile_fields_and_units():
    p = pf.build_profile("Falco amurensis", fake_get)
    assert p["qid"] == "Q481742" and p["name"] == "Amur Falcon"
    assert p["facts"]["wingspan"] == {"min": 63.0, "max": 76.0, "unit": "cm"}
    assert p["facts"]["mass"] == {"min": 125.0, "max": 150.0, "unit": "g"}  # kg converted
    assert p["facts"]["status"] == {"code": "LC", "label": "Least Concern"}
    assert "length" not in p["facts"]


def test_images_need_a_licence_and_get_sex_captions():
    p = pf.build_profile("Falco amurensis", fake_get)
    assert [i["caption"] for i in p["images"]] == ["Male", "Female"]
    assert p["images"][0]["artist"] == "Bernard & Co"


def test_unknown_species_raises():
    with pytest.raises(pf.ProfileError):
        pf.find_qid("Falco imaginarius", lambda url, params: {"search": []})


def test_write_profiles_skips_failures_and_indexes(tmp_path):
    done = pf.write_profiles(["Falco amurensis", "Falco imaginarius"], tmp_path, fake_get)
    assert done == ["Falco amurensis"]
    assert json.loads((tmp_path / "index.json").read_text()) == ["falco-amurensis"]


def test_slug():
    assert pf.slug("Falco amurensis") == "falco-amurensis"
