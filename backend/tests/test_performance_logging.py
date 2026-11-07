"""T-001c scenario 10: bounded query counts, fast responses, and logs free of secrets."""

import json
import logging
import statistics
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.logging import JsonFormatter
from tests.conftest import MANAGER_LOGIN, PAINTER_LOGIN, login_token

MAX_QUERIES = 6
MAX_SECONDS = 0.3


@contextmanager
def count_queries(client: TestClient) -> Iterator[list[str]]:
    statements: list[str] = []
    engine = client.app.state.engine  # type: ignore[attr-defined]

    def on_execute(conn: Any, cursor: Any, statement: str, *rest: Any) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", on_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", on_execute)


def urls(ds: Any) -> dict[str, str]:
    busiest = max(ds.reports, key=lambda r: sum(p.report_id == r.id for p in ds.photos))
    return {
        "dashboard": "/api/v1/manager/dashboard",
        "painters": "/api/v1/manager/painters",
        "reports": "/api/v1/manager/reports",
        "reports filtered": (
            "/api/v1/manager/reports?q=road&billing_status=paid&review_status=reviewed"
        ),
        "report detail": f"/api/v1/manager/reports/{busiest.id}",
        "invoices": "/api/v1/manager/invoices",
        "invoices filtered": "/api/v1/manager/invoices?status=overdue",
    }


def test_each_manager_endpoint_uses_a_bounded_number_of_queries(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    for name, url in urls(ds).items():
        with count_queries(client) as statements:
            response = client.get(url, headers=manager_headers)
        assert response.status_code == 200, name
        assert 1 <= len(statements) <= MAX_QUERIES, (name, len(statements), statements)


@pytest.mark.parametrize("path", ["/api/v1/manager/reports", "/api/v1/manager/invoices"])
def test_list_query_count_does_not_depend_on_page_size(
    client: TestClient, manager_headers: dict[str, str], path: str
) -> None:
    counts = {}
    for page_size in (1, 5, 20, 100):
        with count_queries(client) as statements:
            response = client.get(f"{path}?page_size={page_size}", headers=manager_headers)
        assert response.status_code == 200
        assert len(response.json()["items"]) == min(page_size, response.json()["total"])
        counts[page_size] = len(statements)
    assert len(set(counts.values())) == 1, counts
    assert counts[1] <= MAX_QUERIES


def test_detail_query_count_does_not_depend_on_photo_count(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    per_report: dict[Any, int] = {}
    for photo in ds.photos:
        per_report[photo.report_id] = per_report.get(photo.report_id, 0) + 1
    many = max(per_report, key=lambda k: per_report[k])
    few = min(per_report, key=lambda k: per_report[k])
    assert per_report[many] > per_report[few] + 3
    counts = []
    for report_id in (many, few):
        with count_queries(client) as statements:
            assert (
                client.get(
                    f"/api/v1/manager/reports/{report_id}", headers=manager_headers
                ).status_code
                == 200
            )
        counts.append(len(statements))
    assert counts[0] == counts[1] or abs(counts[0] - counts[1]) <= 1  # payments query is optional
    assert max(counts) <= MAX_QUERIES


def test_auth_endpoints_query_counts(client: TestClient, manager_headers: dict[str, str]) -> None:
    with count_queries(client) as statements:
        assert client.get("/api/v1/auth/me", headers=manager_headers).status_code == 200
    assert len(statements) == 1
    with count_queries(client) as statements:
        login_token(client, *MANAGER_LOGIN)
    assert len(statements) == 1


def test_photo_image_uses_one_query(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    with_photos = {p.report_id for p in ds.photos}
    report = next(r for r in ds.reports if r.id in with_photos)
    photo = client.get(f"/api/v1/manager/reports/{report.id}", headers=manager_headers).json()[
        "photos"
    ][0]
    parsed = urlparse(photo["url"])
    with count_queries(client) as statements:
        response = client.get(f"{parsed.path}?{parsed.query}")
    assert response.status_code == 200
    assert len(statements) == 1


def test_manager_endpoints_respond_in_under_300ms(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    for name, url in urls(ds).items():
        client.get(url, headers=manager_headers)  # warm the connection pool and plan caches
        samples = []
        for _ in range(5):
            started = time.perf_counter()
            assert client.get(url, headers=manager_headers).status_code == 200
            samples.append(time.perf_counter() - started)
        assert statistics.median(samples) < MAX_SECONDS, (name, samples)


# ---- logging -----------------------------------------------------------------------------------


class Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        if record.name.startswith("httpx"):
            return  # the test client's own request log, not the server's
        self.lines.append(JsonFormatter().format(record))


@pytest.fixture
def captured() -> Iterator[Capture]:
    handler = Capture()
    root = logging.getLogger()
    previous = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    try:
        yield handler
    finally:
        root.removeHandler(handler)
        root.setLevel(previous)


def test_logs_never_contain_passwords_tokens_or_photo_signatures(
    client: TestClient, ds: Any, captured: Capture
) -> None:
    password = MANAGER_LOGIN[1]
    token = login_token(client, *MANAGER_LOGIN)
    headers = {"Authorization": f"Bearer {token}"}
    wrong = client.post(
        "/api/v1/auth/login", json={"email": MANAGER_LOGIN[0], "password": "Wr0ng-Passw0rd!"}
    )
    assert wrong.status_code == 401
    client.get("/api/v1/auth/me", headers=headers)
    client.get("/api/v1/manager/dashboard", headers=headers)
    client.get("/api/v1/manager/reports?q=secret-search-term", headers=headers)
    client.get("/api/v1/manager/dashboard", headers={"Authorization": "Bearer bad.token.value"})

    with_photos = {p.report_id for p in ds.photos}
    report = next(r for r in ds.reports if r.id in with_photos)
    photo = client.get(f"/api/v1/manager/reports/{report.id}", headers=headers).json()["photos"][0]
    parsed = urlparse(photo["url"])
    sig = parse_qs(parsed.query)["sig"][0]
    assert client.get(f"{parsed.path}?{parsed.query}").status_code == 200
    bad_sig = "f" * 64
    client.get(f"{parsed.path}?variant=full&exp=1&sig={bad_sig}")

    text = "\n".join(captured.lines)
    assert text, "expected some log output"
    for secret in (
        password,
        "Wr0ng-Passw0rd!",
        token,
        token.split(".")[1],
        sig,
        bad_sig,
        "bad.token.value",
    ):
        assert secret not in text, secret[:8]
    assert "Authorization" not in text and "authorization" not in text
    painter_pw = PAINTER_LOGIN[1]
    assert painter_pw not in text

    access = [json.loads(line) for line in captured.lines if '"jobproof.access"' in line]
    assert any(a["path"].endswith("/image") and "sig" not in json.dumps(a) for a in access)
    signed_in = [
        a for a in access if a["path"] == "/api/v1/manager/dashboard" and a["status"] == 200
    ]
    assert signed_in and signed_in[0]["user_id"]
    refused = [a for a in access if a["status"] == 401 and a["path"] == "/api/v1/manager/dashboard"]
    assert refused and "user_id" not in refused[0]
