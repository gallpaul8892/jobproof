"""Helpers for the T-002n customer tests."""

import json
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

CBASE = "/api/v1/manager/customers"
RBASE = "/api/v1/manager/reports"
HARBOURSIDE = "Harbourside Lettings Ltd"


def harbourside(ds: Any) -> Any:
    return next(c for c in ds.customers if c.name == HARBOURSIDE)


def send(
    client: TestClient, method: str, url: str, headers: dict[str, str], body: Any = None
) -> Any:
    """JSON with ASCII escapes, so lone surrogates in a hostile body reach the server intact."""
    return client.request(
        method,
        url,
        headers={**headers, "content-type": "application/json"},
        content=json.dumps(body),
    )


def get(client: TestClient, headers: dict[str, str], customer_id: Any) -> Any:
    response = client.get(f"{CBASE}/{customer_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def patch(client: TestClient, headers: dict[str, str], customer_id: Any, body: Any) -> Any:
    return send(client, "PATCH", f"{CBASE}/{customer_id}", headers, body)


def history(client: TestClient, headers: dict[str, str], customer_id: Any) -> Any:
    response = client.get(f"{CBASE}/{customer_id}/history", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def customer_events(engine: Engine, customer_id: Any = None) -> int:
    with engine.connect() as connection:
        if customer_id is None:
            return int(
                connection.execute(
                    text("SELECT count(*) FROM audit_events WHERE entity_type = 'customer'")
                ).scalar_one()
            )
        return int(
            connection.execute(
                text("SELECT count(*) FROM audit_events WHERE customer_id = :id"),
                {"id": customer_id},
            ).scalar_one()
        )


def customer_row(engine: Engine, customer_id: Any) -> tuple[Any, ...]:
    """Every column of the customer, to prove 'nothing changed'."""
    with engine.connect() as connection:
        return tuple(
            connection.execute(
                text("SELECT * FROM customers WHERE id = :id"), {"id": customer_id}
            ).one()
        )


def all_report_rows(engine: Engine) -> list[tuple[Any, ...]]:
    with engine.connect() as connection:
        return [tuple(r) for r in connection.execute(text("SELECT * FROM job_reports ORDER BY id"))]


def expected_impact(ds: Any, customer_id: Any, *, reviewed_extra: int = 0) -> dict[str, int]:
    """Counts worked out from the dataset, independently of the service's SQL."""
    job_ids = {j.id for j in ds.jobs if j.customer_id == customer_id}
    reports = [r for r in ds.reports if r.job_id in job_ids]
    return {
        "job_count": len(job_ids),
        "report_count": len(reports),
        "reviewed_report_count": sum(r.review_status.value == "reviewed" for r in reports)
        + reviewed_extra,
        "issued_invoice_count": sum(
            i.customer_id == customer_id and i.state.value == "issued" for i in ds.invoices
        ),
    }


def reports_of(ds: Any, customer_id: Any) -> list[Any]:
    job_ids = {j.id for j in ds.jobs if j.customer_id == customer_id}
    return [r for r in ds.reports if r.job_id in job_ids]
