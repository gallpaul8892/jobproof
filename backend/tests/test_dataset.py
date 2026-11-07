"""Scenarios 3 to 6 against `build_dataset` (pure Python, no database)."""

import os
from collections import Counter
from datetime import date

import pytest

from app.models.enums import (
    CustomerType,
    InvoiceState,
    JobType,
    PaymentKind,
    PhotoStage,
    ReviewStatus,
)
from app.seed import DEMO_ACCOUNTS
from app.seed.dataset import Dataset, build_dataset, month_start
from app.services.billing import InvoiceStatus, billing_status
from tests.dataset_checks import check_consistency, invoice_statuses, paid_by_invoice

ANCHOR = date.fromisoformat(os.environ["SEED_ANCHOR_DATE"])
ANCHORS = [ANCHOR, date(2026, 11, 1), date(2027, 3, 31)]


@pytest.fixture(scope="module")
def ds() -> Dataset:
    return build_dataset(ANCHOR)


def test_build_dataset_is_deterministic(ds: Dataset) -> None:
    assert build_dataset(ANCHOR) == ds


def test_different_anchors_give_different_dates(ds: Dataset) -> None:
    assert build_dataset(date(2026, 11, 1)) != ds


def test_users_and_customers(ds: Dataset) -> None:
    roles = Counter(u.role.value for u in ds.users)
    assert roles == {"manager": 1, "painter": 6}
    with_hash = {u.email for u in ds.users if u.password_hash}
    assert with_hash == {"manager@jobproof.test", "painter@jobproof.test"}
    for user in ds.users:
        assert user.email == user.email.lower()
        if user.password_hash:
            assert user.password_hash.startswith("$argon2id$")
    assert {a["email"] for a in DEMO_ACCOUNTS} == with_hash
    types = Counter(c.customer_type for c in ds.customers)
    assert types == {CustomerType.homeowner: 8, CustomerType.landlord: 2, CustomerType.business: 2}
    for customer in ds.customers:
        expected = 14 if customer.customer_type is CustomerType.homeowner else 30
        assert customer.payment_terms_days == expected
        assert customer.phone is not None and customer.phone.startswith("07700 900")
        assert customer.email is not None and customer.email.endswith("@example.co.uk")


def test_job_volumes_and_mix(ds: Dataset) -> None:
    assert len(ds.jobs) == 60 and len(ds.reports) == 60
    by_type = Counter(j.job_type for j in ds.jobs)
    assert by_type == {
        JobType.interior_repaint: 18,
        JobType.exterior_repaint: 10,
        JobType.wallpapering: 9,
        JobType.kitchen_cabinet_spray: 8,
        JobType.staircase_woodwork: 9,
        JobType.commercial_unit: 6,
    }
    customers = {c.id: c for c in ds.customers}
    per_customer = Counter(customers[j.customer_id].name for j in ds.jobs)
    assert sorted(per_customer.values(), reverse=True) == [12, 8, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2]
    assert per_customer["Harbourside Lettings Ltd"] == 12
    for job in ds.jobs:
        if job.job_type is JobType.commercial_unit:
            assert customers[job.customer_id].customer_type is CustomerType.business
    months = Counter(
        (ANCHOR.year * 12 + ANCHOR.month) - (j.completed_on.year * 12 + j.completed_on.month)  # type: ignore[union-attr]
        for j in ds.jobs
    )
    assert [months[i] for i in range(6)] == [8, 11, 11, 10, 10, 10]
    painters = Counter(j.painter_id for j in ds.jobs)
    assert len(painters) == 6 and all(7 <= n <= 13 for n in painters.values())
    dan = next(u for u in ds.users if u.email == "painter@jobproof.test")
    assert painters[dan.id] == 10
    assert [j.reference for j in sorted(ds.jobs, key=lambda j: j.scheduled_start)] == [
        f"JP-{n}" for n in range(1001, 1061)
    ]


