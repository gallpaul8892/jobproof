"""T-003c, T-003d and design section 8: an operative sees only their own jobs and never the
office's private data (manager notes, money, customer email, billing address)."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.models.enums import UserRole
from app.seed.dataset import Dataset
from tests.conftest import ANCHOR, bearer, make_token
from tests.contract import assert_contract, contract_operations
from tests.operative_helpers import PRIYA_EMAIL, user_id

LIST = "/api/v1/operative/jobs"
FORBIDDEN_KEYS = {
    "manager_notes",
    "email",
    "billing_address",
    "total_pence",
    "quote",
    "invoice",
    "payments",
}


def _keys(node: Any) -> set[str]:
    if isinstance(node, dict):
        return set(node) | {k for v in node.values() for k in _keys(v)}
    if isinstance(node, list):
        return {k for v in node for k in _keys(v)}
    return set()


def _headers(db_engine: Any, email: str) -> dict[str, str]:
    return bearer(make_token(user_id(db_engine, email), role="painter"))


def _operatives(ds: Dataset) -> list[Any]:
    return [u for u in ds.users if u.role is UserRole.painter]


def _expected_refs(ds: Dataset, operative: Any) -> set[str]:
    """Jobs the list may show: assigned to them, today or earlier and open."""
    return {
        j.reference
        for j in ds.jobs
        if j.painter_id == operative.id
        and (j.scheduled_start == ANCHOR or (j.scheduled_start < ANCHOR and j.completed_on is None))
    }


def test_every_operative_sees_exactly_their_own_jobs(
    client: TestClient, db_engine: Any, ds: Dataset
) -> None:
    for operative in _operatives(ds):
        response = client.get(LIST, headers=_headers(db_engine, operative.email))
        assert response.status_code == 200
        body = response.json()
        shown = {j["reference"] for j in body["jobs_today"] + body["earlier_unfinished"]}
        assert shown == _expected_refs(ds, operative), operative.email
        assert shown, operative.email


def test_no_operative_can_open_another_operatives_job(
    client: TestClient, db_engine: Any, ds: Dataset
) -> None:
    for caller in _operatives(ds):
        headers = _headers(db_engine, caller.email)
        for job in ds.jobs:
            if job.painter_id == caller.id:
                continue
            response = client.get(f"{LIST}/{job.id}", headers=headers)
            assert response.status_code == 404, (caller.email, job.reference)
            assert response.json()["code"] == "not_found"


def test_an_owner_id_sent_by_the_client_is_ignored(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, ds: Dataset
) -> None:
    priya = next(u for u in ds.users if u.email == PRIYA_EMAIL)
    plain = client.get(LIST, headers=painter_headers).json()
    for extra in (f"?painter_id={priya.id}", f"?user_id={priya.id}", f"?operative_id={priya.id}"):
        assert (
            client.get(f"{LIST}{extra}", headers=painter_headers).json()["jobs_today"]
            == (plain["jobs_today"])
        )
    forged = client.get(
        LIST, headers={**painter_headers, "X-User-Id": str(priya.id), "X-Role": "manager"}
    )
    assert forged.json()["jobs_today"] == plain["jobs_today"]


def test_a_token_claiming_the_manager_role_is_still_the_database_role(
    client: TestClient, db_engine: Any
) -> None:
    dan = user_id(db_engine, "painter@jobproof.test")
    claims_manager = bearer(make_token(dan, role="manager"))
    assert client.get(LIST, headers=claims_manager).status_code == 200  # still a painter
    manager = user_id(db_engine, "manager@jobproof.test")
    claims_painter = bearer(make_token(manager, role="painter"))
    assert client.get(LIST, headers=claims_painter).status_code == 403


def test_no_private_key_in_any_operative_response(
    client: TestClient, db_engine: Any, ds: Dataset
) -> None:
    seen = 0
    for operative in _operatives(ds):
        headers = _headers(db_engine, operative.email)
        listing = client.get(LIST, headers=headers)
        assert not _keys(listing.json()) & FORBIDDEN_KEYS
        for job in listing.json()["jobs_today"] + listing.json()["earlier_unfinished"]:
            detail = client.get(f"{LIST}/{job['id']}", headers=headers)
            assert not _keys(detail.json()) & FORBIDDEN_KEYS, job["reference"]
            seen += 1
    assert seen >= 10


def test_manager_notes_and_customer_email_never_reach_the_operative(
    client: TestClient, db_engine: Any, ds: Dataset
) -> None:
    """Even when the office has written notes on the operative's own submitted report."""
    headers = _headers(db_engine, PRIYA_EMAIL)
    priya = next(u for u in ds.users if u.email == PRIYA_EMAIL)
    report = next(
        r
        for r in ds.reports
        if r.painter_id == priya.id
        and r.job_id in {j.id for j in ds.jobs if j.reference == "JP-1065"}
    )
    job = next(j for j in ds.jobs if j.id == report.job_id)
    customer = next(c for c in ds.customers if c.id == job.customer_id)
    secret = "OFFICE ONLY: customer is disputing the bill"
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE job_reports SET manager_notes = :n WHERE id = :i"),
            {"n": secret, "i": report.id},
        )
    try:
        for url in (LIST, f"{LIST}/{job.id}"):
            response = client.get(url, headers=headers)
            assert response.status_code == 200
            assert secret not in response.text and "manager_notes" not in response.text
            assert customer.email is not None and customer.email not in response.text
            assert customer.billing_line1 not in response.text
            assert json.loads(response.text)  # still a normal body
    finally:
        with db_engine.begin() as connection:
            connection.execute(
                text("UPDATE job_reports SET manager_notes = NULL WHERE id = :i"), {"i": report.id}
            )


def test_managers_and_admins_are_refused_on_every_operative_operation(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    ds: Dataset,
) -> None:
    job = next(j for j in ds.jobs if j.reference == "JP-1061")
    operations = [
        (method, path, operation_id)
        for (method, path), operation_id in contract_operations().items()
        if path.startswith("/api/v1/operative")
    ]
    assert {o[2] for o in operations} >= {"listOperativeJobs", "getOperativeJob"}
    for method, path, operation_id in operations:
        url = path.replace("{job_id}", str(job.id)).replace("{photo_id}", str(job.id))
        for headers in (manager_headers, admin_headers):
            response = client.request(method, url, headers=headers)
            assert response.status_code in (403, 422), (operation_id, response.status_code)
            if response.status_code == 403:
                assert response.json()["code"] == "forbidden"
                assert_contract(response, operation_id)


@pytest.mark.parametrize("path", ["/api/v1/manager/dashboard", "/api/v1/admin/settings"])
def test_operatives_keep_their_403_on_manager_and_admin_endpoints(
    client: TestClient, painter_headers: dict[str, str], path: str
) -> None:
    assert client.get(path, headers=painter_headers).status_code == 403
