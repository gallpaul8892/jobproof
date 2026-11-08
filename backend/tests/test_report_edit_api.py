"""T-002i: PATCH /manager/reports/{id} (notes, checklist, optimistic concurrency, reopen)."""

import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.contract import assert_contract
from tests.expected import parse_ts
from tests.write_helpers import (
    BASE,
    MANAGER2_NAME,
    MANAGER_NAME,
    awaiting_reports,
    checklist_report,
    dashboard,
    detail,
    event_count,
    history,
    patch,
    report_row,
    review,
    reviewed_reports,
)

pytestmark = pytest.mark.usefixtures("reseed")


def _target(ds: Any) -> Any:
    return checklist_report(ds)


# ---- scenario 1 to 3: what can be edited -------------------------------------------------------


def test_painter_notes_change(client: TestClient, manager_headers: dict[str, str], ds: Any) -> None:
    target = awaiting_reports(ds)[0]
    old = target.painter_notes
    response = patch(
        client, manager_headers, target.id, {"version": 1, "painter_notes": "Two coats on walls."}
    )
    assert response.status_code == 200
    assert_contract(response, "updateManagerReport")
    body = response.json()
    assert body["painter_notes"] == "Two coats on walls."
    assert body["version"] == 2
    assert body["review_status"] == "awaiting_review"
    assert body["last_changed_by"]["name"] == MANAGER_NAME
    assert parse_ts(body["last_changed_at"]).isoformat().startswith("2026-10-15T10:00:00")
    events = history(client, manager_headers, target.id)
    assert events["total"] == 1
    event = events["items"][0]
    assert event["action"] == "report.edited" and event["actor"]["name"] == MANAGER_NAME
    assert event["changes"] == [
        {
            "field": "painter_notes",
            "item_id": None,
            "item_label": None,
            "old_value": old,
            "new_value": "Two coats on walls.",
        }
    ]
    assert detail(client, manager_headers, target.id) == body


def test_checklist_edit_touches_only_the_sent_item(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = _target(ds)
    before = detail(client, manager_headers, target.id)
    item = before["checklist"][1]
    response = patch(
        client,
        manager_headers,
        target.id,
        {
            "version": 1,
            "checklist": [
                {"id": item["id"], "done": not item["done"], "note": "Confirmed by phone"}
            ],
        },
    )
    assert response.status_code == 200
    assert_contract(response, "updateManagerReport")
    after = response.json()
    assert after["checklist"][1] == {
        **item,
        "done": not item["done"],
        "note": "Confirmed by phone",
    }
    for index in (0, 2):
        assert after["checklist"][index] == before["checklist"][index]
    assert len(after["checklist"]) == len(before["checklist"])
    for key in ("photos", "painter_notes", "job", "customer", "painter", "invoice", "quote"):
        assert after[key] == before[key], key
    events = history(client, manager_headers, target.id)["items"]
    assert len(events) == 1
    assert [(c["field"], c["item_id"], c["item_label"]) for c in events[0]["changes"]] == [
        ("checklist_done", item["id"], item["label"]),
        ("checklist_note", item["id"], item["label"]),
    ]
    assert events[0]["changes"][0]["old_value"] is item["done"]
    assert events[0]["changes"][0]["new_value"] is (not item["done"])
    assert events[0]["changes"][1]["new_value"] == "Confirmed by phone"


def test_checklist_note_only_and_done_only(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = _target(ds)
    items = detail(client, manager_headers, target.id)["checklist"]
    one = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "checklist": [{"id": items[0]["id"], "note": "Only a note"}]},
    ).json()
    assert one["checklist"][0]["done"] == items[0]["done"]
    assert one["checklist"][0]["note"] == "Only a note"
    two = patch(
        client,
        manager_headers,
        target.id,
        {"version": 2, "checklist": [{"id": items[0]["id"], "done": not items[0]["done"]}]},
    ).json()
    assert two["checklist"][0]["note"] == "Only a note"
    assert two["checklist"][0]["done"] is (not items[0]["done"])
    assert two["version"] == 3


