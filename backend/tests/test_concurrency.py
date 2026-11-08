"""T-002g scenario 7 and T-002i scenario 7: real concurrent requests on separate connections.

Every thread gets its own application instance, so its own engine and connection pool: the
row lock, not a shared connection, is what has to serialise the requests.
"""

import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.main import create_app
from tests.conftest import bearer, login_token
from tests.contract import assert_contract
from tests.write_helpers import (
    BASE,
    MANAGER2_NAME,
    MANAGER_NAME,
    awaiting_reports,
    detail,
    event_count,
    history,
    reviewed_reports,
)

pytestmark = pytest.mark.usefixtures("reseed")

Request = Callable[[TestClient], Any]

# FastAPI builds each app's route state lazily on its first requests and, while doing so, wraps
# a pydantic call in `warnings.catch_warnings()`. In Python 3.13 that context manager swaps the
# process-wide filter list, so two threads doing it at once can restore each other's filters
# mid-build; pytest's `filterwarnings = error` then turns the suppressed pydantic warning into a
# 500. Only the setup is serialised: the requests under test still run at the same instant.
_SETUP_LOCK = threading.Lock()


def race(requests: list[tuple[str, Request]]) -> list[Any]:
    """Start every request at the same instant, each from its own app instance and client."""
    barrier = threading.Barrier(len(requests))
    results: list[Any] = [None] * len(requests)
    errors: list[BaseException] = []

    def run(index: int, who: str, call: Request) -> None:
        try:
            with TestClient(create_app()) as local:
                email, password = {
                    "sarah": ("manager@jobproof.test", "Manager123!"),
                    "priya": ("manager2@jobproof.test", "Manager123!"),
                }[who]
                with _SETUP_LOCK:  # see _SETUP_LOCK: warm up one app at a time
                    token = login_token(local, email, password)
                    local.headers.update(bearer(token))
                    unknown = uuid.uuid4()
                    assert local.get(f"{BASE}/{unknown}/history").status_code == 404
                    # Build the write routes too (404: nothing is written, no lock is taken).
                    review = local.post(f"{BASE}/{unknown}/review", json={"version": 1})
                    edit = local.patch(
                        f"{BASE}/{unknown}", json={"version": 1, "manager_notes": "x"}
                    )
                    assert (review.status_code, edit.status_code) == (404, 404)
                    customer = local.patch(
                        f"/api/v1/manager/customers/{unknown}", json={"version": 1, "name": "x"}
                    )
                    assert customer.status_code == 404
                barrier.wait(timeout=20)
                results[index] = call(local)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
            barrier.abort()

    threads = [
        threading.Thread(target=run, args=(i, who, call)) for i, (who, call) in enumerate(requests)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not errors, errors
    assert all(r is not None for r in results)
    return results


def _review(report_id: Any, version: int = 1) -> Request:
    return lambda c: c.post(f"{BASE}/{report_id}/review", json={"version": version})


def _edit(report_id: Any, body: dict[str, Any]) -> Request:
    return lambda c: c.patch(f"{BASE}/{report_id}", json=body)


def _codes(results: list[Any]) -> list[int]:
    return sorted(r.status_code for r in results)


def test_two_simultaneous_reviews_one_wins(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    results = race([("sarah", _review(target.id)), ("priya", _review(target.id))])
    assert _codes(results) == [200, 409]
    winner = next(r for r in results if r.status_code == 200)
    loser = next(r for r in results if r.status_code == 409)
    assert_contract(winner, "reviewManagerReport")
    assert_contract(loser, "reviewManagerReport")
    assert loser.json()["code"] == "version_conflict"
    assert loser.json()["current_version"] == 2
    final = detail(client, manager_headers, target.id)
    assert final["version"] == 2
    assert final["reviewed_by"] == winner.json()["reviewed_by"]
    assert final["reviewed_by"]["name"] in {MANAGER_NAME, MANAGER2_NAME}
    assert loser.json()["reviewed_by"] == final["reviewed_by"]
    assert event_count(db_engine, target.id) == 1
    assert history(client, manager_headers, target.id)["total"] == 1


def test_many_simultaneous_reviews_exactly_one_wins(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = awaiting_reports(ds)[1]
    results = race([("sarah" if i % 2 else "priya", _review(target.id)) for i in range(8)])
    assert _codes(results) == [200] + [409] * 7
    assert detail(client, manager_headers, target.id)["version"] == 2
    assert event_count(db_engine, target.id) == 1


def test_two_simultaneous_edits_one_wins_and_the_loser_sees_the_winner(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    results = race(
        [
            ("sarah", _edit(target.id, {"version": 1, "painter_notes": "from Sarah"})),
            ("priya", _edit(target.id, {"version": 1, "painter_notes": "from Priya"})),
        ]
    )
    assert _codes(results) == [200, 409]
    winner = next(r for r in results if r.status_code == 200)
    loser = next(r for r in results if r.status_code == 409)
    assert_contract(loser, "updateManagerReport")
    final = detail(client, manager_headers, target.id)
    assert final["painter_notes"] == winner.json()["painter_notes"]
    assert loser.json()["current"]["painter_notes"] == final["painter_notes"]
    assert loser.json()["last_changed_by"] == final["last_changed_by"]
    assert final["version"] == 2
    assert event_count(db_engine, target.id) == 1


def test_a_review_racing_an_edit_one_wins(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = awaiting_reports(ds)[2]
    results = race(
        [
            ("sarah", _review(target.id)),
            ("priya", _edit(target.id, {"version": 1, "manager_notes": "note"})),
        ]
    )
    assert _codes(results) == [200, 409]
    final = detail(client, manager_headers, target.id)
    assert final["version"] == 2
    assert event_count(db_engine, target.id) == 1


def test_edits_racing_to_reopen_a_reviewed_report_reopen_it_once(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    target = reviewed_reports(ds)[0]
    results = race(
        [
            ("sarah", _edit(target.id, {"version": 1, "painter_notes": "a"})),
            ("priya", _edit(target.id, {"version": 1, "manager_notes": "b"})),
        ]
    )
    assert _codes(results) == [200, 409]
    with db_engine.connect() as connection:
        reopened = connection.execute(
            text("SELECT count(*) FROM audit_events WHERE action = 'report.reopened'")
        ).scalar_one()
    assert reopened == 1
    assert detail(client, manager_headers, target.id)["review_status"] == "awaiting_review"


def test_edits_to_different_reports_do_not_block_each_other(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    a, b = awaiting_reports(ds)[:2]
    results = race(
        [
            ("sarah", _edit(a.id, {"version": 1, "manager_notes": "a"})),
            ("priya", _edit(b.id, {"version": 1, "manager_notes": "b"})),
        ]
    )
    assert _codes(results) == [200, 200]


def test_a_request_waits_for_a_held_lock_then_reports_the_new_state(
    client: TestClient, manager2_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    """Session A holds the row; the API call blocks, then sees A's committed version."""
    target = awaiting_reports(ds)[0]
    holder = db_engine.connect()
    transaction = holder.begin()
    holder.execute(
        text("UPDATE job_reports SET version = 2, manager_notes = 'held' WHERE id = :id"),
        {"id": target.id},
    )
    outcome: dict[str, Any] = {}

    def call() -> None:
        with TestClient(create_app()) as local:
            local.headers.update(manager2_headers)
            started = time.monotonic()
            outcome["response"] = local.post(f"{BASE}/{target.id}/review", json={"version": 1})
            outcome["seconds"] = time.monotonic() - started

    thread = threading.Thread(target=call)
    thread.start()
    time.sleep(1.0)
    assert thread.is_alive(), "the request should be waiting for the row lock"
    transaction.commit()
    holder.close()
    thread.join(timeout=20)
    response = outcome["response"]
    assert response.status_code == 409
    assert response.json()["code"] == "version_conflict"
    assert response.json()["current_version"] == 2
    assert outcome["seconds"] >= 0.9
    assert event_count(db_engine) == 0


def test_a_failed_request_releases_the_lock(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    target = awaiting_reports(ds)[0]
    for _ in range(12):  # more than the pool size: a leaked connection or lock would hang
        assert (
            client.post(
                f"{BASE}/{target.id}/review", json={"version": 9}, headers=manager_headers
            ).status_code
            == 409
        )
    assert (
        client.post(
            f"{BASE}/{target.id}/review", json={"version": 1}, headers=manager_headers
        ).status_code
        == 200
    )


# ---- T-002n: customers ------------------------------------------------------------------------

CBASE = "/api/v1/manager/customers"


def _edit_customer(customer_id: Any, body: dict[str, Any]) -> Request:
    return lambda c: c.patch(f"{CBASE}/{customer_id}", json=body)


def _customer(ds: Any) -> Any:
    return next(c for c in ds.customers if c.name == "Harbourside Lettings Ltd")


def _customer_events(engine: Engine, customer_id: Any) -> int:
    with engine.connect() as connection:
        return int(
            connection.execute(
                text("SELECT count(*) FROM audit_events WHERE customer_id = :id"),
                {"id": customer_id},
            ).scalar_one()
        )


def test_two_simultaneous_customer_edits_one_wins_and_the_loser_sees_the_winner(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    customer = _customer(ds)
    results = race(
        [
            ("sarah", _edit_customer(customer.id, {"version": 1, "phone": "0117 111 1111"})),
            ("priya", _edit_customer(customer.id, {"version": 1, "phone": "0117 222 2222"})),
        ]
    )
    assert _codes(results) == [200, 409]
    winner = next(r for r in results if r.status_code == 200)
    loser = next(r for r in results if r.status_code == 409)
    assert_contract(winner, "updateManagerCustomer")
    assert_contract(loser, "updateManagerCustomer")
    final = client.get(f"{CBASE}/{customer.id}", headers=manager_headers).json()
    assert final["version"] == 2
    assert final["phone"] == winner.json()["phone"]
    assert loser.json()["code"] == "version_conflict"
    assert loser.json()["current_version"] == 2
    assert loser.json()["current"] == {"phone": final["phone"]}
    assert loser.json()["last_changed_by"] == final["last_changed_by"]
    assert _customer_events(db_engine, customer.id) == 1


def test_many_simultaneous_customer_edits_exactly_one_wins(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    customer = _customer(ds)
    results = race(
        [
            (
                "sarah" if i % 2 else "priya",
                _edit_customer(customer.id, {"version": 1, "name": f"Racer {i}"}),
            )
            for i in range(8)
        ]
    )
    assert _codes(results) == [200] + [409] * 7
    assert client.get(f"{CBASE}/{customer.id}", headers=manager_headers).json()["version"] == 2
    assert _customer_events(db_engine, customer.id) == 1


def test_simultaneous_edits_of_different_fields_still_conflict_on_the_version(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    """The version guards the whole customer, not one field (merging is T-002o, client side)."""
    customer = _customer(ds)
    results = race(
        [
            ("sarah", _edit_customer(customer.id, {"version": 1, "phone": "0117 111 1111"})),
            ("priya", _edit_customer(customer.id, {"version": 1, "email": "p@example.co.uk"})),
        ]
    )
    assert _codes(results) == [200, 409]
    assert _customer_events(db_engine, customer.id) == 1


def test_edits_to_different_customers_do_not_block_each_other(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    a, b = ds.customers[0], ds.customers[1]
    results = race(
        [
            ("sarah", _edit_customer(a.id, {"version": 1, "phone": "0117 111 1111"})),
            ("priya", _edit_customer(b.id, {"version": 1, "phone": "0117 222 2222"})),
        ]
    )
    assert _codes(results) == [200, 200]


def test_a_customer_edit_and_a_report_edit_both_succeed_at_once(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    customer = _customer(ds)
    job_ids = {j.id for j in ds.jobs if j.customer_id == customer.id}
    target = next(r for r in awaiting_reports(ds) if r.job_id in job_ids)
    results = race(
        [
            ("sarah", _edit_customer(customer.id, {"version": 1, "phone": "0117 111 1111"})),
            ("priya", _edit(target.id, {"version": 1, "manager_notes": "note"})),
        ]
    )
    assert _codes(results) == [200, 200]
    assert detail(client, manager_headers, target.id)["version"] == 2
    assert client.get(f"{CBASE}/{customer.id}", headers=manager_headers).json()["version"] == 2
    # the report's history now holds both events
    assert history(client, manager_headers, target.id)["total"] == 2


def test_a_customer_edit_racing_a_review_of_its_report_leaves_the_review_in_place(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    customer = _customer(ds)
    job_ids = {j.id for j in ds.jobs if j.customer_id == customer.id}
    target = next(r for r in awaiting_reports(ds) if r.job_id in job_ids)
    results = race(
        [
            ("sarah", _edit_customer(customer.id, {"version": 1, "email": "r@example.co.uk"})),
            ("priya", _review(target.id)),
        ]
    )
    assert _codes(results) == [200, 200]
    assert detail(client, manager_headers, target.id)["review_status"] == "reviewed"


def test_a_customer_request_waits_for_a_held_lock_then_reports_the_new_state(
    client: TestClient, manager2_headers: dict[str, str], db_engine: Engine, ds: Any
) -> None:
    customer = _customer(ds)
    holder = db_engine.connect()
    transaction = holder.begin()
    holder.execute(
        text("UPDATE customers SET version = 2, phone = '0117 555 5555' WHERE id = :id"),
        {"id": customer.id},
    )
    outcome: dict[str, Any] = {}

    def call() -> None:
        with TestClient(create_app()) as local:
            local.headers.update(manager2_headers)
            started = time.monotonic()
            outcome["response"] = local.patch(
                f"{CBASE}/{customer.id}", json={"version": 1, "phone": "0117 999 9999"}
            )
            outcome["seconds"] = time.monotonic() - started

    thread = threading.Thread(target=call)
    thread.start()
    time.sleep(1.0)
    assert thread.is_alive(), "the request should be waiting for the row lock"
    transaction.commit()
    holder.close()
    thread.join(timeout=20)
    response = outcome["response"]
    assert response.status_code == 409
    assert response.json()["current_version"] == 2
    assert response.json()["current"] == {"phone": "0117 555 5555"}
    assert outcome["seconds"] >= 0.9
    assert _customer_events(db_engine, customer.id) == 0


def test_a_failed_customer_request_releases_the_lock(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    customer = _customer(ds)
    for _ in range(12):  # more than the pool size: a leaked connection or lock would hang
        response = client.patch(
            f"{CBASE}/{customer.id}",
            json={"version": 9, "phone": "0117 111 1111"},
            headers=manager_headers,
        )
        assert response.status_code == 409
        no_op = client.patch(
            f"{CBASE}/{customer.id}",
            json={"version": 1, "name": customer.name},
            headers=manager_headers,
        )
        assert no_op.status_code == 200
    ok = client.patch(
        f"{CBASE}/{customer.id}",
        json={"version": 1, "phone": "0117 111 1111"},
        headers=manager_headers,
    )
    assert ok.status_code == 200
