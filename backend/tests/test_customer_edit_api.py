"""T-002n: read, correct and list the history of a customer's details (API level)."""

import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.conftest import ANCHOR
from tests.contract import assert_contract
from tests.customer_helpers import (
    CBASE,
    RBASE,
    all_report_rows,
    customer_events,
    customer_row,
    expected_impact,
    get,
    harbourside,
    history,
    patch,
    reports_of,
    send,
)
from tests.test_customer_validation import ADDRESS_FIELDS, CASES, body_for
from tests.write_helpers import (
    MANAGER2_NAME,
    MANAGER_NAME,
    awaiting_reports,
    dashboard,
    reviewed_reports,
)
from tests.write_helpers import history as report_history
from tests.write_helpers import patch as patch_report
from tests.write_helpers import review as review_report


@pytest.fixture(scope="module")
def table_data(db_engine: Engine) -> Iterator[None]:
    """One reseed for the whole module: the validation table does not need a fresh database."""
    from app.seed.dataset import build_dataset
    from app.seed.loader import load

    load(db_engine, build_dataset(ANCHOR))
    yield
    load(db_engine, build_dataset(ANCHOR))


# ---- scenario 1: read ------------------------------------------------------------------------


def test_get_returns_the_dataset_values_version_one_and_computed_impact(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    customer = harbourside(ds)
    response = client.get(f"{CBASE}/{customer.id}", headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, "getManagerCustomer")
    body = response.json()
    assert body == {
        "id": str(customer.id),
        "name": customer.name,
        "customer_type": customer.customer_type.value,
        "contact_name": customer.contact_name,
        "email": customer.email,
        "phone": customer.phone,
        "billing_address": {
            "line1": customer.billing_line1,
            "line2": customer.billing_line2,
            "town": customer.billing_town,
            "county": customer.billing_county,
            "postcode": customer.billing_postcode,
        },
        "version": 1,
        "last_changed_at": None,
        "last_changed_by": None,
        "impact": expected_impact(ds, customer.id),
    }
    assert body["impact"]["job_count"] == 12
    assert "notes" not in body and "payment_terms_days" not in body


def test_impact_counts_are_right_for_every_customer(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    for customer in ds.customers:
        body = get(client, manager_headers, customer.id)
        assert body["impact"] == expected_impact(ds, customer.id), customer.name
    assert sum(
        get(client, manager_headers, c.id)["impact"]["job_count"] for c in ds.customers
    ) == len(ds.jobs)


def test_issued_invoices_only_count_when_issued(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    customer = harbourside(ds)
    issued = [i for i in ds.invoices if i.customer_id == customer.id and i.state.value == "issued"]
    assert issued, "the dataset should give Harbourside an issued invoice"
    before = get(client, manager_headers, customer.id)["impact"]["issued_invoice_count"]
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE invoices SET state = 'void' WHERE id = :id"), {"id": issued[0].id}
        )
    assert get(client, manager_headers, customer.id)["impact"]["issued_invoice_count"] == before - 1


def test_reports_list_filters_by_customer(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    customer = harbourside(ds)
    response = client.get(
        f"{RBASE}?customer_id={customer.id}&page_size=100", headers=manager_headers
    )
    assert response.status_code == 200
    assert_contract(response, "listManagerReports")
    body = response.json()
    expected = {str(r.id) for r in reports_of(ds, customer.id)}
    assert body["total"] == len(expected) == 12
    assert {i["id"] for i in body["items"]} == expected
    assert {i["customer"]["id"] for i in body["items"]} == {str(customer.id)}
    # ANDed with the other filters
    reviewed = client.get(
        f"{RBASE}?customer_id={customer.id}&review_status=reviewed&page_size=100",
        headers=manager_headers,
    ).json()
    assert {i["id"] for i in reviewed["items"]} == {
        str(r.id) for r in reports_of(ds, customer.id) if r.review_status.value == "reviewed"
    }
    # unknown id: an empty page, not an error
    unknown = client.get(f"{RBASE}?customer_id={uuid.uuid4()}", headers=manager_headers)
    assert unknown.status_code == 200 and unknown.json()["total"] == 0
    assert client.get(f"{RBASE}?customer_id=nope", headers=manager_headers).status_code == 422
    # the customers partition the reports
    total = sum(
        client.get(f"{RBASE}?customer_id={c.id}", headers=manager_headers).json()["total"]
        for c in ds.customers
    )
    assert total == len(ds.reports)


# ---- scenario 2: an edit ---------------------------------------------------------------------


def test_editing_the_phone_bumps_the_version_and_records_one_event(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    customer = harbourside(ds)
    response = patch(client, manager_headers, customer.id, {"version": 1, "phone": "0117 496 0123"})
    assert response.status_code == 200, response.text
    assert_contract(response, "updateManagerCustomer")
    body = response.json()
    assert body["version"] == 2
    assert body["phone"] == "0117 496 0123"
    assert body["last_changed_by"]["name"] == MANAGER_NAME
    assert body["last_changed_at"].endswith("Z")
    assert body["impact"] == expected_impact(ds, customer.id)
    assert body == get(client, manager_headers, customer.id)

    events = history(client, manager_headers, customer.id)
    assert events["total"] == 1
    event = events["items"][0]
    assert_contract(
        client.get(f"{CBASE}/{customer.id}/history", headers=manager_headers),
        "listManagerCustomerHistory",
    )
    assert event["action"] == "customer.edited"
    assert event["customer_id"] == str(customer.id)
    assert event["actor"]["name"] == MANAGER_NAME
    assert event["occurred_at"] == body["last_changed_at"]
    assert event["changes"] == [
        {
            "field": "customer_phone",
            "item_id": None,
            "item_label": None,
            "old_value": customer.phone,
            "new_value": "0117 496 0123",
        }
    ]
    assert customer_events(db_engine) == 1


def test_every_field_is_recorded_with_old_and_new_values_in_one_event(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    customer = harbourside(ds)
    body = {
        "version": 1,
        "name": "  Harbourside Lets Ltd ",
        "contact_name": " ",
        "email": "new@example.co.uk",
        "phone": "",
        "billing_address": {
            "line1": "1 New Quay",
            "line2": "Floor 2",
            "town": "Bath",
            "county": "Somerset",
            "postcode": "ba11ua",
        },
    }
    response = patch(client, manager2_headers, customer.id, body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["last_changed_by"]["name"] == MANAGER2_NAME
    assert saved["contact_name"] is None and saved["phone"] is None
    assert saved["billing_address"] == {
        "line1": "1 New Quay",
        "line2": "Floor 2",
        "town": "Bath",
        "county": "Somerset",
        "postcode": "BA1 1UA",
    }
    event = history(client, manager_headers, customer.id)["items"][0]
    by_field = {c["field"]: (c["old_value"], c["new_value"]) for c in event["changes"]}
    assert by_field == {
        "customer_name": (customer.name, "Harbourside Lets Ltd"),
        "customer_contact_name": (customer.contact_name, None),
        "customer_email": (customer.email, "new@example.co.uk"),
        "customer_phone": (customer.phone, None),
        "customer_billing_line1": (customer.billing_line1, "1 New Quay"),
        "customer_billing_line2": (customer.billing_line2, "Floor 2"),
        "customer_billing_town": (customer.billing_town, "Bath"),
        "customer_billing_county": (customer.billing_county, "Somerset"),
        "customer_billing_postcode": (customer.billing_postcode, "BA1 1UA"),
    }
    assert len(event["changes"]) == 9
    assert all(c["item_id"] is None and c["item_label"] is None for c in event["changes"])


def test_only_changed_fields_are_recorded(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    customer = harbourside(ds)
    response = patch(
        client,
        manager_headers,
        customer.id,
        {
            "version": 1,
            "name": customer.name,
            "email": "other@example.co.uk",
            "billing_address": {"town": customer.billing_town, "county": "Avon"},
        },
    )
    assert response.status_code == 200
    changes = history(client, manager_headers, customer.id)["items"][0]["changes"]
    assert [c["field"] for c in changes] == ["customer_email", "customer_billing_county"]


def test_the_full_value_is_recorded_without_truncation(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    name = "N" * 120
    assert (
        patch(client, manager_headers, harbourside(ds).id, {"version": 1, "name": name}).status_code
        == 200
    )
    change = history(client, manager_headers, harbourside(ds).id)["items"][0]["changes"][0]
    assert change["new_value"] == name


def test_the_second_edit_chains_versions_and_history_is_newest_first(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    cid = harbourside(ds).id
    for version, phone in enumerate(["0117 496 0001", "0117 496 0002", "0117 496 0003"], start=1):
        response = patch(client, manager_headers, cid, {"version": version, "phone": phone})
        assert response.status_code == 200 and response.json()["version"] == version + 1
    items = history(client, manager_headers, cid)["items"]
    assert [i["changes"][0]["new_value"] for i in items] == [
        "0117 496 0003",
        "0117 496 0002",
        "0117 496 0001",
    ]
    assert items[0]["changes"][0]["old_value"] == "0117 496 0002"


def test_history_is_capped_at_the_latest_100(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    cid = harbourside(ds).id
    for n in range(1, 103):
        response = patch(
            client, manager_headers, cid, {"version": n, "phone": f"0117 {n:03d} 0000"}
        )
        assert response.status_code == 200
    body = history(client, manager_headers, cid)
    assert body["total"] == 102 and len(body["items"]) == 100
    assert body["items"][0]["changes"][0]["new_value"] == "0117 102 0000"
    assert body["items"][-1]["changes"][0]["new_value"] == "0117 003 0000"


def test_an_untouched_customer_has_an_empty_history(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    assert history(client, manager_headers, ds.customers[3].id) == {"items": [], "total": 0}


def test_history_only_holds_this_customers_events(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    a, b = ds.customers[0], ds.customers[1]
    assert (
        patch(client, manager_headers, a.id, {"version": 1, "phone": "0117 111 1111"}).status_code
        == 200
    )
    assert history(client, manager_headers, a.id)["total"] == 1
    assert history(client, manager_headers, b.id)["total"] == 0


# ---- scenario 3: impact after a review -------------------------------------------------------


def test_impact_follows_reviews_without_any_stored_counter(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    customer = harbourside(ds)
    before = get(client, manager_headers, customer.id)["impact"]
    target = next(r for r in awaiting_reports(ds) if r in reports_of(ds, customer.id))
    assert review_report(client, manager_headers, target.id).status_code == 200
    after = get(client, manager_headers, customer.id)["impact"]
    assert after["reviewed_report_count"] == before["reviewed_report_count"] + 1
    assert after["report_count"] == before["report_count"]
    assert after == expected_impact(ds, customer.id, reviewed_extra=1)


# ---- scenario 4: reviewed reports stay reviewed ----------------------------------------------


def test_a_customer_edit_leaves_every_report_untouched_and_shows_in_their_histories(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    customer = harbourside(ds)
    mine = reports_of(ds, customer.id)
    reviewed = [r for r in mine if r.review_status.value == "reviewed"]
    assert reviewed and len(mine) > len(reviewed)
    other_reports = [r for r in ds.reports if r not in mine]
    rows_before = all_report_rows(db_engine)
    queue_before = dashboard(client, manager_headers)["reports_awaiting_review"]
    detail_before = client.get(f"{RBASE}/{reviewed[0].id}", headers=manager_headers).json()

    response = patch(
        client, manager_headers, customer.id, {"version": 1, "email": "fix@example.co.uk"}
    )
    assert response.status_code == 200

    assert all_report_rows(db_engine) == rows_before  # no version bump, no reopen, nothing
    assert dashboard(client, manager_headers)["reports_awaiting_review"] == queue_before
    detail = client.get(f"{RBASE}/{reviewed[0].id}", headers=manager_headers).json()
    assert detail["review_status"] == "reviewed"
    assert detail["version"] == detail_before["version"] == 1
    assert detail["reviewed_by"] == detail_before["reviewed_by"]
    assert detail["reviewed_at"] == detail_before["reviewed_at"]
    assert detail["customer"]["email"] == "fix@example.co.uk"  # the report shows the new details

    event_id = history(client, manager_headers, customer.id)["items"][0]["id"]
    for report in mine:
        items = report_history(client, manager_headers, report.id)["items"]
        assert items[0]["id"] == event_id, report.id
        assert items[0]["action"] == "customer.edited"
        assert items[0]["customer_id"] == str(customer.id)
    for report in other_reports[:10]:
        ids = [i["id"] for i in report_history(client, manager_headers, report.id)["items"]]
        assert event_id not in ids


def test_report_history_merges_report_and_customer_events_in_order(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    customer = harbourside(ds)
    target = next(r for r in awaiting_reports(ds) if r in reports_of(ds, customer.id))
    sibling = next(r for r in reviewed_reports(ds) if r in reports_of(ds, customer.id))
    assert (
        patch_report(
            client, manager_headers, target.id, {"version": 1, "manager_notes": "a"}
        ).status_code
        == 200
    )
    assert (
        patch(
            client, manager_headers, customer.id, {"version": 1, "phone": "0117 222 2222"}
        ).status_code
        == 200
    )
    assert review_report(client, manager_headers, target.id, 2).status_code == 200
    assert (
        patch(
            client, manager_headers, customer.id, {"version": 2, "email": "z@example.co.uk"}
        ).status_code
        == 200
    )

    body = report_history(client, manager_headers, target.id)
    assert body["total"] == 4
    assert [(i["action"], i["customer_id"]) for i in body["items"]] == [
        ("customer.edited", str(customer.id)),
        ("report.reviewed", None),
        ("customer.edited", str(customer.id)),
        ("report.edited", None),
    ]
    # a sibling report sees the customer's two events only
    sibling_items = report_history(client, manager_headers, sibling.id)["items"]
    assert [i["action"] for i in sibling_items] == ["customer.edited", "customer.edited"]
    # the customer page sees the customer's two events only
    assert history(client, manager_headers, customer.id)["total"] == 2


# ---- scenarios 5, 6, 7: validation, driven by the shared case table --------------------------


def set_uk_only(db_engine: Engine, value: bool) -> None:
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE company_settings SET uk_only_contact_details = :value"), {"value": value}
        )


@pytest.fixture
def uk_only_default(db_engine: Engine) -> Iterator[None]:
    yield
    set_uk_only(db_engine, True)


@pytest.mark.usefixtures("uk_only_default")
@pytest.mark.parametrize("case", CASES, ids=[f"{c['field']}-{i}" for i, c in enumerate(CASES)])
def test_validation_cases_through_the_api(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    table_data: None,
    case: dict[str, Any],
) -> None:
    cid = harbourside(ds).id
    set_uk_only(db_engine, case.get("ukOnly", True))
    current = get(client, manager_headers, cid)
    events_before = customer_events(db_engine)
    row_before = customer_row(db_engine, cid)
    response = patch(client, manager_headers, cid, body_for(case, current["version"]))
    field = case["field"]
    if case["ok"]:
        assert response.status_code == 200, (case, response.text)
        saved = response.json()
        value = saved["billing_address"][field] if field in ADDRESS_FIELDS else saved[field]
        assert value == case["stored"]
        assert saved["version"] in (current["version"], current["version"] + 1)
        assert (saved["version"] == current["version"]) == (
            value
            == (current["billing_address"][field] if field in ADDRESS_FIELDS else current[field])
        )
    else:
        assert response.status_code == 422, (case, response.text)
        assert_contract(response, "updateManagerCustomer")
        loc = ["body", "billing_address", field] if field in ADDRESS_FIELDS else ["body", field]
        assert response.json()["errors"] == [{"loc": loc, "message": case["message"]}]
        assert customer_events(db_engine) == events_before
        assert customer_row(db_engine, cid) == row_before


@pytest.mark.usefixtures("uk_only_default")
def test_phone_and_postcode_problems_come_together_once_the_rest_is_valid(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    """They depend on the company setting, so they are checked after body validation (T-002p)."""
    response = patch(
        client,
        manager_headers,
        harbourside(ds).id,
        {"version": 1, "phone": "abc", "billing_address": {"postcode": "nope"}},
    )
    assert response.status_code == 422
    assert_contract(response, "updateManagerCustomer")
    assert response.json()["errors"] == [
        {
            "loc": ["body", "phone"],
            "message": "Enter a UK phone number such as 07700 900123.",
        },
        {
            "loc": ["body", "billing_address", "postcode"],
            "message": "Enter a UK postcode such as BS6 5QA.",
        },
    ]


def test_a_blank_required_field_is_a_message_not_a_type_error(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    response = patch(client, manager_headers, harbourside(ds).id, {"version": 1, "name": None})
    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["body", "name"], "message": "Enter a name."}]


def test_several_problems_give_one_entry_each(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    response = patch(
        client,
        manager_headers,
        harbourside(ds).id,
        {
            "version": 1,
            "name": "",
            "email": "x",
            "billing_address": {"town": " "},
        },
    )
    assert response.status_code == 422
    assert_contract(response, "updateManagerCustomer")
    errors = {tuple(e["loc"]): e["message"] for e in response.json()["errors"]}
    assert errors == {
        ("body", "name"): "Enter a name.",
        ("body", "email"): "Enter an email address such as name@example.co.uk.",
        ("body", "billing_address", "town"): "Enter a town or city.",
    }


def test_an_old_stored_value_that_fails_todays_rules_never_blocks_an_unrelated_edit(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    cid = harbourside(ds).id
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE customers SET email = 'legacy-address', phone = 'ask for Bob' WHERE id = :i"
            ),
            {"i": cid},
        )
    response = patch(client, manager_headers, cid, {"version": 1, "contact_name": "New Person"})
    assert response.status_code == 200
    assert response.json()["email"] == "legacy-address"
    # sending the bad value back is a validation error: it is a sent key
    assert (
        patch(client, manager_headers, cid, {"version": 2, "email": "legacy-address"}).status_code
        == 422
    )


# ---- scenario 8: forbidden keys and body shape -----------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "id",
        "customer_type",
        "payment_terms_days",
        "notes",
        "job_count",
        "impact",
        "last_changed_at",
        "last_changed_by",
        "created_at",
        "updated_at",
        "billing_line1",
        "billing_postcode",
        "site_address",
        "jobs",
        "reports",
        "painter_notes",
        "manager_notes",
        "checklist",
        "photos",
        "review_status",
        "role",
        "__proto__",
        "constructor",
        "Name",
        "NAME",
        "name ",
        "",
    ],
)
def test_forbidden_keys_are_422_naming_the_key_and_nothing_changes(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    table_data: None,
    key: str,
) -> None:
    cid = harbourside(ds).id
    version = get(client, manager_headers, cid)["version"]
    row, events = customer_row(db_engine, cid), customer_events(db_engine)
    response = patch(
        client, manager_headers, cid, {"version": version, "phone": "0117 000 0000", key: "x"}
    )
    assert response.status_code == 422, response.text
    assert_contract(response, "updateManagerCustomer")
    assert [e["loc"] for e in response.json()["errors"]] == [["body", key]]
    assert customer_row(db_engine, cid) == row
    assert customer_events(db_engine) == events


def test_unknown_keys_inside_billing_address_are_refused(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    cid = harbourside(ds).id
    for key in ("country", "billing_line1", "id", "line3", "Postcode"):
        response = patch(
            client,
            manager_headers,
            cid,
            {"version": 1, "billing_address": {"town": "Bath", key: "x"}},
        )
        assert response.status_code == 422, key
        assert [e["loc"] for e in response.json()["errors"]] == [["body", "billing_address", key]]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"version": 1},
        {"phone": "0117 000 0000"},
        {"version": 1, "billing_address": {}},
        {"version": 1, "billing_address": None},
        {"version": 1, "billing_address": "BS1 4SB"},
        {"version": 1, "billing_address": ["BS1 4SB"]},
        {"version": "1", "phone": "0117 000 0000"},
        {"version": 1.0, "phone": "0117 000 0000"},
        {"version": True, "phone": "0117 000 0000"},
        {"version": 0, "phone": "0117 000 0000"},
        {"version": -1, "phone": "0117 000 0000"},
        {"version": None, "phone": "0117 000 0000"},
        {"version": 1, "name": 123},
        {"version": 1, "name": ["a"]},
        {"version": 1, "name": {"$ne": ""}},
        {"version": 1, "phone": 7700900123},
        {"version": 1, "email": False},
        [],
        [{"version": 1, "name": "x"}],
        "name",
        1,
        None,
    ],
)
def test_malformed_bodies_are_422_and_change_nothing(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    table_data: None,
    body: Any,
) -> None:
    cid = harbourside(ds).id
    row = customer_row(db_engine, cid)
    response = patch(client, manager_headers, cid, body)
    assert response.status_code == 422, response.text
    assert_contract(response, "updateManagerCustomer")
    assert response.json()["code"] == "validation_error"
    assert customer_row(db_engine, cid) == row


def test_unparseable_and_wrongly_typed_requests_are_422(
    client: TestClient, manager_headers: dict[str, str], ds: Any, table_data: None
) -> None:
    url = f"{CBASE}/{harbourside(ds).id}"
    for content, content_type in (
        (b"{not json", "application/json"),
        (b"", "application/json"),
        (b'{"version": 1, "name": "x"}', "text/plain"),
        (b'{"version": 1, "name": "\xff\xfe"}', "application/json"),
        (b'{"version": 99999999999999999999999999, "name": "x"}', "application/json"),
        (b'{"version": 1, "name": "x", "name": "y"}', "application/json"),
    ):
        response = client.patch(
            url, headers={**manager_headers, "content-type": content_type}, content=content
        )
        if content == b'{"version": 1, "name": "x", "name": "y"}':
            assert response.status_code in (200, 409), response.text  # last key wins, as in JSON
            continue
        assert response.status_code in (400, 409, 422), (content, response.text)
        assert response.headers["content-type"].startswith("application/problem+json")
        assert "Traceback" not in response.text


def test_a_huge_body_is_a_clean_422_not_a_crash(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    table_data: None,
) -> None:
    cid = harbourside(ds).id
    row = customer_row(db_engine, cid)
    response = patch(client, manager_headers, cid, {"version": 1, "name": "x" * 2_000_000})
    assert response.status_code == 422
    assert response.json()["errors"][0]["message"] == "Use 120 characters or fewer."
    assert len(response.text) < 2_000  # the offending value is not echoed back
    deep: Any = {"version": 1, "billing_address": {}}
    for _ in range(50):
        deep = {"x": deep}
    assert patch(client, manager_headers, cid, deep).status_code == 422
    assert customer_row(db_engine, cid) == row


def test_hostile_text_is_stored_literally_and_returned_as_data(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    cid = harbourside(ds).id
    payloads = [
        "<img src=x onerror=alert(1)>",
        "'; DROP TABLE customers; --",
        '" OR 1=1 --',
        "${jndi:ldap://x}",
        "{{7*7}}",
        "%s%s%s%n",
        "\\u0000 \\n",
        "../../etc/passwd",
        "Robert'); DROP TABLE students;--",
    ]
    version = 1
    for payload in payloads:
        response = patch(client, manager_headers, cid, {"version": version, "name": payload})
        assert response.status_code == 200, payload
        version += 1
        assert response.json()["name"] == payload
        assert get(client, manager_headers, cid)["name"] == payload
    last = history(client, manager_headers, cid)["items"][0]["changes"][0]
    assert last["new_value"] == payloads[-1]
    assert len(get(client, manager_headers, ds.customers[1].id)["name"]) > 0  # table intact


def test_astral_text_round_trips(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    name = "Café \U0001f3a8 Öl 中文"
    response = patch(client, manager_headers, harbourside(ds).id, {"version": 1, "name": name})
    assert response.status_code == 200 and response.json()["name"] == name


# ---- scenario 9: no-ops ----------------------------------------------------------------------


def test_normalised_and_identical_values_are_no_ops(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    customer = harbourside(ds)
    assert customer.billing_postcode == "BS1 4SB"
    row = customer_row(db_engine, customer.id)
    for body in (
        {"version": 1, "billing_address": {"postcode": "bs14sb"}},
        {"version": 1, "billing_address": {"postcode": " BS1   4SB "}},
        {"version": 1, "name": f"  {customer.name}  "},
        {"version": 1, "name": customer.name, "phone": customer.phone, "email": customer.email},
        {"version": 1, "phone": customer.phone.replace(" ", "  ")},
        {"version": 1, "billing_address": {"line1": customer.billing_line1}},
    ):
        response = patch(client, manager_headers, customer.id, body)
        assert response.status_code == 200, (body, response.text)
        assert_contract(response, "updateManagerCustomer")
        assert response.json()["version"] == 1
        assert response.json()["last_changed_at"] is None
    assert customer_row(db_engine, customer.id) == row
    assert customer_events(db_engine) == 0


def test_a_no_op_after_an_edit_keeps_the_new_version_and_adds_no_event(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, reseed: None
) -> None:
    cid = harbourside(ds).id
    assert (
        patch(
            client,
            manager_headers,
            cid,
            {"version": 1, "email": "a@b.co"},
        ).status_code
        == 200
    )
    response = patch(client, manager_headers, cid, {"version": 2, "email": "a@b.co"})
    assert response.status_code == 200 and response.json()["version"] == 2
    assert customer_events(db_engine, cid) == 1


def test_clearing_an_optional_field_is_a_change_and_clearing_an_empty_one_is_not(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, reseed: None
) -> None:
    customer = next(c for c in ds.customers if c.billing_line2 is None)
    r1 = patch(
        client, manager_headers, customer.id, {"version": 1, "billing_address": {"line2": "  "}}
    )
    assert r1.status_code == 200 and r1.json()["version"] == 1
    r2 = patch(client, manager_headers, customer.id, {"version": 1, "contact_name": None})
    assert r2.status_code == 200 and r2.json()["contact_name"] is None
    assert r2.json()["version"] == (2 if customer.contact_name else 1)


# ---- scenario 10: stale versions -------------------------------------------------------------


def test_a_stale_version_is_409_with_only_the_sent_keys_as_current(
    client: TestClient,
    manager_headers: dict[str, str],
    manager2_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    customer = harbourside(ds)
    assert (
        patch(
            client,
            manager2_headers,
            customer.id,
            {
                "version": 1,
                "phone": "0117 333 3333",
                "billing_address": {"postcode": "BS2 0AA", "town": "Bristol East"},
            },
        ).status_code
        == 200
    )
    row, events = customer_row(db_engine, customer.id), customer_events(db_engine)
    response = patch(
        client,
        manager_headers,
        customer.id,
        {
            "version": 1,
            "phone": "0117 999 9999",
            "email": "mine@example.co.uk",
            "billing_address": {"postcode": "BS3 1AA"},
        },
    )
    assert response.status_code == 409, response.text
    assert_contract(response, "updateManagerCustomer")
    body = response.json()
    assert response.headers["content-type"].startswith("application/problem+json")
    assert body["code"] == "version_conflict"
    assert body["detail"] == "This customer was changed after you loaded it."
    assert body["current_version"] == 2
    assert body["last_changed_by"]["name"] == MANAGER2_NAME
    assert body["last_changed_at"].endswith("Z")
    assert body["current"] == {
        "phone": "0117 333 3333",
        "email": customer.email,
        "billing_address": {"postcode": "BS2 0AA"},
    }
    assert customer_row(db_engine, customer.id) == row
    assert customer_events(db_engine) == events


def test_a_conflict_with_no_address_parts_sent_has_no_address_in_current(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    cid = harbourside(ds).id
    assert (
        patch(client, manager_headers, cid, {"version": 1, "phone": "0117 333 3333"}).status_code
        == 200
    )
    body = patch(client, manager_headers, cid, {"version": 1, "name": "Mine"}).json()
    assert body["current"] == {"name": harbourside(ds).name}


@pytest.mark.parametrize("version", [2, 3, 99, 2**31 - 1, 2**63, 10**30])
def test_a_version_ahead_of_the_stored_one_is_also_409(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None, version: int
) -> None:
    response = patch(
        client, manager_headers, harbourside(ds).id, {"version": version, "phone": "0117 333 3333"}
    )
    assert response.status_code == 409
    assert response.json()["current_version"] == 1


def test_the_version_check_comes_before_the_no_op_check(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    customer = harbourside(ds)
    assert (
        patch(client, manager_headers, customer.id, {"version": 1, "email": "a@b.co"}).status_code
        == 200
    )
    stale_same = patch(client, manager_headers, customer.id, {"version": 1, "name": customer.name})
    assert stale_same.status_code == 409


def test_validation_comes_before_loading_and_not_found_before_conflict(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    customer = harbourside(ds)
    assert (
        patch(client, manager_headers, customer.id, {"version": 1, "email": "a@b.co"}).status_code
        == 200
    )
    assert (
        patch(client, manager_headers, customer.id, {"version": 1, "email": "nope"}).status_code
        == 422
    )
    assert (
        patch(
            client, manager_headers, uuid.uuid4(), {"version": 7, "phone": "0117 333 3333"}
        ).status_code
        == 404
    )


def test_customer_and_report_edits_do_not_conflict_with_each_other(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    customer = harbourside(ds)
    target = next(r for r in awaiting_reports(ds) if r in reports_of(ds, customer.id))
    assert (
        patch(
            client, manager_headers, customer.id, {"version": 1, "phone": "0117 333 3333"}
        ).status_code
        == 200
    )
    # the report is still at version 1 and accepts a version-1 edit
    assert (
        patch_report(
            client, manager_headers, target.id, {"version": 1, "manager_notes": "ok"}
        ).status_code
        == 200
    )
    # and the customer is at 2, not moved by the report edit
    assert get(client, manager_headers, customer.id)["version"] == 2


# ---- scenario 11: ids and not found ----------------------------------------------------------


def test_unknown_customers_are_404_on_all_three_operations(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    unknown = uuid.uuid4()
    for method, url, body in (
        ("GET", f"{CBASE}/{unknown}", None),
        ("PATCH", f"{CBASE}/{unknown}", {"version": 1, "name": "x"}),
        ("GET", f"{CBASE}/{unknown}/history", None),
    ):
        response = send(client, method, url, manager_headers, body)
        assert response.status_code == 404, url
        assert response.json()["code"] == "not_found"
    assert_contract(client.get(f"{CBASE}/{unknown}", headers=manager_headers), "getManagerCustomer")


@pytest.mark.parametrize(
    "bad", ["nope", "123", "00000000-0000-0000-0000-00000000000g", "%27%20OR%201=1", "null"]
)
def test_non_uuid_ids_are_422(
    client: TestClient, manager_headers: dict[str, str], bad: str
) -> None:
    for method, suffix in (("GET", ""), ("PATCH", ""), ("GET", "/history")):
        response = send(
            client,
            method,
            f"{CBASE}/{bad}{suffix}",
            manager_headers,
            {"version": 1, "name": "x"} if method == "PATCH" else None,
        )
        assert response.status_code == 422, (method, suffix)
        assert_contract(
            response,
            {"GET": "getManagerCustomer", "PATCH": "updateManagerCustomer"}[method]
            if suffix == ""
            else "listManagerCustomerHistory",
        )


def test_authorisation_wins_over_validation_and_lookup(
    client: TestClient,
    admin_headers: dict[str, str],
    painter_headers: dict[str, str],
    ds: Any,
    reseed: None,
) -> None:
    cid = harbourside(ds).id
    for headers, status in (({}, 401), (admin_headers, 403), (painter_headers, 403)):
        for url in (f"{CBASE}/nope", f"{CBASE}/{uuid.uuid4()}", f"{CBASE}/{cid}"):
            assert send(client, "PATCH", url, headers, {"bogus": 1}).status_code == status
            assert client.get(url, headers=headers).status_code == status
            assert client.get(f"{url}/history", headers=headers).status_code == status
    assert client.get(f"{RBASE}?customer_id=nope", headers=admin_headers).status_code == 403


def test_admin_and_painter_cannot_change_a_customer(
    client: TestClient,
    admin_headers: dict[str, str],
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
) -> None:
    cid = harbourside(ds).id
    row = customer_row(db_engine, cid)
    for headers in (admin_headers, painter_headers, {}):
        response = patch(client, headers, cid, {"version": 1, "name": "Hacked"})
        assert response.status_code in (401, 403)
    assert customer_row(db_engine, cid) == row
    assert get(client, manager_headers, cid)["name"] == harbourside(ds).name


def test_methods_other_than_get_and_patch_are_not_allowed(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    url = f"{CBASE}/{harbourside(ds).id}"
    for method in ("POST", "PUT", "DELETE"):
        assert client.request(method, url, headers=manager_headers).status_code == 405
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert client.request(method, f"{url}/history", headers=manager_headers).status_code == 405


# ---- scenario 12: atomic ---------------------------------------------------------------------


def test_one_invalid_field_saves_nothing(
    client: TestClient, manager_headers: dict[str, str], db_engine: Engine, ds: Any, reseed: None
) -> None:
    cid = harbourside(ds).id
    row = customer_row(db_engine, cid)
    response = patch(
        client,
        manager_headers,
        cid,
        {"version": 1, "name": "Valid New Name", "billing_address": {"postcode": "NOT A POSTCODE"}},
    )
    assert response.status_code == 422
    assert customer_row(db_engine, cid) == row
    assert customer_events(db_engine) == 0
    assert get(client, manager_headers, cid)["version"] == 1


def test_a_database_failure_rolls_back_the_customer_and_the_event(
    client: TestClient,
    manager_headers: dict[str, str],
    db_engine: Engine,
    ds: Any,
    reseed: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import customers

    cid = harbourside(ds).id
    row = customer_row(db_engine, cid)

    def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("event store down")

    monkeypatch.setattr(customers, "record_event", boom)
    with TestClient(client.app, raise_server_exceptions=False) as quiet:
        response = patch(quiet, manager_headers, cid, {"version": 1, "name": "Half Saved"})
    assert response.status_code == 500
    assert "event store down" not in response.text and "Traceback" not in response.text
    assert customer_row(db_engine, cid) == row
    assert customer_events(db_engine) == 0


def test_the_response_never_leaks_internal_fields(
    client: TestClient, manager_headers: dict[str, str], ds: Any, reseed: None
) -> None:
    response = patch(client, manager_headers, harbourside(ds).id, {"version": 1, "email": "a@b.co"})
    text_body = json.dumps(response.json())
    for leaked in ("payment_terms_days", "notes", "created_at", "updated_at", "last_changed_by_id"):
        assert leaked not in text_body