def test_several_checklist_items_and_notes_in_one_request_is_one_version(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = _target(ds)
    items = detail(client, manager_headers, target.id)["checklist"]
    body = {
        "version": 1,
        "painter_notes": "P",
        "manager_notes": "M",
        "checklist": [{"id": i["id"], "note": f"n{n}"} for n, i in enumerate(items[:3])],
    }
    response = patch(client, manager_headers, target.id, body)
    assert response.status_code == 200 and response.json()["version"] == 2
    events = history(client, manager_headers, target.id)
    assert events["total"] == 1
    assert len(events["items"][0]["changes"]) == 5


def test_manager_notes_are_stored_and_painter_notes_untouched(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "manager_notes": "Customer asked for invoice by email."},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["manager_notes"] == "Customer asked for invoice by email."
    assert body["painter_notes"] == target.painter_notes
    change = history(client, manager_headers, target.id)["items"][0]["changes"][0]
    assert (change["field"], change["old_value"]) == ("manager_notes", None)


# ---- scenario 4: reopening ---------------------------------------------------------------------


def test_editing_a_reviewed_report_reopens_it(
    client: TestClient, manager2_headers: dict[str, str], ds: Any
) -> None:
    target = reviewed_reports(ds)[0]
    reviewed_at = target.reviewed_at
    assert dashboard(client, manager2_headers)["reports_awaiting_review"] == 9
    response = patch(
        client, manager2_headers, target.id, {"version": 1, "painter_notes": "Corrected typo."}
    )
    assert response.status_code == 200
    assert_contract(response, "updateManagerReport")
    body = response.json()
    assert body["review_status"] == "awaiting_review"
    assert body["reviewed_by"] is None and body["reviewed_at"] is None
    assert body["version"] == 2  # one bump for the edit and the reopen together
    assert dashboard(client, manager2_headers)["reports_awaiting_review"] == 10
    events = history(client, manager2_headers, target.id)["items"]
    assert [e["action"] for e in events] == ["report.reopened", "report.edited"]
    reopened = events[0]
    assert reopened["actor"]["name"] == MANAGER2_NAME
    by_field = {c["field"]: c for c in reopened["changes"]}
    assert by_field["review_status"]["old_value"] == "reviewed"
    assert by_field["review_status"]["new_value"] == "awaiting_review"
    assert by_field["reviewed_by"]["old_value"] == MANAGER_NAME
    assert by_field["reviewed_by"]["new_value"] is None
    assert parse_ts(by_field["reviewed_at"]["old_value"]) == reviewed_at
    assert all("old_id" not in c for c in reopened["changes"])


def test_reopen_keeps_the_previous_reviewer_id_in_the_stored_event(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = reviewed_reports(ds)[0]
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "x"})
    with db_engine.connect() as connection:
        changes = connection.execute(
            text("SELECT changes FROM audit_events WHERE action = 'report.reopened'")
        ).scalar_one()
    reviewer = next(c for c in changes if c["field"] == "reviewed_by")
    assert reviewer["old_id"] == str(target.reviewed_by_id)


def test_version_tracks_review_then_edit_then_review(
    client: TestClient, manager_headers: dict[str, str], manager2_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    assert review(client, manager_headers, target.id, 1).json()["version"] == 2
    edited = patch(client, manager2_headers, target.id, {"version": 2, "manager_notes": "again"})
    assert edited.json()["version"] == 3
    assert edited.json()["review_status"] == "awaiting_review"
    again = review(client, manager2_headers, target.id, 3)
    assert again.status_code == 200 and again.json()["version"] == 4
    actions = [e["action"] for e in history(client, manager_headers, target.id)["items"]]
    assert actions == ["report.reviewed", "report.reopened", "report.edited", "report.reviewed"]


# ---- scenario 5: no-ops ------------------------------------------------------------------------


def test_repeating_current_values_changes_nothing(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = reviewed_reports(ds)[0]
    current = detail(client, manager_headers, target.id)
    before = report_row(db_engine, target.id)
    item = current["checklist"][0]
    response = patch(
        client,
        manager_headers,
        target.id,
        {
            "version": 1,
            "painter_notes": current["painter_notes"],
            "manager_notes": None,
            "checklist": [{"id": item["id"], "done": item["done"], "note": item["note"]}],
        },
    )
    assert response.status_code == 200
    assert_contract(response, "updateManagerReport")
    assert response.json() == current
    assert response.json()["review_status"] == "reviewed"
    assert report_row(db_engine, target.id) == before  # not even updated_at moved
    assert event_count(db_engine) == 0


@pytest.mark.parametrize("blank", ["", "   ", "\n\t "])
def test_blank_notes_on_a_report_with_no_notes_are_a_no_op(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, blank: str
) -> None:
    target = awaiting_reports(ds)[0]
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": None})
    assert detail(client, manager_headers, target.id)["version"] == 1
    response = patch(client, manager_headers, target.id, {"version": 1, "manager_notes": blank})
    assert response.status_code == 200 and response.json()["version"] == 1
    assert event_count(db_engine) == 0


def test_a_stale_no_op_is_still_a_conflict(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "a"})
    response = patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "a"})
    assert response.status_code == 409


