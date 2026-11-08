"""T-002a scenario 3: the public branding endpoint."""

from fastapi.testclient import TestClient

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME
from tests.contract import assert_contract


def test_anonymous_branding_is_public_minimal_and_uncached(client: TestClient) -> None:
    response = client.get("/api/v1/branding")
    assert response.status_code == 200
    assert_contract(response, "getBranding")
    assert response.headers["cache-control"] == "no-cache"
    body = response.json()
    assert set(body) == {"company_name", "theme", "uk_only_contact_details"}
    assert body["uk_only_contact_details"] is True
    assert set(body["theme"]) == {"primary", "accent", "background", "surface", "text"}
    assert body["company_name"] == DEFAULT_COMPANY_NAME
    assert body["theme"] == {
        "primary": DEFAULT_THEME.primary,
        "accent": DEFAULT_THEME.accent,
        "background": DEFAULT_THEME.background,
        "surface": DEFAULT_THEME.surface,
        "text": DEFAULT_THEME.text,
    }


def test_branding_ignores_a_bad_token(client: TestClient) -> None:
    response = client.get("/api/v1/branding", headers={"Authorization": "Bearer nonsense"})
    assert response.status_code == 200


def test_branding_works_for_every_persona(
    client: TestClient,
    manager_headers: dict[str, str],
    painter_headers: dict[str, str],
    admin_headers: dict[str, str],
) -> None:
    for headers in (manager_headers, painter_headers, admin_headers):
        assert client.get("/api/v1/branding", headers=headers).json()["company_name"]


def test_branding_only_allows_get(client: TestClient) -> None:
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert client.request(method, "/api/v1/branding").status_code == 405


def test_cors_allows_patch_for_the_web_origin(client: TestClient) -> None:
    response = client.options(
        "/api/v1/admin/settings",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert "PATCH" in response.headers["access-control-allow-methods"]


def test_branding_exposes_the_uk_only_flag_to_everyone(
    client: TestClient, admin_headers: dict[str, str], restore_settings: None
) -> None:
    assert client.get("/api/v1/branding").json()["uk_only_contact_details"] is True
    client.patch(
        "/api/v1/admin/settings", json={"uk_only_contact_details": False}, headers=admin_headers
    )
    response = client.get("/api/v1/branding")
    assert_contract(response, "getBranding")
    assert response.json()["uk_only_contact_details"] is False
