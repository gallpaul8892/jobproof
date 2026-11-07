"""T-001c scenario 8: the billing list and its derived-status filter."""

from collections import Counter
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services.billing import InvoiceStatus
from tests.conftest import ANCHOR
from tests.contract import assert_contract
from tests.expected import expected_invoices, invoice_statuses_at

URL = "/api/v1/manager/invoices"
SEED_DISTRIBUTION = {"draft": 6, "sent": 7, "part_paid": 2, "overdue": 6, "paid": 30, "void": 1}


def get(client: TestClient, headers: dict[str, str], **params: Any) -> Any:
    response = client.get(URL, headers=headers, params=params)
    assert_contract(response, "listManagerInvoices")
    return response


def test_unfiltered_total_is_the_52_seeded_invoices(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    body = get(client, manager_headers).json()
    assert body["total"] == 52 == len(ds.invoices)
    assert (body["page"], body["page_size"], len(body["items"])) == (1, 20, 20)


@pytest.mark.parametrize("status", sorted(SEED_DISTRIBUTION))
def test_each_status_total_matches_the_seed_distribution(
    client: TestClient, manager_headers: dict[str, str], ds: Any, status: str
) -> None:
    statuses = invoice_statuses_at(ds, ANCHOR)
    want = [i for i in expected_invoices(ds, ANCHOR) if statuses[i.id].value == status]
    response = get(client, manager_headers, status=status, page_size=100)
    body = response.json()
    assert body["total"] == SEED_DISTRIBUTION[status] == len(want)
    assert [i["id"] for i in body["items"]] == [str(i.id) for i in want]
    assert {i["status"] for i in body["items"]} == {status}


def test_rows_have_every_column_and_the_sort_is_drafts_first(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    body = get(client, manager_headers, page_size=100).json()
    want = expected_invoices(ds, ANCHOR)
    assert [i["id"] for i in body["items"]] == [str(i.id) for i in want]

    statuses = invoice_statuses_at(ds, ANCHOR)
    jobs = {j.id: j for j in ds.jobs}
    customers = {c.id: c for c in ds.customers}
    reports = {r.job_id: r for r in ds.reports}
    paid: Counter[Any] = Counter()
    for payment in ds.payments:
        if payment.invoice_id:
            paid[payment.invoice_id] += payment.amount_pence
    for row, invoice in zip(body["items"], want, strict=True):
        assert row["number"] == invoice.number
        assert row["status"] == statuses[invoice.id].value
        assert row["customer"] == {
            "id": str(invoice.customer_id),
            "name": customers[invoice.customer_id].name,
        }
        assert row["job_id"] == str(invoice.job_id)
        assert row["job_reference"] == jobs[invoice.job_id].reference
        assert row["report_id"] == str(reports[invoice.job_id].id)
        assert row["total_pence"] == invoice.total_pence
        assert row["paid_pence"] == paid[invoice.id]
        assert row["balance_pence"] == max(invoice.total_pence - paid[invoice.id], 0)
        assert row["currency"] == "GBP"
        assert row["issue_date"] == (invoice.issue_date.isoformat() if invoice.issue_date else None)
        assert row["due_date"] == (invoice.due_date.isoformat() if invoice.due_date else None)

    drafts = [i for i in body["items"] if i["status"] == "draft"]
    assert len(drafts) == 6
    assert [i["status"] for i in body["items"][:6]] == ["draft"] * 6
    assert all(i["issue_date"] is None and i["due_date"] is None for i in drafts)
    issued = [i for i in body["items"] if i["issue_date"]]
    keys = [(i["issue_date"], i["number"]) for i in issued]
    assert keys == sorted(keys, reverse=True)


def test_part_paid_amounts(client: TestClient, manager_headers: dict[str, str]) -> None:
    items = get(client, manager_headers, status="part_paid").json()["items"]
    assert len(items) == 2
    for item in items:
        assert 0 < item["paid_pence"] < item["total_pence"]
        assert item["balance_pence"] == item["total_pence"] - item["paid_pence"]
    overdue = get(client, manager_headers, status="overdue", page_size=100).json()["items"]
    assert any(0 < i["paid_pence"] < i["total_pence"] for i in overdue)  # a part-paid overdue one


def test_report_id_links_back_to_the_report(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    item = get(client, manager_headers, status="paid").json()["items"][0]
    report = client.get(f"/api/v1/manager/reports/{item['report_id']}", headers=manager_headers)
    assert report.status_code == 200
    assert report.json()["job"]["reference"] == item["job_reference"]
    assert report.json()["invoice"]["number"] == item["number"]


def test_pages_partition_the_invoices(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    want = [str(i.id) for i in expected_invoices(ds, ANCHOR)]
    pages = [get(client, manager_headers, page=n, page_size=20).json() for n in (1, 2, 3, 4)]
    assert [len(p["items"]) for p in pages] == [20, 20, 12, 0]
    assert all(p["total"] == 52 for p in pages)
    assert [i["id"] for p in pages for i in p["items"]] == want


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page_size": 101},
        {"page_size": 0},
        {"status": "unpaid"},
        {"status": "not_invoiced"},
    ],
)
def test_invalid_parameters_are_422(
    client: TestClient, manager_headers: dict[str, str], params: dict[str, Any]
) -> None:
    response = get(client, manager_headers, **params)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_status_filter_with_a_page_past_the_end_is_empty(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    body = get(client, manager_headers, status="void", page=2).json()
    assert body["items"] == [] and body["total"] == 1


def test_every_status_is_a_valid_invoice_status() -> None:
    assert {s.value for s in InvoiceStatus} == set(SEED_DISTRIBUTION)