# ---- scenario 6: stale versions ----------------------------------------------------------------


def test_stale_edit_is_409_with_current_values_and_writes_nothing(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
) -> None:
    target = _target(ds)
    items = detail(client, manager_headers, target.id)["checklist"]
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "m1"})
    patch(client, manager_headers, target.id, {"version": 2, "manager_notes": "m2"})
    priya = patch(
        client,
        manager2_headers,
        target.id,
        {
            "version": 3,
            "painter_notes": "Priya's text",
            "checklist": [{"id": items[0]["id"], "note": "p"}],
        },
    )
    assert priya.json()["version"] == 4
    before = report_row(db_engine, target.id)
    events = event_count(db_engine)
    response = patch(
        client,
        manager_headers,
        target.id,
        {
            "version": 3,
            "painter_notes": "Sarah's text",
            "manager_notes": "other",
            "checklist": [
                {"id": items[0]["id"], "done": True},
                {"id": items[1]["id"], "note": "z"},
            ],
        },
    )
    assert response.status_code == 409
    assert_contract(response, "updateManagerReport")
    body = response.json()
    assert body["code"] == "version_conflict"
    assert body["current_version"] == 4
    assert body["last_changed_by"]["name"] == MANAGER2_NAME
    assert body["review_status"] == "awaiting_review"
    assert body["current"]["painter_notes"] == "Priya's text"
    assert body["current"]["manager_notes"] == "m2"
    assert body["current"]["checklist"] == [
        {"id": items[0]["id"], "done": items[0]["done"], "note": "p"},
        {"id": items[1]["id"], "done": items[1]["done"], "note": items[1]["note"]},
    ]
    assert report_row(db_engine, target.id) == before
    assert event_count(db_engine) == events


def test_conflict_current_covers_only_fields_the_body_tried_to_change(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "m"})
    response = patch(client, manager_headers, target.id, {"version": 1, "painter_notes": "x"})
    assert set(response.json()["current"]) == {"painter_notes"}


def test_a_stale_edit_of_a_reviewed_report_does_not_reopen_it(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = reviewed_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = patch(client, manager_headers, target.id, {"version": 7, "painter_notes": "x"})
    assert response.status_code == 409
    assert response.json()["review_status"] == "reviewed"
    assert response.json()["reviewed_by"]["name"] == MANAGER_NAME
    assert report_row(db_engine, target.id) == before


# ---- scenario 8: read-only fields --------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"photos": []},
        {"photos": [{"id": str(uuid.uuid4()), "caption": "x"}]},
        {"review_status": "reviewed"},
        {"reviewed_by": {"id": str(uuid.uuid4()), "name": "x"}},
        {"reviewed_at": "2026-01-01T00:00:00Z"},
        {"last_changed_by": "x"},
        {"job": {"title": "x"}},
        {"customer": {"name": "x"}},
        {"painter": {"name": "x"}},
        {"id": str(uuid.uuid4())},
        {"foo": 1},
        {"submitted_at": "2026-01-01T00:00:00Z"},
        {"__proto__": {"x": 1}},
    ],
    ids=lambda e: next(iter(e)),
)
def test_read_only_and_unknown_fields_are_422_and_change_nothing(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, extra: Any
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = patch(
        client, manager_headers, target.id, {"version": 1, "painter_notes": "valid", **extra}
    )
    assert response.status_code == 422
    assert_contract(response, "updateManagerReport")
    key = next(iter(extra))
    assert ["body", key] in [e["loc"] for e in response.json()["errors"]]
    assert report_row(db_engine, target.id) == before
    assert event_count(db_engine) == 0


@pytest.mark.parametrize(
    "item_extra",
    [{"label": "New label"}, {"position": 3}, {"report_id": "x"}, {"remove": True}, {"foo": 1}],
)
def test_checklist_structure_is_read_only(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, item_extra: Any
) -> None:
    target = _target(ds)
    item = detail(client, manager_headers, target.id)["checklist"][0]
    before = report_row(db_engine, target.id)
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "checklist": [{"id": item["id"], "done": True, **item_extra}]},
    )
    assert response.status_code == 422
    key = next(iter(item_extra))
    assert ["body", "checklist", 0, key] in [e["loc"] for e in response.json()["errors"]]
    assert report_row(db_engine, target.id) == before


