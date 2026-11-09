"""T-003 package A: the app version rules, driven by the case table shared with the TypeScript twin.

`shared/src/operative/semverCases.json` is the single source of truth for what a SemVer is (the
contract pattern `^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$`) and for how versions compare.
`shared/src/operative/semver.test.ts` reads the same file.
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest

from app.versioning import is_older, parse_semver

CASES_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "operative" / "semverCases.json"
)
CASES: dict[str, list[dict[str, Any]]] = json.loads(CASES_PATH.read_text())

# The contract pattern, read from the OpenAPI file so a change there fails here too.
CONTRACT = Path(__file__).resolve().parents[2] / "api" / "openapi.yaml"


def test_table_is_not_empty() -> None:
    assert len(CASES["parse"]) >= 20
    assert any(c["ok"] for c in CASES["parse"])
    assert any(not c["ok"] for c in CASES["parse"])
    assert len(CASES["older"]) >= 8


def test_contract_pattern_is_the_one_the_table_assumes() -> None:
    text = CONTRACT.read_text()
    assert r"pattern: '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'" in text


@pytest.mark.parametrize("case", CASES["parse"], ids=lambda c: json.dumps(c["input"]))
def test_parse_semver(case: dict[str, Any]) -> None:
    if case["ok"]:
        assert parse_semver(case["input"]) == tuple(case["parts"])
    else:
        with pytest.raises(ValueError):
            parse_semver(case["input"])


@pytest.mark.parametrize("case", CASES["parse"], ids=lambda c: json.dumps(c["input"]))
def test_contract_pattern_agrees_with_the_table(case: dict[str, Any]) -> None:
    # Python's $ also matches before a trailing newline, so use fullmatch with \Z semantics.
    pattern = re.compile(r"[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}")
    assert (pattern.fullmatch(case["input"]) is not None) is case["ok"]


@pytest.mark.parametrize("case", CASES["older"], ids=lambda c: f"{c['version']}-vs-{c['minimum']}")
def test_is_older(case: dict[str, Any]) -> None:
    assert is_older(case["version"], case["minimum"]) is case["older"]
