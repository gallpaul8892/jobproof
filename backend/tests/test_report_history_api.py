"""T-002f: the report history endpoint and what gets recorded."""

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
    event_count,
    history,
    patch,
    review,
)


def test_an_untouched_report_has_an_empty_history(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    response = client.get(f"{BASE}/{target.id}/history", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "listManagerReportHistory")
    assert response.json() == {"items": [], "total": 0}


def test_a_review_is_recorded_with_actor_time_and_request_id(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    target = awaiting_reports(ds)[0]
    done = review(client, manager_headers, target.id)
    assert done.status_code == 200
    response = client.get(f"{BASE}/{target.id}/history", headers=manager_headers)
    assert_contract(response, "listManagerReportHistory")
    body = response.json()
    assert body["total"] == 1
    event = body["items"][0]
    assert event["action"] == "report.reviewed"
    assert event["actor"]["name"] == MANAGER_NAME
    assert event["occurred_at"] == done.json()["reviewed_at"]
    assert event["changes"] == [
        {
            "field": "review_status",
            "item_id": None,
            "item_label": None,
            "old_value": "awaiting_review",
            "new_value": "reviewed",
        }
    ]
    assert "request_id" not in event
    with db_engine.connect() as connection:
        stored = connection.execute(text("SELECT request_id FROM audit_events")).scalar_one()
    assert stored == done.headers["x-request-id"]


def test_history_is_newest_first_and_names_are_snapshots(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    target = awaiting_reports(ds)[0]
    patch(client, manager2_headers, target.id, {"version": 1, "painter_notes": "first"})
    patch(client, manager2_headers, target.id, {"version": 2, "painter_notes": "second"})
    review(client, manager_headers, target.id, 3)
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET full_name = 'Priya Nair-Singh' WHERE full_name = :n"),
            {"n": MANAGER2_NAME},
        )
    items = history(client, manager_headers, target.id)["items"]
    assert [e["action"] for e in items] == ["report.reviewed", "report.edited", "report.edited"]
    times = [parse_ts(e["occurred_at"]) for e in items]
    assert times == sorted(times, reverse=True)
    assert [e["actor"]["name"] for e in items] == [MANAGER_NAME, MANAGER2_NAME, MANAGER2_NAME]
    assert items[1]["changes"][0]["old_value"] == "first"


def test_only_the_latest_100_are_returned_with_the_true_total(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, reseed: None
) -> None:
    target = awaiting_reports(ds)[0]
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO audit_events (occurred_at, actor_id, actor_name, action, "
                "entity_type, report_id, changes) "
                "SELECT now(), u.id, u.full_name, 'report.edited', 'report', :r, "
                "jsonb_build_array(jsonb_build_object('field', 'painter_notes', 'item_id', null, "
                "'item_label', null, 'old_value', 'v' || g, 'new_value', 'v' || (g + 1))) "
                "FROM generate_series(1, 105) g, "
                "(SELECT id, full_name FROM users WHERE role = 'manager' LIMIT 1) u"
            ),
            {"r": target.id},
        )
    response = client.get(f"{BASE}/{target.id}/history", headers=manager_headers)
    assert_contract(response, "listManagerReportHistory")
    body = response.json()
    assert body["total"] == 105 and len(body["items"]) == 100
    assert body["items"][0]["changes"][0]["old_value"] == "v105"
    assert body["items"][-1]["changes"][0]["old_value"] == "v6"


def test_history_is_per_report(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    a, b = awaiting_reports(ds)[:2]
    patch(client, manager_headers, a.id, {"version": 1, "manager_notes": "a"})
    assert history(client, manager_headers, b.id)["total"] == 0
    assert history(client, manager_headers, a.id)["total"] == 1


def test_failed_actions_leave_no_trace(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    target = awaiting_reports(ds)[0]
    review(client, manager2_headers, target.id, 1)
    base = event_count(db_engine)
    assert review(client, manager_headers, target.id, 1).status_code == 409  # stale
    assert review(client, manager_headers, target.id, 2).status_code == 409  # already reviewed
    assert review(client, manager_headers, target.id, "x").status_code == 422
    assert (
        patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "z"}).status_code
        == 409
    )
    assert patch(client, manager_headers, target.id, {"version": 2}).status_code == 422
    assert (
        patch(
            client, manager_headers, target.id, {"version": 2, "manager_notes": "\x00"}
        ).status_code
        == 422
    )
    assert event_count(db_engine) == base


def test_history_authorisation_and_missing_reports(
    client: TestClient,
    manager_headers: dict[str, str],
    painter_headers: dict[str, str],
    admin_headers: dict[str, str],
    ds: Any,
) -> None:
    url = f"{BASE}/{awaiting_reports(ds)[0].id}/history"
    assert client.get(url).status_code == 401
    for headers in (painter_headers, admin_headers):
        response = client.get(url, headers=headers)
        assert response.status_code == 403
        assert_contract(response, "listManagerReportHistory")
    missing = client.get(f"{BASE}/{uuid.uuid4()}/history", headers=manager_headers)
    assert missing.status_code == 404 and missing.json()["code"] == "not_found"
    assert_contract(missing, "listManagerReportHistory")
    bad = client.get(f"{BASE}/abc/history", headers=manager_headers)
    assert bad.status_code == 422
    assert_contract(bad, "listManagerReportHistory")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_history_cannot_be_written_through_the_api(
    client: TestClient, manager_headers: dict[str, str], ds: Any, method: str
) -> None:
    url = f"{BASE}/{awaiting_reports(ds)[0].id}/history"
    assert client.request(method, url, headers=manager_headers, json={}).status_code == 405


def test_no_write_route_exists_on_any_history_path() -> None:
    from app.main import create_app

    for path, item in create_app().openapi()["paths"].items():
        if "history" in path:
            assert set(item) == {"get"}, path