def test_reports_checklists_and_photos(ds: Dataset) -> None:
    awaiting = [r for r in ds.reports if r.review_status is ReviewStatus.awaiting_review]
    assert len(awaiting) == 9
    items = Counter(i.report_id for i in ds.checklist_items)
    assert all(5 <= items[r.id] <= 8 for r in ds.reports)
    photos = Counter(p.report_id for p in ds.photos)
    empty = [r for r in ds.reports if photos[r.id] == 0]
    assert len(empty) == 1
    assert all(4 <= photos[r.id] <= 10 for r in ds.reports if r.id != empty[0].id)
    assert 380 <= len(ds.photos) <= 460
    snagged = {i.report_id for i in ds.checklist_items if not i.done}
    assert len(snagged) == 12
    for photo in ds.photos:
        assert photo.storage_key is None
        assert photo.width * photo.height == 1600 * 1200
    stage_counts: dict[object, Counter[PhotoStage]] = {}
    for photo in ds.photos:
        stage_counts.setdefault(photo.report_id, Counter())[photo.stage] += 1
    for counts in stage_counts.values():
        assert 1 <= counts[PhotoStage.before] <= 3
        assert 1 <= counts[PhotoStage.during] <= 3
        assert 2 <= counts[PhotoStage.after] <= 4
    jobs = {j.id: j for j in ds.jobs}
    portrait = {p.report_id for p in ds.photos if p.height > p.width}
    for report in ds.reports:
        is_stairs = jobs[report.job_id].job_type is JobType.staircase_woodwork
        assert (report.id in portrait) == (is_stairs and photos[report.id] > 0)


def test_quotes_and_payments(ds: Dataset) -> None:
    assert len(ds.quotes) == 24
    assert sum(1 for q in ds.quotes if q.deposit_pence) == 14
    deposits = [p for p in ds.payments if p.kind is PaymentKind.deposit]
    assert len(deposits) == 14
    assert {p.quote_id for p in deposits} == {q.id for q in ds.quotes if q.deposit_pence}
    quotes = {q.id: q for q in ds.quotes}
    for payment in deposits:
        assert payment.amount_pence == quotes[payment.quote_id].deposit_pence  # type: ignore[index]
    extras = 0
    quote_by_job = {q.job_id: q for q in ds.quotes}
    for inv in ds.invoices:
        quote = quote_by_job.get(inv.job_id)
        if quote and inv.subtotal_pence > quote.subtotal_pence:
            extras += 1
            assert 12000 <= inv.subtotal_pence - quote.subtotal_pence <= 48000
    assert extras == 3
    for inv in ds.invoices:
        quote = quote_by_job.get(inv.job_id)
        assert inv.deposit_applied_pence == (quote.deposit_pence if quote else 0)
    methods = Counter(p.method.value for p in ds.payments)
    assert methods["bank_transfer"] > methods["card"] > methods["cash"] >= 0


def test_invoice_status_distribution(ds: Dataset) -> None:
    statuses = Counter(invoice_statuses(ds, ANCHOR).values())
    assert statuses == {
        InvoiceStatus.draft: 6,
        InvoiceStatus.sent: 7,
        InvoiceStatus.part_paid: 2,
        InvoiceStatus.overdue: 6,
        InvoiceStatus.paid: 30,
        InvoiceStatus.void: 1,
    }
    assert len(ds.jobs) - len(ds.invoices) == 8
    awaiting_ids = {r.job_id for r in ds.reports if r.review_status is ReviewStatus.awaiting_review}
    invoiced = {i.job_id for i in ds.invoices}
    assert len(awaiting_ids - invoiced) == 7
    assert len({j.id for j in ds.jobs} - invoiced - awaiting_ids) == 1
    drafts = [i for i in ds.invoices if i.state is InvoiceState.draft]
    assert sum(1 for i in drafts if i.job_id in awaiting_ids) == 2
    assert Counter(i.job_id for i in ds.invoices).most_common(1)[0][1] == 1


@pytest.mark.parametrize("anchor", ANCHORS)
def test_dataset_is_internally_consistent(anchor: date) -> None:
    built = build_dataset(anchor)
    check_consistency(built)
    statuses = Counter(invoice_statuses(built, anchor).values())
    assert statuses[InvoiceStatus.paid] == 30 and statuses[InvoiceStatus.overdue] == 6
    assert sum(1 for r in built.reports if r.review_status is ReviewStatus.awaiting_review) == 9
    m0 = month_start(anchor, 0)
    if anchor.day >= 10:
        assert sum(1 for i in built.invoices if i.issue_date and i.issue_date >= m0) >= 3


