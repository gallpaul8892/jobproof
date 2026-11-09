"""T-002k: the dashboard review queue and the `sort=submitted_asc` option."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.contract import assert_contract
from tests.test_performance_logging import count_queries
from tests.write_helpers import awaiting_reports, dashboard

REPORTS = "/api/v1/manager/reports"


def _ids(reports: list[Any]) -> list[str]:
    return [str(r.id) for r in reports]


def test_queue_is_the_first_five_awaiting_reports_oldest_first(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    response = client.get("/api/v1/manager/dashboard", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "getManagerDashboard")
    body = response.json()
    expected = awaiting_reports(ds)
    assert len(expected) == 10
    assert [r["id"] for r in body["review_queue"]] == _ids(expected[:5])
    assert all(r["review_status"] == "awaiting_review" for r in body["review_queue"])
    assert {"customer", "site_address", "painter", "submitted_at"} <= set(body["review_queue"][0])
    assert body["reports_awaiting_review"] == 10
    assert [r["id"] for r in body["recent_reports"]] != [r["id"] for r in body["review_queue"]]


def test_sort_submitted_asc_lists_the_awaiting_reports_in_queue_order(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    response = client.get(
        REPORTS,
        params={"review_status": "awaiting_review", "sort": "submitted_asc"},
        headers=manager_headers,
    )
    assert response.status_code == 200
    assert_contract(response, "listManagerReports")
    body = response.json()
    assert body["total"] == 10
    assert [r["id"] for r in body["items"]] == _ids(awaiting_reports(ds))


def test_sort_submitted_asc_orders_every_report_and_pages_consistently(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    jobs = {j.id: j for j in ds.jobs}
    expected = _ids(sorted(ds.reports, key=lambda r: (r.submitted_at, jobs[r.job_id].reference)))
    seen: list[str] = []
    for page in (1, 2, 3):
        body = client.get(
            REPORTS,
            params={"sort": "submitted_asc", "page": page, "page_size": 25},
            headers=manager_headers,
        ).json()
        seen += [r["id"] for r in body["items"]]
    assert seen == expected


def test_default_sort_and_no_sort_are_the_phase_1_order(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    plain = client.get(REPORTS, headers=manager_headers).json()
    default = client.get(REPORTS, params={"sort": "default"}, headers=manager_headers).json()
    assert plain == default
    # Phase 1 order: completed_on descending, so it differs from the oldest-first order.
    asc = client.get(REPORTS, params={"sort": "submitted_asc"}, headers=manager_headers).json()
    assert [r["id"] for r in plain["items"]] != [r["id"] for r in asc["items"]]


@pytest.mark.parametrize(
    "value", ["newest", "SUBMITTED_ASC", "submitted_desc", "", " submitted_asc", "1", "default;"]
)
def test_unknown_sort_values_are_422_on_the_sort_query_parameter(
    client: TestClient, manager_headers: dict[str, str], value: str
) -> None:
    response = client.get(REPORTS, params={"sort": value}, headers=manager_headers)
    assert response.status_code == 422
    assert_contract(response, "listManagerReports")
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["loc"] == ["query", "sort"]


def test_ties_on_submitted_at_are_broken_by_job_reference(
    client: TestClient, manager_headers: dict[str, str], ds: Any, db_engine: Engine, reseed: None
) -> None:
    first, second, third = awaiting_reports(ds)[:3]
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE job_reports SET submitted_at = (SELECT submitted_at FROM job_reports "
                "WHERE id = :a) WHERE id IN (:b, :c)"
            ),
            {"a": first.id, "b": second.id, "c": third.id},
        )
    queue = dashboard(client, manager_headers)["review_queue"]
    tied = [r for r in queue if r["id"] in {str(first.id), str(second.id), str(third.id)}]
    assert len(tied) == 3
    assert [r["job_reference"] for r in tied] == sorted(r["job_reference"] for r in tied)
    listed = client.get(
        REPORTS,
        params={"review_status": "awaiting_review", "sort": "submitted_asc"},
        headers=manager_headers,
    ).json()["items"]
    assert [r["id"] for r in listed[:5]] == [r["id"] for r in queue]


def _mark_reviewed(engine: Engine, ids: list[Any]) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE job_reports SET review_status = 'reviewed', reviewed_at = now(), "
                "reviewed_by_id = (SELECT id FROM users WHERE role = 'manager' LIMIT 1) "
                "WHERE id = ANY(:ids)"
            ),
            {"ids": ids},
        )


def test_reviewing_the_oldest_removes_it_and_the_sixth_moves_up(
    client: TestClient, manager_headers: dict[str, str], ds: Any, db_engine: Engine, reseed: None
) -> None:
    expected = awaiting_reports(ds)
    _mark_reviewed(db_engine, [expected[0].id])
    body = dashboard(client, manager_headers)
    assert [r["id"] for r in body["review_queue"]] == _ids(expected[1:6])
    assert body["reports_awaiting_review"] == 9


def test_fewer_than_five_and_none(
    client: TestClient, manager_headers: dict[str, str], ds: Any, db_engine: Engine, reseed: None
) -> None:
    expected = awaiting_reports(ds)
    _mark_reviewed(db_engine, [r.id for r in expected[3:]])
    body = dashboard(client, manager_headers)
    assert [r["id"] for r in body["review_queue"]] == _ids(expected[:3])
    assert body["reports_awaiting_review"] == 3
    _mark_reviewed(db_engine, [r.id for r in expected[:3]])
    body = dashboard(client, manager_headers)
    assert body["review_queue"] == [] and body["reports_awaiting_review"] == 0
    response = client.get("/api/v1/manager/dashboard", headers=manager_headers)
    assert_contract(response, "getManagerDashboard")


def test_dashboard_stays_within_the_query_bound(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    with count_queries(client) as statements:
        assert client.get("/api/v1/manager/dashboard", headers=manager_headers).status_code == 200
    assert len(statements) <= 6


def test_queue_and_sort_are_manager_only(
    client: TestClient, painter_headers: dict[str, str], admin_headers: dict[str, str]
) -> None:
    for headers in (painter_headers, admin_headers):
        assert client.get("/api/v1/manager/dashboard", headers=headers).status_code == 403
        assert (
            client.get(REPORTS, params={"sort": "submitted_asc"}, headers=headers).status_code
            == 403
        )
    assert client.get("/api/v1/manager/dashboard").status_code == 401
