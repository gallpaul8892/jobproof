"""T-003c: a draft report never appears on any manager operation (design section 6, R6).

Dan's seeded draft (JP-1064, with two photos) is probed through every manager operation of the
contract. The operation table is checked against the contract, so a new manager endpoint fails
this file until it is added here.
"""

import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import get_settings
from app.models.enums import ReviewStatus
from app.photos.signing import sign
from app.seed.dataset import Dataset
from tests.conftest import FIXED_NOW
from tests.contract import assert_contract, contract_operations

DRAFT_REF = "JP-1064"
MANAGER = "/api/v1/manager"

# Every manager operation (and the photo operation, which serves manager pages), by operationId.
COVERED = {
    "getManagerDashboard",
    "listManagerPainters",
    "listManagerReports",
    "getManagerReport",
    "updateManagerReport",
    "reviewManagerReport",
    "listManagerReportHistory",
    "getManagerCustomer",
    "updateManagerCustomer",
    "listManagerCustomerHistory",
    "listManagerInvoices",
    "getPhotoImage",
}


@pytest.fixture(scope="module")
def draft(ds: Dataset) -> Any:
    report = ds.draft_reports[0]
    job = next(j for j in ds.jobs if j.id == report.job_id)
    assert job.reference == DRAFT_REF
    return report, job


def _all_reports(client: TestClient, headers: dict[str, str], query: str = "") -> list[Any]:
    items: list[Any] = []
    page = 1
    while True:
        response = client.get(
            f"{MANAGER}/reports?page={page}&page_size=100{query}", headers=headers
        )
        assert response.status_code == 200, response.text
        assert_contract(response, "listManagerReports")
        body = response.json()
        items += body["items"]
        if len(items) >= body["total"]:
            assert len(items) == body["total"]
            return items
        page += 1


def test_the_table_covers_every_manager_operation_in_the_contract() -> None:
    manager_paths = ("/api/v1/manager", "/api/v1/photos")
    in_contract = {
        operation_id
        for (_, path), operation_id in contract_operations().items()
        if path.startswith(manager_paths)
    }
    assert in_contract == COVERED


def test_the_draft_exists_in_the_database(db_engine: Any, draft: Any) -> None:
    report, _ = draft
    with db_engine.connect() as connection:
        state = connection.execute(
            text("SELECT state::text FROM job_reports WHERE id = :i"), {"i": report.id}
        ).scalar_one()
        photos = connection.execute(
            text("SELECT count(*) FROM report_photos WHERE report_id = :i"), {"i": report.id}
        ).scalar_one()
    assert state == "draft" and photos == 2


def test_report_lists_never_include_the_draft(
    client: TestClient, manager_headers: dict[str, str], ds: Dataset, draft: Any
) -> None:
    report, job = draft
    queries = [
        "",
        "&sort=submitted_asc",
        "&review_status=awaiting_review",
        "&review_status=reviewed",
        f"&q={DRAFT_REF}",
        "&q=Trenchard",
        f"&customer_id={job.customer_id}",
        f"&painter_id={job.painter_id}",
        f"&date_from={job.scheduled_start}",
        "&billing_status=not_invoiced",
    ]
    for query in queries:
        items = _all_reports(client, manager_headers, query)
        assert str(report.id) not in {i["id"] for i in items}, query
        assert DRAFT_REF not in {i["job_reference"] for i in items}, query
    everything = _all_reports(client, manager_headers)
    assert len(everything) == len(ds.reports)  # submitted reports only
    assert not _all_reports(client, manager_headers, f"&q={DRAFT_REF}")


def test_filters_count_only_submitted_reports(
    client: TestClient, manager_headers: dict[str, str], ds: Dataset, draft: Any
) -> None:
    _, job = draft
    jobs = {j.id: j for j in ds.jobs}
    dans = [r for r in ds.reports if r.painter_id == job.painter_id]
    assert len(_all_reports(client, manager_headers, f"&painter_id={job.painter_id}")) == len(dans)
    olivias = [r for r in ds.reports if jobs[r.job_id].customer_id == job.customer_id]
    found = _all_reports(client, manager_headers, f"&customer_id={job.customer_id}")
    assert len(found) == len(olivias)


def test_the_dashboard_ignores_the_draft(
    client: TestClient, manager_headers: dict[str, str], ds: Dataset, draft: Any
) -> None:
    report, _ = draft
    response = client.get(f"{MANAGER}/dashboard", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "getManagerDashboard")
    body = response.json()
    awaiting = sum(r.review_status is ReviewStatus.awaiting_review for r in ds.reports)
    assert body["reports_awaiting_review"] == awaiting
    text_form = json.dumps(body)
    assert str(report.id) not in text_form and DRAFT_REF not in text_form


