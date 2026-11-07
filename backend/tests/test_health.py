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


def test_health_503_when_database_is_unreachable() -> None:
    settings = get_settings().model_copy(
        update={"database_url": "postgresql+psycopg://x:x@127.0.0.1:1/none"}
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["database"] == "unavailable"
    assert response.json()["status"] == "degraded"
    assert_contract(response, "getHealth")


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
def test_generated_docs_are_disabled(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 404
