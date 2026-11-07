"""T-001c scenario 4 (dashboard) and the painters list."""

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services.dashboard import get_dashboard, month_bounds
from tests.conftest import ANCHOR, FIXED_NOW
from tests.contract import assert_contract
from tests.expected import expected_dashboard, parse_ts


def test_dashboard_figures_match_the_seed(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    response = client.get("/api/v1/manager/dashboard", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "getManagerDashboard")
    body = response.json()
    expected = expected_dashboard(ds, ANCHOR)
    assert body["reports_awaiting_review"] == expected.awaiting == 9
    assert body["jobs_completed_this_month"] == expected.completed_this_month == 8
    assert body["invoiced_this_month_pence"] == expected.invoiced_this_month > 0
    assert body["outstanding_pence"] == expected.outstanding > 0
    assert body["overdue_invoice_count"] == expected.overdue == 6
    assert body["period_start"] == "2026-10-01"
    assert body["period_end"] == "2026-10-31"
    assert body["currency"] == "GBP"
    assert parse_ts(body["as_of"]) == FIXED_NOW


def test_recent_reports_are_the_five_latest_submitted(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    body = client.get("/api/v1/manager/dashboard", headers=manager_headers).json()
    latest = sorted(ds.reports, key=lambda r: r.submitted_at, reverse=True)[:5]
    assert [r["id"] for r in body["recent_reports"]] == [str(r.id) for r in latest]
    jobs = {j.id: j for j in ds.jobs}
    assert [r["job_reference"] for r in body["recent_reports"]] == [
        jobs[r.job_id].reference for r in latest
    ]
    submitted = [parse_ts(r["submitted_at"]) for r in body["recent_reports"]]
    assert submitted == sorted(submitted, reverse=True)
    first = body["recent_reports"][0]
    assert {"customer", "site_address", "painter", "photo_count", "billing_status"} <= set(first)


@pytest.mark.parametrize(
    "today",
    [
        ANCHOR,
        dt.date(2026, 10, 31),  # last day of the month
        dt.date(2026, 11, 1),  # month boundary: the October figures roll over
        dt.date(2026, 11, 20),  # most invoices now overdue
        dt.date(2026, 9, 1),  # a month with older data
    ],
)
def test_dashboard_service_agrees_with_the_dataset_on_any_day(
    db_engine: Any, ds: Any, today: dt.date
) -> None:
    expected = expected_dashboard(ds, today)
    with Session(db_engine) as session:
        got = get_dashboard(session, now=FIXED_NOW, today=today)
    assert got.period_start == expected.period_start
    assert got.period_end == expected.period_end
    assert got.reports_awaiting_review == expected.awaiting
    assert got.jobs_completed_this_month == expected.completed_this_month
    assert got.invoiced_this_month_pence == expected.invoiced_this_month
    assert got.outstanding_pence == expected.outstanding
    assert got.overdue_invoice_count == expected.overdue


@pytest.mark.parametrize(
    ("today", "start", "end"),
    [
        (dt.date(2026, 10, 15), dt.date(2026, 10, 1), dt.date(2026, 10, 31)),
        (dt.date(2026, 11, 1), dt.date(2026, 11, 1), dt.date(2026, 11, 30)),
        (dt.date(2028, 2, 29), dt.date(2028, 2, 1), dt.date(2028, 2, 29)),
        (dt.date(2026, 12, 31), dt.date(2026, 12, 1), dt.date(2026, 12, 31)),
    ],
)
def test_month_bounds(today: dt.date, start: dt.date, end: dt.date) -> None:
    assert month_bounds(today) == (start, end)


def test_painters_are_ordered_by_name(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    response = client.get("/api/v1/manager/painters", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "listManagerPainters")
    expected = sorted(
        ((u.full_name, str(u.id)) for u in ds.users if u.role.value == "painter"),
        key=lambda t: t[0],
    )
    assert [(p["name"], p["id"]) for p in response.json()] == expected
    assert len(expected) == 6
    assert "Sarah Whitfield" not in response.text
