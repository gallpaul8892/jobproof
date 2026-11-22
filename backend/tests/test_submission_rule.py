"""T-003h: the completeness rule against the case table shared with the Vitest twin."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.services.submission import ItemState, submission_problems

CASES_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "operative" / "submitCases.json"
)
DATA: dict[str, Any] = json.loads(CASES_PATH.read_text())


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_rule_matches_the_shared_case_table(case: dict[str, Any]) -> None:
    items = [ItemState(i["id"], i["status"], i["note"]) for i in case["checklist"]]
    problems = submission_problems(case["photos"], items)
    assert [{"loc": list(p.loc), "message": p.message} for p in problems] == case["problems"]


def test_messages_in_the_table_are_the_ones_the_server_sends() -> None:
    from app.services import submission

    assert DATA["messages"] == {
        "before": submission.MSG_BEFORE,
        "after": submission.MSG_AFTER,
        "item": submission.MSG_ITEM,
    }
