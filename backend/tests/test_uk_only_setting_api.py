"""T-002p: the admin setting `uk_only_contact_details` and how it governs customer edits."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from tests.conftest import FIXED_NOW
from tests.contract import assert_contract
from tests.customer_helpers import customer_events, get, harbourside, patch

SETTINGS = "/api/v1/admin/settings"
HISTORY = "/api/v1/admin/settings/history"
UK_PHONE = "Enter a UK phone number such as 07700 900123."
ANY_PHONE = (
    "Enter a UK phone number such as 07700 900123, or an international number starting with +."
)
UK_POSTCODE = "Enter a UK postcode such as BS6 5QA."
ANY_POSTCODE = "Enter a postcode."


@pytest.fixture(autouse=True)
def _restore(restore_settings: None, reseed: None) -> None:
    return None


def _set(client: TestClient, headers: dict[str, str], value: Any) -> Any:
    return client.patch(SETTINGS, json={"uk_only_contact_details": value}, headers=headers)


def _errors(response: Any) -> list[tuple[str, str]]:
    assert response.status_code == 422, response.text
    assert_contract(response, "updateManagerCustomer")
    return [(".".join(e["loc"][1:]), e["message"]) for e in response.json()["errors"]]


# ---- the setting ------------------------------------------------------------------------------


def test_the_default_is_true_for_admin_settings_and_branding(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.get(SETTINGS, headers=admin_headers)
    assert_contract(response, "getAdminSettings")
    assert response.json()["uk_only_contact_details"] is True
    assert client.get("/api/v1/branding").json()["uk_only_contact_details"] is True


def test_admin_toggles_it_and_the_change_is_audited_with_booleans(
    client: TestClient, admin_headers: dict[str, str], db_engine: Engine
) -> None:
    response = _set(client, admin_headers, False)
    assert response.status_code == 200
    assert_contract(response, "updateAdminSettings")
    body = response.json()
    assert body["uk_only_contact_details"] is False
    assert body["updated_at"] == FIXED_NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert body["updated_by"]["name"] == "Tom Ashworth"
    assert client.get("/api/v1/branding").json()["uk_only_contact_details"] is False

    history = client.get(HISTORY, headers=admin_headers).json()
    assert history["total"] == 1
    event = history["items"][0]
    assert event["action"] == "settings.changed"
    assert event["changes"] == [
        {
            "field": "uk_only_contact_details",
            "item_id": None,
            "item_label": None,
            "old_value": True,
            "new_value": False,
        }
    ]
    assert_contract(client.get(HISTORY, headers=admin_headers), "listAdminSettingsHistory")

    assert _set(client, admin_headers, True).json()["uk_only_contact_details"] is True
    assert client.get(HISTORY, headers=admin_headers).json()["total"] == 2


def test_setting_the_same_value_records_nothing(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = _set(client, admin_headers, True)
    assert response.status_code == 200
    assert response.json()["updated_at"] is None
    assert client.get(HISTORY, headers=admin_headers).json()["total"] == 0


def test_it_can_change_together_with_the_name_in_one_event(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.patch(
        SETTINGS,
        json={"company_name": "Arbour Ltd", "uk_only_contact_details": False},
        headers=admin_headers,
    )
    assert response.status_code == 200
    events = client.get(HISTORY, headers=admin_headers).json()["items"]
    assert len(events) == 1
    assert [c["field"] for c in events[0]["changes"]] == ["company_name", "uk_only_contact_details"]


@pytest.mark.parametrize("value", [None, "false", "true", 0, 1, [], {}])
def test_only_a_real_boolean_is_accepted(
    client: TestClient, admin_headers: dict[str, str], value: Any
) -> None:
    response = _set(client, admin_headers, value)
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "uk_only_contact_details"]
    assert client.get("/api/v1/branding").json()["uk_only_contact_details"] is True


def test_manager_and_painter_cannot_change_it(
    client: TestClient,
    manager_headers: dict[str, str],
    painter_headers: dict[str, str],
    admin_headers: dict[str, str],
) -> None:
    for headers in (manager_headers, painter_headers):
        assert _set(client, headers, False).status_code == 403
    assert client.patch(SETTINGS, json={"uk_only_contact_details": False}).status_code == 401
    assert client.get(SETTINGS, headers=admin_headers).json()["uk_only_contact_details"] is True
    assert client.get(HISTORY, headers=admin_headers).json()["total"] == 0


# ---- the customer rules follow the setting ----------------------------------------------------


@pytest.mark.parametrize(
    ("phone", "ok_when_uk_only"),
    [
        ("07700 900123", True),
        ("+44 7700 900123", True),
        ("+44 (0)117 496 0123", True),
        ("+44 0117 496 0123", False),
        ("+1 202 555 0100", False),
        ("+353 1 234 5678", False),
    ],
)
def test_phone_follows_the_setting(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    ds: Any,
    phone: str,
    ok_when_uk_only: bool,
) -> None:
    cid = harbourside(ds).id
    response = patch(client, manager_headers, cid, {"version": 1, "phone": phone})
    if ok_when_uk_only:
        assert response.status_code == 200
    else:
        assert _errors(response) == [("phone", UK_PHONE)]
    _set(client, admin_headers, False)
    version = get(client, manager_headers, cid)["version"]
    response = patch(client, manager_headers, cid, {"version": version, "phone": phone})
    assert response.status_code == 200
    assert response.json()["phone"] == phone
    assert _errors(patch(client, manager_headers, cid, {"version": version, "phone": "abc"})) == [
        ("phone", ANY_PHONE)
    ]


def test_postcode_follows_the_setting(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    ds: Any,
    db_engine: Engine,
) -> None:
    cid = harbourside(ds).id
    body = {"version": 1, "billing_address": {"postcode": " k1a  0b1 "}}
    assert _errors(patch(client, manager_headers, cid, body)) == [
        ("billing_address.postcode", UK_POSTCODE)
    ]
    assert customer_events(db_engine) == 0

    _set(client, admin_headers, False)
    response = patch(client, manager_headers, cid, body)
    assert response.status_code == 200
    assert response.json()["billing_address"]["postcode"] == "K1A 0B1"
    version = response.json()["version"]
    for bad in ("", "1", "1" * 13, "12.3", "-12"):
        sent = {"version": version, "billing_address": {"postcode": bad}}
        assert _errors(patch(client, manager_headers, cid, sent)) == [
            ("billing_address.postcode", ANY_POSTCODE)
        ]
    # a UK postcode still gets the UK form
    sent = {"version": version, "billing_address": {"postcode": "bs65qa"}}
    assert patch(client, manager_headers, cid, sent).json()["billing_address"]["postcode"] == (
        "BS6 5QA"
    )


def test_turning_the_setting_on_leaves_stored_values_alone(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    ds: Any,
) -> None:
    cid = harbourside(ds).id
    _set(client, admin_headers, False)
    sent = {"version": 1, "phone": "+1 202 555 0100", "billing_address": {"postcode": "10001"}}
    assert patch(client, manager_headers, cid, sent).status_code == 200
    _set(client, admin_headers, True)
    stored = get(client, manager_headers, cid)
    assert stored["phone"] == "+1 202 555 0100"
    assert stored["billing_address"]["postcode"] == "10001"
    # an unrelated edit is not blocked by the stored values
    response = patch(client, manager_headers, cid, {"version": 2, "name": "Harbourside Homes"})
    assert response.status_code == 200
    assert response.json()["phone"] == "+1 202 555 0100"
    # and re-sending the stored values is a no-op, not a validation error
    again = patch(client, manager_headers, cid, {"version": 3, "contact_name": None, "email": None})
    assert again.status_code == 200


def test_email_is_the_same_in_both_modes(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    ds: Any,
) -> None:
    cid = harbourside(ds).id
    for flag in (True, False):
        _set(client, admin_headers, flag)
        response = patch(client, manager_headers, cid, {"version": 1, "email": "nope"})
        message = "Enter an email address such as name@example.co.uk."
        assert _errors(response) == [("email", message)]