def test_every_day_of_a_month_builds() -> None:
    """The distribution must hold whatever day the seed runs on (default anchor is today)."""
    for day in range(1, 32):
        anchor = date(2026, 8, day)
        built = build_dataset(anchor)
        check_consistency(built)
        statuses = Counter(invoice_statuses(built, anchor).values())
        assert statuses[InvoiceStatus.sent] == 7 and statuses[InvoiceStatus.part_paid] == 2


def test_edge_cases(ds: Dataset) -> None:
    customers = {c.id: c for c in ds.customers}
    reports = {r.job_id: r for r in ds.reports}
    photos = Counter(p.report_id for p in ds.photos)
    # one awaiting-review report with zero photos, an interior repaint completed this month
    m0 = month_start(ANCHOR, 0)
    no_photo = [j for j in ds.jobs if photos[reports[j.id].id] == 0]
    assert len(no_photo) == 1
    job = no_photo[0]
    assert job.job_type is JobType.interior_repaint and job.completed_on is not None
    assert job.completed_on >= m0
    assert reports[job.id].review_status is ReviewStatus.awaiting_review
    assert len([c for c in ds.checklist_items if c.report_id == reports[job.id].id]) >= 5

    # the long Harbourside job
    long_jobs = [j for j in ds.jobs if (j.notes and len(j.notes) >= 1000)]
    assert len(long_jobs) == 1
    long_job = long_jobs[0]
    assert customers[long_job.customer_id].name == "Harbourside Lettings Ltd"
    assert (
        long_job.site_line1 == "Flat 14, The Old Chapel Apartments, 112-118 St Michael's Hill Road"
    )
    assert long_job.site_line2 == "Kingsdown Conservation Area (rear entrance via Montague Place)"
    assert (long_job.site_town, long_job.site_county, long_job.site_postcode) == (
        "Bristol",
        "City of Bristol",
        "BS2 8DT",
    )
    assert 1100 <= len(long_job.notes or "") <= 1300
    assert 700 <= len(reports[long_job.id].painter_notes or "") <= 900
    assert sum(1 for r in ds.reports if r.painter_notes is None) == 5

    # three part-paid invoices, one overdue
    statuses = invoice_statuses(ds, ANCHOR)
    paid = paid_by_invoice(ds)
    part = [
        i for i in ds.invoices if 0 < paid[i.id] < i.total_pence and i.state is InvoiceState.issued
    ]
    assert len(part) == 3
    assert Counter(statuses[i.id] for i in part) == {
        InvoiceStatus.part_paid: 2,
        InvoiceStatus.overdue: 1,
    }

    # Harbourside Lettings spans most statuses
    harbourside = [
        j for j in ds.jobs if customers[j.customer_id].name == "Harbourside Lettings Ltd"
    ]
    assert len(harbourside) == 12
    invoices = {i.job_id: i for i in ds.invoices}
    seen = {
        str(statuses[invoices[j.id].id]) if j.id in invoices else "not_invoiced"
        for j in harbourside
    }
    assert len(seen) >= 6, seen
    assert len({j.site_line1 for j in harbourside}) == 12

    # a reviewed job whose only invoice is void
    void = [i for i in ds.invoices if i.state is InvoiceState.void]
    assert len(void) == 1
    void_job = void[0].job_id
    assert reports[void_job].review_status is ReviewStatus.reviewed
    assert [i for i in ds.invoices if i.job_id == void_job] == void
    assert billing_status([(void[0].state, statuses[void[0].id])]).value == "void"


def test_addresses_look_like_bristol_and_bath(ds: Dataset) -> None:
    import re

    pattern = re.compile(r"^(BS([1-9]|1[0-6])|BA[1-3]) [0-9][A-Z]{2}$")
    for job in ds.jobs:
        assert pattern.match(job.site_postcode), job.site_postcode
        assert job.site_town in {"Bristol", "Bath"}
        assert job.site_county in {"City of Bristol", "Bath and North East Somerset"}
    for customer in ds.customers:
        assert pattern.match(customer.billing_postcode), customer.billing_postcode
