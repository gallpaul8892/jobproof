"""Helpers shared by the Package 2 write tests (review, edit, audit)."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

MANAGER_NAME = "Sarah Whitfield"
MANAGER2_NAME = "Priya Nair"
ADMIN_NAME = "Tom Ashworth"
BASE = "/api/v1/manager/reports"


def awaiting_reports(ds: Any) -> list[Any]:
    """Awaiting-review reports in review-queue order: submitted_at, then job reference."""
    jobs = {j.id: j for j in ds.jobs}
    rows = [r for r in ds.reports if r.review_status.value == "awaiting_review"]
    return sorted(rows, key=lambda r: (r.submitted_at, jobs[r.job_id].reference))


def reviewed_reports(ds: Any) -> list[Any]:
    return [r for r in ds.reports if r.review_status.value == "reviewed"]


def detail(client: TestClient, headers: dict[str, str], report_id: Any) -> Any:
    response = client.get(f"{BASE}/{report_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def review(client: TestClient, headers: dict[str, str], report_id: Any, version: Any = 1) -> Any:
    return client.post(f"{BASE}/{report_id}/review", json={"version": version}, headers=headers)


def patch(client: TestClient, headers: dict[str, str], report_id: Any, body: Any) -> Any:
    return client.patch(f"{BASE}/{report_id}", json=body, headers=headers)


def history(client: TestClient, headers: dict[str, str], report_id: Any) -> Any:
    response = client.get(f"{BASE}/{report_id}/history", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def event_count(engine: Engine, report_id: Any = None) -> int:
    with engine.connect() as connection:
        if report_id is None:
            return int(connection.execute(text("SELECT count(*) FROM audit_events")).scalar_one())
        return int(
            connection.execute(
                text("SELECT count(*) FROM audit_events WHERE report_id = :id"), {"id": report_id}
            ).scalar_one()
        )


def report_row(engine: Engine, report_id: Any) -> tuple[Any, ...]:
    """Every column of the report and its checklist, to prove 'nothing changed'."""
    with engine.connect() as connection:
        report = connection.execute(
            text("SELECT * FROM job_reports WHERE id = :id"), {"id": report_id}
        ).one()
        items = connection.execute(
            text("SELECT * FROM report_checklist_items WHERE report_id = :id ORDER BY position"),
            {"id": report_id},
        ).all()
    return (tuple(report), [tuple(i) for i in items])  # type: ignore[return-value]


def dashboard(client: TestClient, headers: dict[str, str]) -> Any:
    return client.get("/api/v1/manager/dashboard", headers=headers).json()


def checklist_report(ds: Any, *, reviewed: bool = False) -> Any:
    """A report with at least three checklist items, not done first, awaiting or reviewed."""
    counts: dict[Any, int] = {}
    for item in ds.checklist_items:
        counts[item.report_id] = counts.get(item.report_id, 0) + 1
    pool = reviewed_reports(ds) if reviewed else awaiting_reports(ds)
    return next(r for r in pool if counts.get(r.id, 0) >= 3)
