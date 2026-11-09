import socket
import time

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from tests.contract import assert_contract


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "version": "0.1.0"}
    assert_contract(response, "getHealth")


def _degraded_health(url: str) -> tuple[float, "object"]:
    settings = get_settings().model_copy(update={"database_url": url})
    with TestClient(create_app(settings)) as client:
        start = time.monotonic()
        response = client.get("/health")
        elapsed = time.monotonic() - start
    return elapsed, response


def test_health_503_when_database_is_unreachable() -> None:
    elapsed, response = _degraded_health("postgresql+psycopg://x:x@127.0.0.1:1/none")
    assert response.status_code == 503
    assert response.json()["database"] == "unavailable"
    assert response.json()["status"] == "degraded"
    assert_contract(response, "getHealth")
    assert elapsed < 3


def test_health_503_within_3s_when_database_blackholed() -> None:
    """Exercises the connect timeout: packets to a blackhole IP are dropped, not refused."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.5)
    try:
        probe.connect(("10.255.255.1", 5432))
    except TimeoutError:
        pass  # packets silently dropped: the situation we want
    except OSError as exc:
        pytest.skip(f"sandbox does not blackhole 10.255.255.1 (instant failure: {exc})")
    else:
        pytest.skip("10.255.255.1 unexpectedly accepted a connection")
    finally:
        probe.close()

    elapsed, response = _degraded_health("postgresql+psycopg://x:x@10.255.255.1:5432/none")
    assert response.status_code == 503
    assert response.json()["database"] == "unavailable"
    assert_contract(response, "getHealth")
    assert elapsed < 3


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
def test_generated_docs_are_disabled(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 404


def test_health_live_ok(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert_contract(response, "getHealthLive")


def test_health_live_does_not_touch_the_database() -> None:
    """A database failover must not fail the load balancer's liveness check."""
    settings = get_settings().model_copy(
        update={"database_url": "postgresql+psycopg://x:x@127.0.0.1:1/none"}
    )
    with TestClient(create_app(settings)) as unreachable:
        response = unreachable.get("/health/live")
        assert unreachable.get("/health").status_code == 503
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert_contract(response, "getHealthLive")
