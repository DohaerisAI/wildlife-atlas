# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6"]
# ///
"""Build the living feature board from features/*.yaml and JUnit test reports.

A feature with checks is working when every listed test file ran and passed, broken when any
failed, and unverified when none of its tests ran. A feature without checks keeps its declared stage.
Output: <out>/board/index.html and <out>/board/board.json (plus a root redirect).
"""

import argparse
import html
import json
import os
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import yaml

LAYERS = {
    "L0": "Sources",
    "L1": "Models",
    "L2": "Products",
    "L3": "Engine",
    "L4": "Experiences",
}
STAGES = ("idea", "planned", "building", "working")
SUITES = ("pytest", "vitest")
STATUS_ORDER = ("broken", "unverified", "working", "building", "planned", "idea")


class RegistryError(ValueError):
    pass


@dataclass(frozen=True)
class Check:
    suite: str
    file: str


@dataclass
class Feature:
    id: str
    title: str
    layer: str
    stage: str
    summary: str
    paths: list[str]
    checks: list[Check]
    next: str = ""
    status: str = ""
    verified: str = ""
    passed: int = 0
    failed: int = 0
    failures: list[str] = field(default_factory=list)


def load_features(folder: Path) -> list[Feature]:
    features, seen = [], set()
    for path in sorted(folder.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text()) or {}
        fid = raw.get("id")
        where = f"{path.name}"
        if fid != path.stem:
            raise RegistryError(f"{where}: id {fid!r} must match the file name")
        if fid in seen:
            raise RegistryError(f"{where}: duplicate id {fid!r}")
        if raw.get("layer") not in LAYERS:
            raise RegistryError(f"{where}: layer must be one of {', '.join(LAYERS)}")
        if raw.get("status") not in STAGES:
            raise RegistryError(f"{where}: status must be one of {', '.join(STAGES)}")
        checks = []
        for c in raw.get("checks") or []:
            if c.get("suite") not in SUITES or not c.get("file"):
                raise RegistryError(f"{where}: each check needs suite ({'/'.join(SUITES)}) and file")
            checks.append(Check(c["suite"], c["file"]))
        seen.add(fid)
        features.append(Feature(
            id=fid, title=str(raw.get("title", fid)), layer=raw["layer"], stage=raw["status"],
            summary=str(raw.get("summary", "")).strip(), paths=list(raw.get("paths") or []),
            checks=checks, next=str(raw.get("next", "") or "").strip(),
        ))
    return features


def pytest_path(classname: str) -> str:
    """'tests.test_classify' or 'tests.test_classify.TestX' -> 'tests/test_classify.py'."""
    parts = classname.split(".")
    while parts and not parts[-1].startswith("test_"):
        parts.pop()
    return "/".join(parts) + ".py" if parts else classname


def load_results(reports: Path) -> dict[tuple[str, str], list[tuple[str, bool]]]:
    """Map (suite, file) -> [(test name, passed)] from pytest.xml and vitest.xml."""
    results: dict[tuple[str, str], list[tuple[str, bool]]] = {}
    for suite in SUITES:
        report = reports / f"{suite}.xml"
        if not report.exists():
            continue
        for case in ET.parse(report).getroot().iter("testcase"):
            if case.find("skipped") is not None:
                continue
            cls = case.get("classname", "")
            file = pytest_path(cls) if suite == "pytest" else (case.get("file") or cls)
            ok = case.find("failure") is None and case.find("error") is None
            results.setdefault((suite, file), []).append((case.get("name", ""), ok))
    return results


def evaluate(features: list[Feature], results: dict) -> list[Feature]:
    for f in features:
        if not f.checks:
            f.status, f.verified = f.stage, ("manual" if f.stage == "working" else "")
            continue
        cases = [(name, ok, c.file) for c in f.checks for name, ok in results.get((c.suite, c.file), [])]
        f.passed = sum(1 for _, ok, _ in cases if ok)
        f.failed = sum(1 for _, ok, _ in cases if not ok)
        f.failures = [f"{file} · {name}" for name, ok, file in cases if not ok][:8]
        f.verified = "tests"
        f.status = "unverified" if not cases else ("broken" if f.failed else "working")
    return features


def render(features: list[Feature], meta: dict) -> str:
    counts = Counter(f.status for f in features)
    total = len(features)
    tpl = (Path(__file__).parent / "template.html").read_text()
    data = {"meta": meta, "features": [asdict(f) for f in features], "counts": dict(counts), "total": total,
            "layers": LAYERS, "order": STATUS_ORDER}
    payload = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    return tpl.replace("__BOARD_DATA__", payload).replace("__TITLE__", html.escape(meta.get("title", "Atlas board")))


def build(features_dir: Path, reports_dir: Path, out_dir: Path, meta: dict) -> dict:
    features = evaluate(load_features(features_dir), load_results(reports_dir))
    board = out_dir / "board"
    board.mkdir(parents=True, exist_ok=True)
    (board / "index.html").write_text(render(features, meta))
    (board / "board.json").write_text(json.dumps({"meta": meta, "features": [asdict(f) for f in features]}, indent=1))
    root = out_dir / "index.html"
    if not root.exists():
        root.write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=board/"><title>Wildlife Atlas</title><a href="board/">Wildlife Atlas board</a>\n')
    return dict(Counter(f.status for f in features))


def ci_meta() -> dict:
    server, repo, run = os.environ.get("GITHUB_SERVER_URL"), os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    sha = os.environ.get("GITHUB_SHA", "")
    return {
        "title": "Wildlife Atlas board",
        "generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "commit": sha[:7],
        "commit_url": f"{server}/{repo}/commit/{sha}" if server and repo and sha else "",
        "run_url": f"{server}/{repo}/actions/runs/{run}" if server and repo and run else "",
        "repo_url": f"{server}/{repo}" if server and repo else "",
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--features", type=Path, default=Path("features"))
    ap.add_argument("--reports", type=Path, default=Path("reports"))
    ap.add_argument("--out", type=Path, default=Path("site"))
    args = ap.parse_args(argv)
    try:
        counts = build(args.features, args.reports, args.out, ci_meta())
    except (RegistryError, ET.ParseError, yaml.YAMLError) as exc:
        print(f"board: {exc}", file=sys.stderr)
        return 1
    print("board:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
