"""T-002g: marking a report reviewed (POST /manager/reports/{id}/review) and report versioning."""

import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from tests.conftest import FIXED_NOW
from tests.contract import assert_contract
from tests.expected import parse_ts
from tests.write_helpers import (
    BASE,
    MANAGER2_NAME,
    MANAGER_NAME,
    awaiting_reports,
    dashboard,
    detail,
    event_count,
    report_row,
    review,
    reviewed_reports,
)


def test_detail_exposes_version_and_review_state(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    awaiting = awaiting_reports(ds)[0]
    response = client.get(f"{BASE}/{awaiting.id}", headers=manager_headers)
    assert_contract(response, "getManagerReport")
    body = response.json()
    assert body["version"] == 1
    assert body["review_status"] == "awaiting_review"
    assert body["reviewed_by"] is None and body["reviewed_at"] is None
    assert body["last_changed_at"] is None and body["last_changed_by"] is None
    assert body["manager_notes"] is None
    done = detail(client, manager_headers, reviewed_reports(ds)[0].id)
    assert done["version"] == 1
    assert done["reviewed_by"]["name"] == MANAGER_NAME
    assert done["last_changed_by"] is None


def test_every_seeded_report_is_version_1_with_no_manager_notes(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    for report in ds.reports[:12]:
        body = detail(client, manager_headers, report.id)
        assert body["version"] == 1 and body["manager_notes"] is None


def test_manager_marks_a_report_reviewed(
    client: TestClient,
    manager2_headers: dict[str, str],
    ds: Any,
    reseed: None,
) -> None:
    target = awaiting_reports(ds)[0]
    assert dashboard(client, manager2_headers)["reports_awaiting_review"] == 10
    response = review(client, manager2_headers, target.id, 1)
    assert response.status_code == 200
    assert_contract(response, "reviewManagerReport")
    body = response.json()
    assert body["review_status"] == "reviewed"
    assert body["reviewed_by"]["name"] == MANAGER2_NAME
    assert parse_ts(body["reviewed_at"]) == FIXED_NOW
    assert body["version"] == 2
    assert body["last_changed_by"]["name"] == MANAGER2_NAME
    assert body["last_changed_at"] == body["reviewed_at"]
    assert detail(client, manager2_headers, target.id) == body
    dash = dashboard(client, manager2_headers)
    assert dash["reports_awaiting_review"] == 9
    assert target.id.hex not in {r["id"].replace("-", "") for r in dash["review_queue"]}


def test_a_review_changes_no_billing_figure(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    keys = ("invoiced_this_month_pence", "outstanding_pence", "overdue_invoice_count")
    invoices_before = client.get(
        "/api/v1/manager/invoices", params={"page_size": 100}, headers=manager_headers
    ).json()
    figures_before = {k: dashboard(client, manager_headers)[k] for k in keys}
    target = awaiting_reports(ds)[0]
    before = detail(client, manager_headers, target.id)
    assert review(client, manager_headers, target.id).status_code == 200
    after = detail(client, manager_headers, target.id)
    assert {k: dashboard(client, manager_headers)[k] for k in keys} == figures_before
    assert (
        client.get(
            "/api/v1/manager/invoices", params={"page_size": 100}, headers=manager_headers
        ).json()
        == invoices_before
    )
    for key in (
        "billing_status",
        "invoice",
        "quote",
        "payments",
        "job",
        "customer",
        "photos",
        "checklist",
        "painter_notes",
    ):
        assert after[key] == before[key], key


def test_an_already_reviewed_report_is_409_naming_the_reviewer(
    client: TestClient, manager2_headers: dict[str, str], db_engine: Engine, ds: Any, reseed: None
) -> None:
    target = reviewed_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = review(client, manager2_headers, target.id, 1)
    assert response.status_code == 409
    assert_contract(response, "reviewManagerReport")
    body = response.json()
    assert body["code"] == "already_reviewed"
    assert body["current_version"] == 1
    assert body["reviewed_by"]["name"] == MANAGER_NAME
    assert parse_ts(body["reviewed_at"]) == target.reviewed_at
    assert body["detail"].startswith(f"Already reviewed by {MANAGER_NAME} at ")
    assert body["detail"].endswith("Z.")
    assert report_row(db_engine, target.id) == before
    assert event_count(db_engine) == 0


def test_a_stale_version_is_409_version_conflict_and_writes_nothing(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    target = awaiting_reports(ds)[1]
    assert review(client, manager2_headers, target.id, 1).status_code == 200
    before = report_row(db_engine, target.id)
    events = event_count(db_engine)
    response = review(client, manager_headers, target.id, 1)
    assert response.status_code == 409
    assert_contract(response, "reviewManagerReport")
    body = response.json()
    # Stale wins over "already reviewed" (A3); the body still carries the review fields.
    assert body["code"] == "version_conflict"
    assert body["current_version"] == 2
    assert body["last_changed_by"]["name"] == MANAGER2_NAME
    assert body["review_status"] == "reviewed"
    assert body["reviewed_by"]["name"] == MANAGER2_NAME
    assert body["last_changed_at"] == body["reviewed_at"]
    assert "current" not in body
    assert report_row(db_engine, target.id) == before
    assert event_count(db_engine) == events


def test_a_current_version_on_a_reviewed_report_after_a_review_is_already_reviewed(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    ds: Any,
    reseed: None,
) -> None:
    target = awaiting_reports(ds)[2]
    assert review(client, manager2_headers, target.id, 1).status_code == 200
    response = review(client, manager_headers, target.id, 2)
    assert response.status_code == 409 and response.json()["code"] == "already_reviewed"
    assert response.json()["reviewed_by"]["name"] == MANAGER2_NAME


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"version": 0},
        {"version": -1},
        {"version": 1.5},
        {"version": 1.0},
        {"version": "1"},
        {"version": True},
        {"version": False},
        {"version": None},
        {"version": [1]},
        {"version": {"v": 1}},
        {"version": 1, "extra": 1},
        {"version": 1, "reviewed_by": "someone"},
        {"version": 1, "review_status": "reviewed"},
        [],
        [{"version": 1}],
        None,
        "1",
        1,
    ],
    ids=lambda b: json.dumps(b),
)
def test_review_body_variants_are_422(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    body: Any,
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = client.post(f"{BASE}/{target.id}/review", json=body, headers=manager_headers)
    assert response.status_code == 422
    assert_contract(response, "reviewManagerReport")
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"]
    assert report_row(db_engine, target.id) == before


def test_review_422_names_the_version_field(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    for body in ({}, {"version": 0}, {"version": "1"}, {"version": 1.5}, {"version": True}):
        response = client.post(f"{BASE}/{target.id}/review", json=body, headers=manager_headers)
        assert response.json()["errors"][0]["loc"] == ["body", "version"], body


@pytest.mark.parametrize(
    "raw",
    [b"", b"{", b"not json", b'{"version": NaN}', b'{"version": 1e999}', b"\xff\xfe", b"[" * 5000],
)
def test_review_malformed_bodies_are_422_not_500(
    client: TestClient, manager_headers: dict[str, str], ds: Any, raw: bytes
) -> None:
    target = awaiting_reports(ds)[0]
    response = client.post(
        f"{BASE}/{target.id}/review",
        content=raw,
        headers={**manager_headers, "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")


def test_review_with_a_huge_version_is_a_clean_409(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    response = client.post(
        f"{BASE}/{target.id}/review",
        content=b'{"version": ' + b"9" * 400 + b"}",
        headers={**manager_headers, "Content-Type": "application/json"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "version_conflict"


def test_review_with_an_oversized_body_is_422(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    response = client.post(
        f"{BASE}/{target.id}/review",
        json={"version": 1, "pad": "x" * 2_000_000},
        headers=manager_headers,
    )
    assert response.status_code == 422


def test_authorisation_and_missing_reports(
    client: TestClient,
    painter_headers: dict[str, str],
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
) -> None:
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    url = f"{BASE}/{target.id}/review"
    body = {"version": 1}
    assert client.post(url, json=body).status_code == 401
    for headers in (painter_headers, admin_headers):
        response = client.post(url, json=body, headers=headers)
        assert response.status_code == 403
        assert_contract(response, "reviewManagerReport")
    assert report_row(db_engine, target.id) == before
    missing = review(client, manager_headers, uuid.uuid4(), 1)
    assert missing.status_code == 404 and missing.json()["code"] == "not_found"
    assert_contract(missing, "reviewManagerReport")
    bad = client.post(f"{BASE}/abc/review", json=body, headers=manager_headers)
    assert bad.status_code == 422
    assert client.post(f"{BASE}/{uuid.uuid4()}/review", json=body).status_code == 401


def test_deactivated_manager_cannot_review(
    client: TestClient, temp_user: Any, ds: Any, db_engine: Engine
) -> None:
    from tests.conftest import bearer, make_token

    user = temp_user(active=False)
    target = awaiting_reports(ds)[0]
    before = report_row(db_engine, target.id)
    response = review(client, bearer(make_token(user.id)), target.id)
    assert response.status_code == 401
    assert report_row(db_engine, target.id) == before


def test_only_the_post_method_works_on_the_review_path(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    url = f"{BASE}/{awaiting_reports(ds)[0].id}/review"
    for method in ("GET", "PUT", "PATCH", "DELETE"):
        assert client.request(method, url, headers=manager_headers).status_code == 405
