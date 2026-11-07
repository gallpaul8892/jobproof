"""T-001c scenario 7: report detail, signed photo URLs, and the photo image endpoint."""

import uuid
from collections import defaultdict
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.models.enums import InvoiceState, PaymentKind
from app.photos.signing import sign
from app.services.billing import BillingStatus, InvoiceStatus
from tests.conftest import ANCHOR, FIXED_NOW
from tests.contract import assert_contract
from tests.expected import (
    deposit_paid_by_quote,
    expected_reports,
    invoice_statuses_at,
    parse_ts,
)

STAGES = {"before": 0, "during": 1, "after": 2}


def detail(client: TestClient, headers: dict[str, str], report_id: Any) -> Any:
    response = client.get(f"/api/v1/manager/reports/{report_id}", headers=headers)
    assert_contract(response, "getManagerReport")
    return response


def local_path(url: str) -> str:
    """Photo URLs are absolute; the test client wants the path and query only."""
    parsed = urlparse(url)
    assert f"{parsed.scheme}://{parsed.netloc}" == get_settings().public_api_base_url
    return f"{parsed.path}?{parsed.query}"


@pytest.fixture(scope="module")
def by_reference(ds: Any) -> dict[str, Any]:
    return {e.job.reference: e for e in expected_reports(ds, ANCHOR)}


