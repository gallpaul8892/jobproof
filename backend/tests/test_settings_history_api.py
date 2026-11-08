"""T-002f scenario 2: Admin settings changes are recorded; only the Admin reads them."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME
from tests.contract import assert_contract
from tests.write_helpers import ADMIN_NAME, awaiting_reports, event_count, history, patch

URL = "/api/v1/admin/settings"
HISTORY = "/api/v1/admin/settings/history"

pytestmark = pytest.mark.usefixtures("reseed", "restore_settings")


def _history(client: TestClient, headers: dict[str, str]) -> Any:
    response = client.get(HISTORY, headers=headers)
    assert response.status_code == 200, response.text
    assert_contract(response, "listAdminSettingsHistory")
    return response.json()


def test_no_changes_means_no_history(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert _history(client, admin_headers) == {"items": [], "total": 0}


def test_one_save_with_two_changes_is_one_event(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.patch(
        URL,
        json={
            "company_name": "Arbour Tree Care Ltd",
            "theme": {"primary": "#1f3a5f", "accent": DEFAULT_THEME.accent},
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    body = _history(client, admin_headers)
    assert body["total"] == 1
    event = body["items"][0]
    assert event["action"] == "settings.changed"
    assert event["actor"]["name"] == ADMIN_NAME
    assert event["occurred_at"] == response.json()["updated_at"]
    assert event["changes"] == [
        {
            "field": "company_name",
            "item_id": None,
            "item_label": None,
            "old_value": DEFAULT_COMPANY_NAME,
            "new_value": "Arbour Tree Care Ltd",
        },
        {
            "field": "theme_primary",
            "item_id": None,
            "item_label": None,
            "old_value": DEFAULT_THEME.primary,
            "new_value": "#1F3A5F",
        },
    ]


def test_both_colours_changing_records_both(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    client.patch(
        URL, json={"theme": {"primary": "#1F3A5F", "accent": "#1F3A5F"}}, headers=admin_headers
    )
    fields = [c["field"] for c in _history(client, admin_headers)["items"][0]["changes"]]
    assert fields == ["theme_primary", "theme_accent"]


def test_a_save_that_changes_nothing_records_no_event(
    client: TestClient, admin_headers: dict[str, str], db_engine: Engine
) -> None:
    assert (
        client.patch(URL, json={"company_name": "Acme"}, headers=admin_headers).status_code == 200
    )
    base = event_count(db_engine)
    same = client.patch(
        URL,
        json={
            "company_name": "Acme",
            "theme": {"primary": DEFAULT_THEME.primary.lower(), "accent": DEFAULT_THEME.accent},
        },
        headers=admin_headers,
    )
    assert same.status_code == 200
    assert event_count(db_engine) == base == 1


def test_a_partial_change_records_only_what_changed(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    client.patch(
        URL,
        json={
            "company_name": "Acme",
            "theme": {"primary": DEFAULT_THEME.primary, "accent": DEFAULT_THEME.accent},
        },
        headers=admin_headers,
    )
    changes = _history(client, admin_headers)["items"][0]["changes"]
    assert [c["field"] for c in changes] == ["company_name"]


def test_rejected_saves_record_nothing(
    client: TestClient, admin_headers: dict[str, str], db_engine: Engine
) -> None:
    bad_bodies = [
        {"company_name": ""},
        {"company_name": "x" * 61},
        {"company_name": "nul\x00"},
        {"theme": {"primary": "#FFFF00", "accent": "#FFFF00"}},  # contrast too low
        {"theme": {"primary": "red", "accent": "#1F5130"}},
        {"unknown": 1},
        {},
    ]
    for body in bad_bodies:
        assert client.patch(URL, json=body, headers=admin_headers).status_code == 422, body
    assert event_count(db_engine) == 0


def test_events_are_newest_first_and_names_are_snapshots(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    for name in ("One", "Two", "Three"):
        client.patch(URL, json={"company_name": name}, headers=admin_headers)
    items = _history(client, admin_headers)["items"]
    assert [i["changes"][0]["new_value"] for i in items] == ["Three", "Two", "One"]
    assert items[0]["changes"][0]["old_value"] == "Two"


def test_settings_events_do_not_appear_in_report_history_and_vice_versa(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    ds: Any,
) -> None:
    target = awaiting_reports(ds)[0]
    client.patch(URL, json={"company_name": "Acme"}, headers=admin_headers)
    patch(client, manager_headers, target.id, {"version": 1, "manager_notes": "x"})
    assert history(client, manager_headers, target.id)["total"] == 1
    assert _history(client, admin_headers)["total"] == 1


def test_only_the_admin_reads_settings_history(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    painter_headers: dict[str, str],
) -> None:
    assert client.get(HISTORY).status_code == 401
    for headers in (manager_headers, manager2_headers, painter_headers):
        response = client.get(HISTORY, headers=headers)
        assert response.status_code == 403
        assert_contract(response, "listAdminSettingsHistory")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_settings_history_is_read_only(
    client: TestClient, admin_headers: dict[str, str], method: str
) -> None:
    assert client.request(method, HISTORY, headers=admin_headers, json={}).status_code == 405