def test_a_new_checklist_item_without_a_known_id_is_422(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = _target(ds)
    before = report_row(db_engine, target.id)
    for item in ({"label": "Brand new", "done": True}, {"id": str(uuid.uuid4()), "done": True}):
        response = patch(client, manager_headers, target.id, {"version": 1, "checklist": [item]})
        assert response.status_code == 422
    assert report_row(db_engine, target.id) == before


def test_a_checklist_id_of_another_report_is_422_and_nothing_is_saved(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    mine, other = awaiting_reports(ds)[0], awaiting_reports(ds)[1]
    foreign = detail(client, manager_headers, other.id)["checklist"][0]["id"]
    own = detail(client, manager_headers, mine.id)["checklist"][0]["id"]
    before = report_row(db_engine, mine.id)
    other_before = report_row(db_engine, other.id)
    response = patch(
        client,
        manager_headers,
        mine.id,
        {
            "version": 1,
            "painter_notes": "valid notes",
            "checklist": [{"id": own, "done": True}, {"id": foreign, "done": True}],
        },
    )
    assert response.status_code == 422
    assert_contract(response, "updateManagerReport")
    assert response.json()["errors"][0]["loc"] == ["body", "checklist", 1, "id"]
    assert report_row(db_engine, mine.id) == before
    assert report_row(db_engine, other.id) == other_before
    assert event_count(db_engine) == 0


def test_duplicate_checklist_ids_are_422(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = _target(ds)
    item = detail(client, manager_headers, target.id)["checklist"][0]["id"]
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "checklist": [{"id": item, "done": True}, {"id": item, "note": "x"}]},
    )
    assert response.status_code == 422
    assert ["body", "checklist"] in [e["loc"] for e in response.json()["errors"]]


# ---- scenario 9: validation --------------------------------------------------------------------


def _item_id(client: TestClient, headers: dict[str, str], ds: Any) -> tuple[Any, str]:
    target = _target(ds)
    return target, detail(client, headers, target.id)["checklist"][0]["id"]


def test_validation_reports_one_entry_per_problem(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    response = patch(
        client,
        manager_headers,
        target.id,
        {
            "version": 1,
            "painter_notes": "x" * 5001,
            "manager_notes": "has\x00nul",
            "checklist": [{"id": item, "done": "yes", "note": "y" * 501}],
        },
    )
    assert response.status_code == 422
    assert_contract(response, "updateManagerReport")
    locs = [e["loc"] for e in response.json()["errors"]]
    assert ["body", "painter_notes"] in locs
    assert ["body", "manager_notes"] in locs
    assert ["body", "checklist", 0, "done"] in locs
    assert ["body", "checklist", 0, "note"] in locs
    assert len(locs) == 4
    messages = {tuple(e["loc"]): e["message"] for e in response.json()["errors"]}
    assert "at most 5000 characters" in messages[("body", "painter_notes")]
    assert "at most 500 characters" in messages[("body", "checklist", 0, "note")]
    assert "items" not in messages[("body", "painter_notes")]


def test_checklist_over_the_maximum_is_one_clear_422(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    items = [{"id": str(uuid.uuid4()), "done": True} for _ in range(101)]
    response = patch(client, manager_headers, target.id, {"version": 1, "checklist": items})
    assert response.status_code == 422
    assert_contract(response, "updateManagerReport")
    errors = response.json()["errors"]
    assert len(errors) == 1 and errors[0]["loc"] == ["body", "checklist"]
    assert "at most 100 items" in errors[0]["message"]
    assert len(response.content) < 2000
    assert report_row(db_engine, target.id) == before


@pytest.mark.parametrize(
    ("body", "loc"),
    [
        ({"painter_notes": "x" * 5001}, ["body", "painter_notes"]),
        ({"manager_notes": "x" * 5001}, ["body", "manager_notes"]),
        ({"painter_notes": "\U0001f600" * 5001}, ["body", "painter_notes"]),
        ({"painter_notes": "a\x00b"}, ["body", "painter_notes"]),
        ({"manager_notes": "\x00"}, ["body", "manager_notes"]),
        ({"painter_notes": 5}, ["body", "painter_notes"]),
        ({"painter_notes": True}, ["body", "painter_notes"]),
        ({"painter_notes": ["a"]}, ["body", "painter_notes"]),
        ({"manager_notes": {"a": 1}}, ["body", "manager_notes"]),
        ({"checklist": None}, ["body", "checklist"]),
        ({"checklist": []}, ["body", "checklist"]),
        ({"checklist": "all"}, ["body", "checklist"]),
        ({"checklist": [None]}, ["body", "checklist", 0]),
        ({"checklist": ["id"]}, ["body", "checklist", 0]),
    ],
    ids=lambda v: json.dumps(v)[:40] if isinstance(v, dict) else None,
)
def test_bad_top_level_values(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    body: Any,
    loc: list[Any],
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = patch(client, manager_headers, target.id, {"version": 1, **body})
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == loc
    assert report_row(db_engine, target.id) == before


@pytest.mark.parametrize(
    "item",
    [
        {"done": True},  # no id
        {"id": "not-a-uuid", "done": True},
        {"id": 5, "done": True},
        {"id": None, "done": True},
    ],
)
def test_bad_checklist_ids(
    client: TestClient, manager_headers: dict[str, str], ds: Any, item: Any
) -> None:
    target = _target(ds)
    response = patch(client, manager_headers, target.id, {"version": 1, "checklist": [item]})
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"][:3] == ["body", "checklist", 0]


@pytest.mark.parametrize("done", ["yes", "true", 1, 0, None, [], {}])
def test_done_must_be_a_real_boolean(
    client: TestClient, manager_headers: dict[str, str], ds: Any, done: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "checklist": [{"id": item, "done": done}]},
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "checklist", 0, "done"]


@pytest.mark.parametrize("note", [5, True, ["x"], "a" * 501, "n\x00"])
def test_bad_checklist_notes(
    client: TestClient, manager_headers: dict[str, str], ds: Any, note: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "checklist": [{"id": item, "note": note}]},
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "checklist", 0, "note"]


def test_checklist_item_with_only_an_id_is_422(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    response = patch(
        client, manager_headers, target.id, {"version": 1, "checklist": [{"id": item}]}
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "checklist", 0]


@pytest.mark.parametrize("body", [{"version": 1}, {"version": 1, "checklist": None}])
def test_a_body_with_no_editable_field_is_422(
    client: TestClient, manager_headers: dict[str, str], ds: Any, body: Any
) -> None:
    target = awaiting_reports(ds)[0]
    response = patch(client, manager_headers, target.id, body)
    assert response.status_code == 422
    errors = response.json()["errors"]
    if body == {"version": 1}:
        assert errors == [{"loc": ["body"], "message": "Send at least one field to change."}]


@pytest.mark.parametrize(
    "body",
    [
        {"painter_notes": "x"},
        {"version": 0, "painter_notes": "x"},
        {"version": -1, "painter_notes": "x"},
        {"version": "1", "painter_notes": "x"},
        {"version": 1.5, "painter_notes": "x"},
        {"version": True, "painter_notes": "x"},
        {"version": None, "painter_notes": "x"},
    ],
)
def test_version_is_required_and_strict(
    client: TestClient, manager_headers: dict[str, str], ds: Any, body: Any
) -> None:
    target = awaiting_reports(ds)[0]
    response = patch(client, manager_headers, target.id, body)
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "version"]


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"null",
        b"[]",
        b'"x"',
        b"{",
        b'{"version": 1, "painter_notes": "\\ud800"}',  # lone surrogate: cannot be stored
        b'{"version": 1, "manager_notes": "\\udfff"}',
        b'{"version": 1, "painter_notes": "\\u0000"}',
        b'{"version": NaN, "painter_notes": "x"}',
        b"\xff\xfe\x00",
        b"[" * 10000,
        b'{"a":' * 5000,
    ],
)
def test_hostile_raw_bodies_are_422_never_500(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, raw: bytes
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = client.patch(
        f"{BASE}/{target.id}",
        content=raw,
        headers={**manager_headers, "Content-Type": "application/json"},
    )
    # Undecodable bytes or absurd nesting are FastAPI's own 400; the rest are 422. Never a 500.
    assert response.status_code in (400, 422), response.text[:200]
    assert response.json()["code"] == "validation_error"
    assert response.headers["content-type"].startswith("application/problem+json")
    assert report_row(db_engine, target.id) == before


def test_an_oversized_body_is_rejected_cleanly(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "painter_notes": "x" * 3_000_000},
    )
    assert response.status_code == 422
    assert report_row(db_engine, target.id) == before