def test_a_draft_id_is_404_on_get_patch_review_and_history(
    client: TestClient, manager_headers: dict[str, str], draft: Any
) -> None:
    report, _ = draft
    base = f"{MANAGER}/reports/{report.id}"
    unknown = f"{MANAGER}/reports/{uuid.uuid4()}"
    cases = [
        ("get", base, None, "getManagerReport", unknown),
        ("patch", base, {"version": 1, "painter_notes": "x"}, "updateManagerReport", unknown),
        ("post", f"{base}/review", {"version": 1}, "reviewManagerReport", f"{unknown}/review"),
        ("get", f"{base}/history", None, "listManagerReportHistory", f"{unknown}/history"),
    ]
    for method, url, body, operation, unknown_url in cases:
        response = client.request(method, url, headers=manager_headers, json=body)
        assert response.status_code == 404, (operation, response.text)
        assert response.json()["code"] == "not_found"
        assert_contract(response, operation)
        same = client.request(method, unknown_url, headers=manager_headers, json=body)
        assert same.json()["detail"] == response.json()["detail"], operation


def test_a_refused_edit_or_review_of_a_draft_changes_nothing(
    client: TestClient, manager_headers: dict[str, str], db_engine: Any, draft: Any
) -> None:
    report, _ = draft
    client.patch(
        f"{MANAGER}/reports/{report.id}",
        headers=manager_headers,
        json={"version": 1, "painter_notes": "tampered"},
    )
    client.post(
        f"{MANAGER}/reports/{report.id}/review", headers=manager_headers, json={"version": 1}
    )
    with db_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT painter_notes, version, review_status, reviewed_at, "
                "(SELECT count(*) FROM audit_events WHERE report_id = :i) "
                "FROM job_reports WHERE id = :i"
            ),
            {"i": report.id},
        ).one()
    assert row[0] != "tampered" and row[1] == 1 and row[2] is None and row[3] is None
    assert row[4] == 0


@pytest.fixture
def draft_job_invoice(db_engine: Any, draft: Any) -> Iterator[str]:
    """A draft invoice on the draft's job, to prove the invoice list does not link the draft."""
    _, job = draft
    number = f"INV-T{uuid.uuid4().hex[:6]}"
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO invoices (job_id, customer_id, number, state, subtotal_pence, "
                "vat_pence, deposit_applied_pence, total_pence) "
                "VALUES (:j, :c, :n, 'draft', 10000, 2000, 0, 12000)"
            ),
            {"j": job.id, "c": job.customer_id, "n": number},
        )
    yield number
    with db_engine.begin() as connection:
        connection.execute(text("DELETE FROM invoices WHERE number = :n"), {"n": number})


def test_invoices_do_not_link_a_draft_report(
    client: TestClient, manager_headers: dict[str, str], draft: Any, draft_job_invoice: str
) -> None:
    report, _ = draft
    response = client.get(f"{MANAGER}/invoices?page_size=100", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "listManagerInvoices")
    rows = response.json()["items"]
    mine = [r for r in rows if r["number"] == draft_job_invoice]
    assert len(mine) == 1 and mine[0]["job_reference"] == DRAFT_REF
    assert mine[0]["report_id"] is None
    assert str(report.id) not in json.dumps(rows)


def test_customer_counts_ignore_drafts_and_histories_hold_no_draft_events(
    client: TestClient, manager_headers: dict[str, str], ds: Dataset, draft: Any
) -> None:
    report, job = draft
    jobs = {j.id: j for j in ds.jobs}
    theirs = [r for r in ds.reports if jobs[r.job_id].customer_id == job.customer_id]
    response = client.get(f"{MANAGER}/customers/{job.customer_id}", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "getManagerCustomer")
    impact = response.json()["impact"]
    assert impact["report_count"] == len(theirs)
    assert impact["reviewed_report_count"] == sum(
        r.review_status is ReviewStatus.reviewed for r in theirs
    )
    assert impact["job_count"] == sum(j.customer_id == job.customer_id for j in ds.jobs)
    history = client.get(f"{MANAGER}/customers/{job.customer_id}/history", headers=manager_headers)
    assert history.status_code == 200
    assert_contract(history, "listManagerCustomerHistory")
    assert str(report.id) not in history.text


def test_painters_list_has_no_report_data(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    response = client.get(f"{MANAGER}/painters", headers=manager_headers)
    assert response.status_code == 200
    assert set(response.json()[0]) == {"id", "name"}


def test_draft_photos_are_not_served(client: TestClient, draft: Any, ds: Dataset) -> None:
    secret = get_settings().photo_url_secret
    exp = int(FIXED_NOW.timestamp()) + 600

    def fetch(photo_id: uuid.UUID) -> Any:
        sig = sign(secret, photo_id, "full", exp)
        return client.get(f"/api/v1/photos/{photo_id}/image?variant=full&exp={exp}&sig={sig}")

    submitted = next(p for p in ds.photos if p.report_id == ds.reports[0].id)
    assert fetch(submitted.id).status_code == 200  # control: a validly signed link works
    for photo in ds.draft_photos:
        response = fetch(photo.id)
        assert response.status_code == 404
        assert_contract(response, "getPhotoImage")
