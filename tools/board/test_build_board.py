import json
from pathlib import Path

import pytest

import build_board as bb

PYTEST_XML = """<testsuites><testsuite name="pytest">
  <testcase classname="tests.test_a" name="test_ok"/>
  <testcase classname="tests.test_a" name="test_ok2"/>
  <testcase classname="tests.test_b" name="test_bad"><failure message="boom"/></testcase>
  <testcase classname="tests.test_c.TestGroup" name="test_skip"><skipped/></testcase>
</testsuite></testsuites>"""
VITEST_XML = """<testsuites><testsuite name="src/x.test.ts">
  <testcase classname="src/x.test.ts" name="x &gt; works"/>
</testsuite></testsuites>"""


def feature(tmp: Path, fid: str, status="building", checks="", layer="L3"):
    lines = [f"id: {fid}", f"title: {fid.title()}", f"layer: {layer}", f"status: {status}", "summary: Something."]
    lines.append("checks:" + (checks if checks else " []"))
    (tmp / f"{fid}.yaml").write_text("\n".join(lines) + "\n")


@pytest.fixture
def repo(tmp_path):
    feats, reps = tmp_path / "features", tmp_path / "reports"
    feats.mkdir(); reps.mkdir()
    (reps / "pytest.xml").write_text(PYTEST_XML)
    (reps / "vitest.xml").write_text(VITEST_XML)
    return feats, reps, tmp_path / "site"


def test_statuses_from_results(repo):
    feats, reps, out = repo
    feature(feats, "good", checks="\n  - suite: pytest\n    file: tests/test_a.py\n  - suite: vitest\n    file: src/x.test.ts")
    feature(feats, "bad", checks="\n  - suite: pytest\n    file: tests/test_b.py")
    feature(feats, "ghost", checks="\n  - suite: pytest\n    file: tests/test_missing.py")
    feature(feats, "handmade", status="working")
    feature(feats, "someday", status="idea", layer="L1")
    counts = bb.build(feats, reps, out, {"title": "t"})
    assert counts == {"working": 2, "broken": 1, "unverified": 1, "idea": 1}
    data = {f["id"]: f for f in json.loads((out / "board" / "board.json").read_text())["features"]}
    assert data["good"]["passed"] == 3 and data["good"]["verified"] == "tests"
    assert data["bad"]["failures"] == ["tests/test_b.py · test_bad"]
    assert data["handmade"]["verified"] == "manual"
    assert (out / "index.html").read_text().count("board/") >= 1


def test_skipped_tests_do_not_count(repo):
    feats, reps, out = repo
    feature(feats, "skippy", checks="\n  - suite: pytest\n    file: tests/test_c.py")
    assert bb.build(feats, reps, out, {}) == {"unverified": 1}


def test_html_embeds_data_safely(repo):
    feats, reps, out = repo
    (feats / "evil.yaml").write_text("id: evil\ntitle: </script><script>alert(1)</script>\nlayer: L0\nstatus: idea\nsummary: x\n")
    bb.build(feats, reps, out, {})
    page = (out / "board" / "index.html").read_text()
    assert "</script><script>alert(1)" not in page


@pytest.mark.parametrize("body,msg", [
    ("id: other\nlayer: L0\nstatus: idea\n", "must match"),
    ("id: x\nlayer: L9\nstatus: idea\n", "layer"),
    ("id: x\nlayer: L0\nstatus: done\n", "status"),
    ("id: x\nlayer: L0\nstatus: idea\nchecks:\n  - suite: jest\n    file: a\n", "suite"),
])
def test_registry_validation(tmp_path, body, msg):
    (tmp_path / "x.yaml").write_text(body)
    with pytest.raises(bb.RegistryError, match=msg):
        bb.load_features(tmp_path)


def test_pytest_path():
    assert bb.pytest_path("tests.test_classify") == "tests/test_classify.py"
    assert bb.pytest_path("tests.test_classify.TestGroup") == "tests/test_classify.py"