def test_limits_count_code_points_and_the_limit_itself_is_allowed(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    emoji = "\U0001f600" * 5000  # 5000 code points, 20000 bytes
    response = patch(
        client,
        manager_headers,
        target.id,
        {
            "version": 1,
            "painter_notes": emoji,
            "manager_notes": "m" * 5000,
            "checklist": [{"id": item, "note": "é" * 500}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["painter_notes"] == emoji and len(body["manager_notes"]) == 5000
    assert body["checklist"][0]["note"] == "é" * 500


def test_text_is_stored_exactly_except_blank_becomes_null(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    raw = "  Line one\r\nLine two\ttabbed  \n\n<script>alert(1)</script>'; DROP TABLE users;--  "
    body = patch(
        client,
        manager_headers,
        target.id,
        {
            "version": 1,
            "painter_notes": raw,
            "manager_notes": "   ",
            "checklist": [{"id": item, "note": "  \n "}],
        },
    ).json()
    assert body["painter_notes"] == raw
    assert body["manager_notes"] is None
    assert body["checklist"][0]["note"] is None
    cleared = patch(client, manager_headers, target.id, {"version": 2, "painter_notes": ""}).json()
    assert cleared["painter_notes"] is None
    again = patch(client, manager_headers, target.id, {"version": 3, "painter_notes": None}).json()
    assert again["version"] == 3  # null over null is a no-op
    change = history(client, manager_headers, target.id)["items"][0]["changes"][0]
    assert (change["old_value"], change["new_value"]) == (raw, None)


def test_a_failed_validation_in_one_part_saves_nothing_from_the_other(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target, item = _item_id(client, manager_headers, ds)
    before = report_row(db_engine, target.id)
    response = patch(
        client,
        manager_headers,
        target.id,
        {"version": 1, "painter_notes": "valid", "checklist": [{"id": item, "done": "maybe"}]},
    )
    assert response.status_code == 422
    assert report_row(db_engine, target.id) == before
    assert event_count(db_engine) == 0


# ---- scenario 10: authorisation ----------------------------------------------------------------


def test_authorisation(
    client: TestClient,
    manager_headers: dict[str, str],
    painter_headers: dict[str, str],
    admin_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    url = f"{BASE}/{target.id}"
    body = {"version": 1, "painter_notes": "hacked"}
    assert client.patch(url, json=body).status_code == 401
    for headers in (painter_headers, admin_headers):
        response = client.patch(url, json=body, headers=headers)
        assert response.status_code == 403
        assert_contract(response, "updateManagerReport")
    assert report_row(db_engine, target.id) == before
    missing = patch(client, manager_headers, uuid.uuid4(), body)
    assert missing.status_code == 404 and missing.json()["code"] == "not_found"
    assert_contract(missing, "updateManagerReport")
    assert client.patch(f"{BASE}/abc", json=body, headers=manager_headers).status_code == 422
    assert event_count(db_engine) == 0


def test_a_body_cannot_name_an_actor_or_a_role(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    for extra in ({"actor": "x"}, {"user_id": str(uuid.uuid4())}, {"role": "admin"}):
        response = patch(
            client, manager_headers, target.id, {"version": 1, "manager_notes": "a", **extra}
        )
        assert response.status_code == 422


# ---- scenario 11/12: atomic, contract, reseed --------------------------------------------------


def test_reseed_restores_version_manager_notes_and_clears_events(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    from app.seed.loader import load
    from tests.conftest import ANCHOR

    target = awaiting_reports(ds)[0]
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "temporary"})
    assert event_count(db_engine) == 1
    from app.seed.dataset import build_dataset

    load(db_engine, build_dataset(ANCHOR))
    body = detail(client, manager_headers, target.id)
    assert body["version"] == 1 and body["manager_notes"] is None
    assert body["last_changed_at"] is None
    assert event_count(db_engine) == 0


def test_write_leaves_billing_and_other_reports_alone(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target, other = awaiting_reports(ds)[0], awaiting_reports(ds)[1]
    before_other = detail(client, manager_headers, other.id)
    before = detail(client, manager_headers, target.id)
    after = patch(client, manager_headers, target.id, {"version": 1, "painter_notes": "n"}).json()
    for key in ("billing_status", "invoice", "quote", "payments", "job", "customer", "photos"):
        assert after[key] == before[key], key
    assert detail(client, manager_headers, other.id) == before_other
