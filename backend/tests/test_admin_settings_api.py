"""T-002b scenario 5, T-002c and T-002e: reading and changing the company settings."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME
from tests.conftest import FIXED_NOW
from tests.contract import assert_contract

URL = "/api/v1/admin/settings"
LONG = "x" * 61


def _patch(client: TestClient, headers: dict[str, str], body: Any) -> Any:
    return client.patch(URL, json=body, headers=headers)


def _branding(client: TestClient) -> Any:
    return client.get("/api/v1/branding").json()


def _history_of_row(db_engine: Any) -> Any:
    with db_engine.connect() as connection:
        return connection.execute(
            text(
                "SELECT company_name, theme_primary, theme_accent, updated_at FROM company_settings"
            )
        ).one()


@pytest.fixture(autouse=True)
def _restore(restore_settings: None) -> None:
    return None


def test_admin_reads_defaults_with_null_audit_fields(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.get(URL, headers=admin_headers)
    assert response.status_code == 200
    assert_contract(response, "getAdminSettings")
    body = response.json()
    assert body["company_name"] == DEFAULT_COMPANY_NAME
    assert body["theme"]["primary"] == DEFAULT_THEME.primary
    assert body["updated_at"] is None and body["updated_by"] is None


# ---- company name (T-002c) ------------------------------------------------------------------


def test_changing_the_name_updates_branding_and_records_who_and_when(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = _patch(client, admin_headers, {"company_name": "Arbour Tree Care Ltd"})
    assert response.status_code == 200
    assert_contract(response, "updateAdminSettings")
    body = response.json()
    assert body["company_name"] == "Arbour Tree Care Ltd"
    assert body["updated_at"] == FIXED_NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert body["updated_by"]["name"] == "Tom Ashworth"
    assert _branding(client)["company_name"] == "Arbour Tree Care Ltd"
    assert client.get(URL, headers=admin_headers).json() == body
    assert body["theme"]["primary"] == DEFAULT_THEME.primary  # untouched


def test_the_name_is_trimmed_and_sixty_characters_are_accepted(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    assert (
        _patch(client, admin_headers, {"company_name": "  Oak Ltd  "}).json()["company_name"]
        == "Oak Ltd"
    )
    assert _patch(client, admin_headers, {"company_name": "y" * 60}).status_code == 200
    # Length counts code points, not UTF-16 units or bytes.
    assert _patch(client, admin_headers, {"company_name": "\U0001f3a8" * 60}).status_code == 200
    assert _patch(client, admin_headers, {"company_name": "\U0001f3a8" * 61}).status_code == 422


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("", "Enter a company name."),
        ("   ", "Enter a company name."),
        (LONG, "Use 60 characters or fewer."),
        ("A\u0000B", "Remove control characters."),
        ("A\nB", "Remove control characters."),
        ("A\u0085B", "Remove control characters."),
        ("A\u007fB", "Remove control characters."),
        ("\u0000" * 70, "Use 60 characters or fewer."),  # first failing rule wins
    ],
)
def test_invalid_names_are_422_and_nothing_is_saved(
    client: TestClient, admin_headers: dict[str, str], value: str, message: str
) -> None:
    response = _patch(client, admin_headers, {"company_name": value})
    assert response.status_code == 422
    assert_contract(response, "updateAdminSettings")
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["errors"] == [{"loc": ["body", "company_name"], "message": message}]
    assert _branding(client)["company_name"] == DEFAULT_COMPANY_NAME
    assert client.get(URL, headers=admin_headers).json()["updated_at"] is None


def test_markup_is_stored_as_plain_text(client: TestClient, admin_headers: dict[str, str]) -> None:
    name = "<script>alert(1)</script> & Sons"
    assert _patch(client, admin_headers, {"company_name": name}).status_code == 200
    assert _branding(client)["company_name"] == name


def test_a_save_that_changes_nothing_writes_nothing(
    client: TestClient, admin_headers: dict[str, str], db_engine: Any
) -> None:
    before = _history_of_row(db_engine)
    response = _patch(client, admin_headers, {"company_name": f"  {DEFAULT_COMPANY_NAME} "})
    assert response.status_code == 200
    assert response.json()["updated_at"] is None and response.json()["updated_by"] is None
    primary = {"primary": DEFAULT_THEME.primary.lower(), "accent": DEFAULT_THEME.accent}
    assert _patch(client, admin_headers, {"theme": primary}).json()["updated_at"] is None
    assert _history_of_row(db_engine) == before


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"company_name": None},
        {"company_name": 12},
        {"unknown": "x"},
        {"company_name": "OK", "role": "admin"},
        {"theme": None},
        {"theme": {"primary": "#1F3A5F", "accent": "#767676", "background": "#000000"}},
    ],
)
def test_malformed_bodies_are_422(
    client: TestClient, admin_headers: dict[str, str], body: Any
) -> None:
    response = _patch(client, admin_headers, body)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert_contract(response, "updateAdminSettings")


def test_a_non_object_body_is_422(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert _patch(client, admin_headers, ["company_name"]).status_code == 422
    raw = client.patch(
        URL, content=b"{nope", headers={**admin_headers, "Content-Type": "application/json"}
    )
    assert raw.status_code == 422


@pytest.mark.parametrize("persona", ["manager", "manager2", "painter"])
def test_other_personas_cannot_change_settings(
    client: TestClient, admin_headers: dict[str, str], request: pytest.FixtureRequest, persona: str
) -> None:
    headers = request.getfixturevalue(f"{persona}_headers")
    body = {"company_name": "Hijacked", "theme": {"primary": "#1F3A5F", "accent": "#2B4C7E"}}
    assert _patch(client, headers, body).status_code == 403
    assert client.patch(URL, json=body).status_code == 401
    assert _branding(client)["company_name"] == DEFAULT_COMPANY_NAME
    assert _branding(client)["theme"]["primary"] == DEFAULT_THEME.primary


# ---- colours (T-002e) -----------------------------------------------------------------------


def test_navy_preset_is_saved_and_published(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = _patch(client, admin_headers, {"theme": {"primary": "#1F3A5F", "accent": "#2B4C7E"}})
    assert response.status_code == 200
    assert_contract(response, "updateAdminSettings")
    assert response.json()["theme"] == {
        "primary": "#1F3A5F",
        "accent": "#2B4C7E",
        "background": DEFAULT_THEME.background,
        "surface": DEFAULT_THEME.surface,
        "text": DEFAULT_THEME.text,
    }
    assert _branding(client)["theme"]["primary"] == "#1F3A5F"
    assert response.json()["updated_by"]["name"] == "Tom Ashworth"


def test_the_boundary_colour_is_accepted(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = _patch(client, admin_headers, {"theme": {"primary": "#1F3A5F", "accent": "#767676"}})
    assert response.status_code == 200
    assert response.json()["theme"]["accent"] == "#767676"


@pytest.mark.parametrize(
    ("colour", "ratio"), [("#4CAF50", 2.78), ("#777777", 4.48), ("#FFD400", 1.43)]
)
def test_low_contrast_is_rejected_with_the_measured_ratio(
    client: TestClient, admin_headers: dict[str, str], colour: str, ratio: float
) -> None:
    response = _patch(
        client, admin_headers, {"theme": {"primary": colour, "accent": DEFAULT_THEME.accent}}
    )
    assert response.status_code == 422
    assert_contract(response, "updateAdminSettings")
    body = response.json()
    assert body["code"] == "contrast_too_low"
    assert body["detail"] == "Colours must have at least 4.5:1 contrast against white."
    assert body["errors"] == [
        {
            "loc": ["body", "theme", "primary"],
            "message": f"Contrast {ratio:.2f}:1 is below the required 4.5:1.",
            "measured_ratio": ratio,
            "required_ratio": 4.5,
        }
    ]
    assert _branding(client)["theme"]["primary"] == DEFAULT_THEME.primary


def test_one_error_per_failing_colour_and_the_request_is_atomic(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = _patch(
        client,
        admin_headers,
        {"company_name": "Should Not Save", "theme": {"primary": "#4CAF50", "accent": "#FFD400"}},
    )
    assert response.status_code == 422
    assert [e["loc"][-1] for e in response.json()["errors"]] == ["primary", "accent"]
    assert _branding(client)["company_name"] == DEFAULT_COMPANY_NAME  # nothing saved at all


@pytest.mark.parametrize(
    "theme",
    [
        {"primary": "green", "accent": "#2B4C7E"},
        {"primary": "#12345", "accent": "#2B4C7E"},
        {"primary": "#GGGGGG", "accent": "#2B4C7E"},
        {"primary": "1F5130", "accent": "#2B4C7E"},
        {"primary": "#1F3A5F"},
        {"primary": "#1F3A5F", "accent": 5},
    ],
)
def test_format_errors_come_before_contrast(
    client: TestClient, admin_headers: dict[str, str], theme: Any
) -> None:
    response = _patch(client, admin_headers, {"theme": theme})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["loc"][:2] == ["body", "theme"]
    assert_contract(response, "updateAdminSettings")


def test_a_bad_format_wins_over_a_low_contrast_colour(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = _patch(client, admin_headers, {"theme": {"primary": "#FFD400", "accent": "nope"}})
    assert response.json()["code"] == "validation_error"


def test_lower_case_colours_are_stored_upper_case(
    client: TestClient, admin_headers: dict[str, str], db_engine: Any
) -> None:
    response = _patch(client, admin_headers, {"theme": {"primary": "#1f3a5f", "accent": "#2b4c7e"}})
    assert response.status_code == 200
    assert response.json()["theme"]["primary"] == "#1F3A5F"
    assert _history_of_row(db_engine).theme_primary == "#1F3A5F"


def test_name_and_colours_change_independently(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    _patch(client, admin_headers, {"theme": {"primary": "#7A1F2B", "accent": "#8A2433"}})
    assert _branding(client)["company_name"] == DEFAULT_COMPANY_NAME
    _patch(client, admin_headers, {"company_name": "Only The Name"})
    branding = _branding(client)
    assert branding["company_name"] == "Only The Name"
    assert branding["theme"]["primary"] == "#7A1F2B"
    assert branding["theme"]["accent"] == "#8A2433"


def test_both_name_and_colours_in_one_request(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    body = {"company_name": "Both", "theme": {"primary": "#2B2B2B", "accent": "#444444"}}
    response = _patch(client, admin_headers, body)
    assert response.status_code == 200
    assert response.json()["company_name"] == "Both"
    assert response.json()["theme"]["primary"] == "#2B2B2B"


def test_the_updating_admin_name_is_a_snapshot(
    client: TestClient, admin_headers: dict[str, str], db_engine: Any
) -> None:
    _patch(client, admin_headers, {"company_name": "Snapshot Ltd"})
    with db_engine.begin() as connection:
        connection.execute(text("UPDATE users SET full_name = 'Renamed' WHERE role = 'admin'"))
    try:
        assert client.get(URL, headers=admin_headers).json()["updated_by"]["name"] == "Tom Ashworth"
    finally:
        with db_engine.begin() as connection:
            connection.execute(
                text("UPDATE users SET full_name = 'Tom Ashworth' WHERE role = 'admin'")
            )