def test_every_report_detail_matches_the_contract(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    for report in ds.reports:
        assert detail(client, manager_headers, report.id).status_code == 200


def test_detail_of_a_report_with_deposit_quote_and_invoice(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    paid_deposits = deposit_paid_by_quote(ds)
    statuses = invoice_statuses_at(ds, ANCHOR)
    quotes = {q.job_id: q for q in ds.quotes}
    invoices = {i.job_id: i for i in ds.invoices if i.state is not InvoiceState.void}
    reports = {r.job_id: r for r in ds.reports}
    candidates = [
        (job_id, q)
        for job_id, q in quotes.items()
        if paid_deposits[q.id] > 0 and job_id in invoices and job_id in reports
    ]
    assert candidates
    job_id, quote = candidates[0]
    invoice = invoices[job_id]
    report = reports[job_id]
    response = detail(client, manager_headers, report.id)
    assert response.status_code == 200
    body = response.json()

    assert body["id"] == str(report.id)
    assert body["review_status"] == report.review_status.value
    assert body["painter_notes"] == report.painter_notes
    assert parse_ts(body["submitted_at"]) == report.submitted_at
    assert parse_ts(body["reviewed_at"]) == report.reviewed_at
    reviewer = next(u for u in ds.users if u.id == report.reviewed_by_id)
    assert body["reviewed_by"] == {"id": str(reviewer.id), "name": "Sarah Whitfield"}

    assert body["quote"] == {
        "id": str(quote.id),
        "reference": quote.reference,
        "status": quote.status.value,
        "total_pence": quote.total_pence,
        "deposit_pence": quote.deposit_pence,
        "deposit_paid_pence": paid_deposits[quote.id],
        "currency": "GBP",
        "issued_on": quote.issued_on.isoformat(),
        "accepted_on": quote.accepted_on.isoformat() if quote.accepted_on else None,
    }
    paid = sum(p.amount_pence for p in ds.payments if p.invoice_id == invoice.id)
    assert body["invoice"] == {
        "id": str(invoice.id),
        "number": invoice.number,
        "status": statuses[invoice.id].value,
        "subtotal_pence": invoice.subtotal_pence,
        "vat_pence": invoice.vat_pence,
        "deposit_applied_pence": invoice.deposit_applied_pence,
        "total_pence": invoice.total_pence,
        "paid_pence": paid,
        "balance_pence": max(invoice.total_pence - paid, 0),
        "currency": "GBP",
        "issue_date": invoice.issue_date.isoformat() if invoice.issue_date else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
    }
    assert body["invoice"]["deposit_applied_pence"] == paid_deposits[quote.id]
    assert (
        body["invoice"]["total_pence"]
        == body["invoice"]["subtotal_pence"]
        + body["invoice"]["vat_pence"]
        - body["invoice"]["deposit_applied_pence"]
    )

    want_payments = sorted(
        (p for p in ds.payments if p.invoice_id == invoice.id or p.quote_id == quote.id),
        key=lambda p: (p.received_at, p.id),
    )
    assert [p["id"] for p in body["payments"]] == [str(p.id) for p in want_payments]
    assert {p["kind"] for p in body["payments"]} >= {"deposit"}
    received = [parse_ts(p["received_at"]) for p in body["payments"]]
    assert received == sorted(received)
    assert all(p["currency"] == "GBP" for p in body["payments"])
    assert body["billing_status"] == statuses[invoice.id].value


def test_detail_core_sections(
    client: TestClient, manager_headers: dict[str, str], ds: Any, by_reference: dict[str, Any]
) -> None:
    want = by_reference["JP-1042"]
    body = detail(client, manager_headers, want.report.id).json()
    job, customer = want.job, want.customer
    assert body["job"] == {
        "id": str(job.id),
        "reference": job.reference,
        "job_type": job.job_type.value,
        "title": job.title,
        "status": "completed",
        "site_address": {
            "line1": job.site_line1,
            "line2": job.site_line2,
            "town": job.site_town,
            "county": job.site_county,
            "postcode": job.site_postcode,
        },
        "notes": job.notes,
        "scheduled_start": job.scheduled_start.isoformat(),
        "completed_on": job.completed_on.isoformat(),
    }
    assert body["customer"] == {
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
        "job_count": sum(j.customer_id == customer.id for j in ds.jobs),
    }
    assert body["painter"] == {"id": str(want.painter.id), "name": want.painter.full_name}
    assert body["billing_status"] == want.billing.value


def test_customer_job_count_for_the_multi_job_customer(
    client: TestClient, manager_headers: dict[str, str], by_reference: dict[str, Any]
) -> None:
    harbourside = next(
        e for e in by_reference.values() if e.customer.name.startswith("Harbourside")
    )
    body = detail(client, manager_headers, harbourside.report.id).json()
    assert body["customer"]["job_count"] == 12


def test_checklist_is_in_position_order(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    items_by_report: dict[Any, list[Any]] = defaultdict(list)
    for item in ds.checklist_items:
        items_by_report[item.report_id].append(item)
    snagging = 0
    for report in ds.reports[:20]:
        want = sorted(items_by_report[report.id], key=lambda i: i.position)
        got = detail(client, manager_headers, report.id).json()["checklist"]
        assert [(c["id"], c["label"], c["done"], c["note"]) for c in got] == [
            (str(i.id), i.label, i.done, i.note) for i in want
        ]
        assert 5 <= len(got) <= 8
        snagging += sum(not c["done"] for c in got)
    assert snagging > 0


def test_photos_are_ordered_before_during_after_then_taken_at(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    photos_by_report: dict[Any, list[Any]] = defaultdict(list)
    for photo in ds.photos:
        photos_by_report[photo.report_id].append(photo)
    checked = 0
    for report in ds.reports:
        want = sorted(
            photos_by_report[report.id],
            key=lambda p: (STAGES[p.stage.value], p.taken_at, p.position, p.id),
        )
        body = detail(client, manager_headers, report.id).json()
        assert [p["id"] for p in body["photos"]] == [str(p.id) for p in want], report.id
        checked += len(want)
        for got, row in zip(body["photos"], want, strict=True):
            assert got["stage"] == row.stage.value
            assert got["caption"] == row.caption
            assert parse_ts(got["taken_at"]) == row.taken_at
            assert (got["width"], got["height"]) == (row.width, row.height)
            assert got["url"] != got["thumb_url"]
    assert checked == len(ds.photos)


def test_no_photo_report_has_an_empty_list(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    with_photos = {p.report_id for p in ds.photos}
    empty = [r for r in ds.reports if r.id not in with_photos]
    assert len(empty) == 1
    body = detail(client, manager_headers, empty[0].id).json()
    assert body["photos"] == []
    assert body["checklist"]
    assert body["painter_notes"]
    everything = client.get(
        "/api/v1/manager/reports", headers=manager_headers, params={"page_size": 100}
    ).json()["items"]
    assert next(i for i in everything if i["id"] == str(empty[0].id))["photo_count"] == 0


def test_long_address_and_notes_are_returned_unchanged(
    client: TestClient, manager_headers: dict[str, str], ds: Any, by_reference: dict[str, Any]
) -> None:
    long_job = max(ds.jobs, key=lambda j: len(j.notes or ""))
    assert len(long_job.notes or "") > 1000
    report = next(r for r in ds.reports if r.job_id == long_job.id)
    assert len(report.painter_notes or "") > 600
    body = detail(client, manager_headers, report.id).json()
    assert body["job"]["notes"] == long_job.notes
    assert body["painter_notes"] == report.painter_notes
    assert body["job"]["site_address"] == {
        "line1": "Flat 14, The Old Chapel Apartments, 112-118 St Michael's Hill Road",
        "line2": "Kingsdown Conservation Area (rear entrance via Montague Place)",
        "town": "Bristol",
        "county": "City of Bristol",
        "postcode": "BS2 8DT",
    }


def test_billing_states_not_invoiced_void_and_part_paid(
    client: TestClient, manager_headers: dict[str, str], ds: Any, by_reference: dict[str, Any]
) -> None:
    seen: set[BillingStatus] = set()
    for expected in by_reference.values():
        body = detail(client, manager_headers, expected.report.id).json()
        assert body["billing_status"] == expected.billing.value
        seen.add(BillingStatus(body["billing_status"]))
        if expected.billing is BillingStatus.not_invoiced:
            assert body["invoice"] is None
            assert [p for p in body["payments"] if p["kind"] == "invoice"] == []
        elif expected.billing is BillingStatus.void:
            assert body["invoice"]["status"] == "void"
            assert body["invoice"]["paid_pence"] == 0
        elif expected.billing is BillingStatus.part_paid:
            invoice = body["invoice"]
            assert 0 < invoice["paid_pence"] < invoice["total_pence"]
            assert invoice["balance_pence"] == invoice["total_pence"] - invoice["paid_pence"]
        elif expected.billing is BillingStatus.draft:
            assert body["invoice"]["issue_date"] is None and body["invoice"]["due_date"] is None
            assert body["invoice"]["status"] == InvoiceStatus.draft.value
    assert seen == set(BillingStatus)


def test_unquoted_job_has_no_quote(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    quoted = {q.job_id for q in ds.quotes}
    report = next(r for r in ds.reports if r.job_id not in quoted)
    assert detail(client, manager_headers, report.id).json()["quote"] is None


def test_unknown_report_is_404_and_bad_id_is_422(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    missing = detail(client, manager_headers, uuid.uuid4())
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"
    assert missing.headers["content-type"].startswith("application/problem+json")
    for bad in ("not-a-uuid", "123", "JP-1042"):
        response = detail(client, manager_headers, bad)
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
        assert response.json()["errors"][0]["loc"] == ["path", "report_id"]


# ---- signed photo URLs -------------------------------------------------------------------------


def first_photo(client: TestClient, headers: dict[str, str], ds: Any) -> dict[str, Any]:
    with_photos = {p.report_id for p in ds.photos}
    report = next(r for r in ds.reports if r.id in with_photos)
    photo: dict[str, Any] = detail(client, headers, report.id).json()["photos"][0]
    return photo


def test_signed_urls_serve_svg_without_any_auth_header(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    photo = first_photo(client, manager_headers, ds)
    for key, variant in (("thumb_url", "thumb"), ("url", "full")):
        url = photo[key]
        query = parse_qs(urlparse(url).query)
        assert query["variant"] == [variant]
        assert len(query["sig"][0]) == 64
        response = client.get(local_path(url))  # no Authorization header
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/svg+xml"
        assert response.headers["cache-control"] == "private, max-age=300"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "default-src 'none'" in response.headers["content-security-policy"]
        assert_contract(response, "getPhotoImage")
        assert response.content.startswith(b"<svg")
        assert photo["caption"].replace("&", "&amp;").encode() in response.content
        assert len(response.content) < 6 * 1024
    thumb = client.get(local_path(photo["thumb_url"])).content
    full = client.get(local_path(photo["url"])).content
    assert thumb != full  # different width/height attributes


def test_every_photo_url_in_the_seed_loads(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    loaded = 0
    for report in ds.reports[:12]:
        for photo in detail(client, manager_headers, report.id).json()["photos"]:
            for key in ("thumb_url", "url"):
                response = client.get(local_path(photo[key]))
                assert response.status_code == 200, photo["id"]
                loaded += 1
    assert loaded > 50


def tamper(url: str, **changes: str) -> str:
    parsed = urlparse(url)
    query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    query.update(changes)
    from urllib.parse import urlencode

    return f"{parsed.path}?{urlencode(query)}"


def test_one_changed_character_in_the_signature_is_refused(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    photo = first_photo(client, manager_headers, ds)
    sig = parse_qs(urlparse(photo["url"]).query)["sig"][0]
    for index in (0, 31, 63):
        replacement = "0" if sig[index] != "0" else "1"
        bad = sig[:index] + replacement + sig[index + 1 :]
        response = client.get(tamper(photo["url"], sig=bad))
        assert response.status_code == 403
        assert response.json()["code"] == "invalid_signature"
        assert response.headers["content-type"].startswith("application/problem+json")
        assert_contract(response, "getPhotoImage")
        assert bad not in response.text and sig not in response.text


@pytest.mark.parametrize(
    "bad_sig", ["", "0" * 64, "z" * 64, "abc", "É" * 64, sign("k" * 40, "x", "full", 1)]
)
def test_malformed_or_foreign_signatures_are_403(
    client: TestClient, manager_headers: dict[str, str], ds: Any, bad_sig: str
) -> None:
    photo = first_photo(client, manager_headers, ds)
    response = client.get(tamper(photo["url"], sig=bad_sig))
    assert response.status_code == 403
    assert response.json()["code"] == "invalid_signature"


def test_expired_url_is_refused_even_with_a_correct_signature(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    photo = first_photo(client, manager_headers, ds)
    secret = get_settings().photo_url_secret
    now_ts = int(FIXED_NOW.timestamp())
    # Same signature, exp moved into the past: signature no longer matches.
    moved = client.get(tamper(photo["url"], exp=str(now_ts - 60)))
    assert moved.status_code == 403 and moved.json()["code"] == "invalid_signature"
    # Correctly signed for a past exp: refused because it has expired.
    expired = client.get(
        tamper(photo["url"], exp=str(now_ts - 1), sig=sign(secret, photo["id"], "full", now_ts - 1))
    )
    assert expired.status_code == 403 and expired.json()["code"] == "invalid_signature"
    still_valid = client.get(
        tamper(photo["url"], exp=str(now_ts), sig=sign(secret, photo["id"], "full", now_ts))
    )
    assert still_valid.status_code == 200
    assert_contract(expired, "getPhotoImage")


def test_signature_is_bound_to_photo_and_variant(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    photo = first_photo(client, manager_headers, ds)
    other = next(
        p
        for r in ds.reports
        for p in detail(client, manager_headers, r.id).json()["photos"]
        if p["id"] != photo["id"]
    )
    assert client.get(tamper(photo["thumb_url"], variant="full")).status_code == 403
    swapped = photo["url"].replace(photo["id"], other["id"])
    assert client.get(local_path(swapped)).status_code == 403


def test_photo_endpoint_parameter_errors_are_422(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    photo = first_photo(client, manager_headers, ds)
    base = local_path(photo["url"])
    cases = [
        tamper(photo["url"], variant="huge"),
        tamper(photo["url"], exp="soon"),
        base.replace(photo["id"], "not-a-uuid"),
        f"/api/v1/photos/{photo['id']}/image",
        f"/api/v1/photos/{photo['id']}/image?variant=full&exp=1",
    ]
    for url in cases:
        response = client.get(url)
        assert response.status_code == 422, url
        assert response.json()["code"] == "validation_error"
        assert_contract(response, "getPhotoImage")


def test_unknown_photo_with_a_valid_signature_is_404(client: TestClient) -> None:
    photo_id = uuid.uuid4()
    exp = int(FIXED_NOW.timestamp()) + 600
    sig = sign(get_settings().photo_url_secret, photo_id, "thumb", exp)
    response = client.get(f"/api/v1/photos/{photo_id}/image?variant=thumb&exp={exp}&sig={sig}")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert_contract(response, "getPhotoImage")
    # ...but without a valid signature nobody can tell whether the photo exists.
    unsigned = client.get(f"/api/v1/photos/{photo_id}/image?variant=thumb&exp={exp}&sig={'0' * 64}")
    assert unsigned.status_code == 403


def test_payment_kinds_in_detail_match_their_targets(
    client: TestClient, manager_headers: dict[str, str], ds: Any
) -> None:
    kinds = {p.id: p.kind for p in ds.payments}
    for report in ds.reports:
        for payment in detail(client, manager_headers, report.id).json()["payments"]:
            assert kinds[uuid.UUID(payment["id"])] is PaymentKind(payment["kind"])
