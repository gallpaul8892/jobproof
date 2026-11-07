"""Deterministic mock dataset: `build_dataset(anchor)` is a pure function.

All randomness comes from `random.Random(SEED)` and every date is relative to `anchor` (the
seed's "today"), so the same anchor always yields the same dataset and "this month" always has
data. The design below is what makes the specified invoice mix hold for any anchor date:

* Jobs are first laid out as *slots* (a completion date plus a billing category), then customers
  and job types are matched to slots, so recent slots can be given 30-day-terms customers.
* The nine "in terms" invoices (7 sent, 2 part paid) are the two oldest reviewed jobs of the
  current month plus seven jobs finished in the last five working days of the previous month;
  a per-job search over review and issue delays picks dates that keep due dates on the right
  side of the anchor. If no delays work the build fails loudly rather than seeding a
  wrong mix.
"""

import dataclasses
import hashlib
import random
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from functools import cache
from zoneinfo import ZoneInfo

from argon2 import PasswordHasher

from app.models.enums import (
    CustomerType,
    InvoiceState,
    JobStatus,
    JobType,
    PaymentKind,
    PaymentMethod,
    PhotoStage,
    QuoteStatus,
    ReviewStatus,
    UserRole,
)
from app.seed import catalogue as cat
from app.services.billing import InvoiceStatus, invoice_status

SEED = 20261107
NAMESPACE = uuid.UUID("5d0a1f3e-7b6c-4e0a-9a53-2f1c8d6b4a10")
LONDON = ZoneInfo("Europe/London")
VAT_PERCENT = 20
MONTH_COUNTS = (8, 11, 11, 10, 10, 10)
AWAITING_REVIEW_TOTAL = 9
EXPECTED_STATUS_COUNTS = {
    InvoiceStatus.draft: 6,
    InvoiceStatus.sent: 7,
    InvoiceStatus.part_paid: 2,
    InvoiceStatus.overdue: 6,
    InvoiceStatus.paid: 30,
    InvoiceStatus.void: 1,
}
TYPE_COUNTS = {
    JobType.interior_repaint: 18,
    JobType.exterior_repaint: 10,
    JobType.wallpapering: 9,
    JobType.kitchen_cabinet_spray: 8,
    JobType.staircase_woodwork: 9,
    JobType.commercial_unit: 6,
}
PRICE_RANGE_POUNDS = {
    JobType.interior_repaint: (650, 3200),
    JobType.exterior_repaint: (1800, 6500),
    JobType.wallpapering: (350, 1600),
    JobType.kitchen_cabinet_spray: (1200, 2800),
    JobType.staircase_woodwork: (450, 1400),
    JobType.commercial_unit: (3500, 12000),
}
DURATION_WORKING_DAYS = {
    JobType.interior_repaint: (2, 6),
    JobType.exterior_repaint: (4, 10),
    JobType.wallpapering: (1, 4),
    JobType.kitchen_cabinet_spray: (3, 6),
    JobType.staircase_woodwork: (2, 5),
    JobType.commercial_unit: (3, 10),
}


class DatasetError(RuntimeError):
    """The generator could not satisfy the specified distribution."""


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise DatasetError(message)


# --------------------------------------------------------------------------------------------
# Row types (mirror the tables; plain frozen dataclasses so datasets compare with ==)
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class UserRow:
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    phone: str | None
    password_hash: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CustomerRow:
    id: uuid.UUID
    customer_type: CustomerType
    name: str
    contact_name: str | None
    email: str | None
    phone: str | None
    billing_line1: str
    billing_line2: str | None
    billing_town: str
    billing_county: str | None
    billing_postcode: str
    payment_terms_days: int
    notes: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class JobRow:
    id: uuid.UUID
    reference: str
    customer_id: uuid.UUID
    painter_id: uuid.UUID | None
    job_type: JobType
    title: str
    status: JobStatus
    site_line1: str
    site_line2: str | None
    site_town: str
    site_county: str | None
    site_postcode: str
    notes: str | None
    scheduled_start: date
    completed_on: date | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class QuoteRow:
    id: uuid.UUID
    job_id: uuid.UUID
    reference: str
    status: QuoteStatus
    subtotal_pence: int
    vat_pence: int
    total_pence: int
    deposit_pence: int
    currency: str
    issued_on: date
    valid_until: date
    accepted_on: date | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ReportRow:
    id: uuid.UUID
    job_id: uuid.UUID
    painter_id: uuid.UUID
    submitted_at: datetime
    painter_notes: str | None
    review_status: ReviewStatus
    reviewed_at: datetime | None
    reviewed_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ChecklistItemRow:
    id: uuid.UUID
    report_id: uuid.UUID
    position: int
    label: str
    done: bool
    note: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class PhotoRow:
    id: uuid.UUID
    report_id: uuid.UUID
    stage: PhotoStage
    position: int
    caption: str
    taken_at: datetime
    width: int
    height: int
    storage_key: str | None
    content_type: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class InvoiceRow:
    id: uuid.UUID
    job_id: uuid.UUID
    customer_id: uuid.UUID
    number: str
    state: InvoiceState
    subtotal_pence: int
    vat_pence: int
    deposit_applied_pence: int
    total_pence: int
    currency: str
    issue_date: date | None
    due_date: date | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class PaymentRow:
    id: uuid.UUID
    kind: PaymentKind
    quote_id: uuid.UUID | None
    invoice_id: uuid.UUID | None
    amount_pence: int
    currency: str
    method: PaymentMethod
    received_at: datetime
    provider_ref: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class Dataset:
    anchor: date
    users: tuple[UserRow, ...]
    customers: tuple[CustomerRow, ...]
    jobs: tuple[JobRow, ...]
    quotes: tuple[QuoteRow, ...]
    reports: tuple[ReportRow, ...]
    checklist_items: tuple[ChecklistItemRow, ...]
    photos: tuple[PhotoRow, ...]
    invoices: tuple[InvoiceRow, ...]
    payments: tuple[PaymentRow, ...]

    def tables(self) -> list[tuple[str, tuple[object, ...]]]:
        """(table name, rows) in foreign-key order."""
        return [
            ("users", self.users),
            ("customers", self.customers),
            ("jobs", self.jobs),
            ("quotes", self.quotes),
            ("job_reports", self.reports),
            ("report_checklist_items", self.checklist_items),
            ("report_photos", self.photos),
            ("invoices", self.invoices),
            ("payments", self.payments),
        ]


# --------------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------------


def uid(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"{kind}:{key}")


def at(day: date, hour: int, minute: int = 0) -> datetime:
    """A London wall-clock time on `day` as an aware UTC datetime."""
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=LONDON).astimezone(UTC)


def is_weekday(day: date) -> bool:
    return day.weekday() < 5


def add_working_days(day: date, count: int) -> date:
    step = 1 if count >= 0 else -1
    remaining = abs(count)
    while remaining:
        day += timedelta(days=step)
        if is_weekday(day):
            remaining -= 1
    return day


def days_between(first: date, last: date) -> list[date]:
    return [first + timedelta(days=n) for n in range((last - first).days + 1)]


def month_start(anchor: date, months_back: int) -> date:
    year, month0 = divmod(anchor.year * 12 + anchor.month - 1 - months_back, 12)
    return date(year, month0 + 1, 1)


def month_end(start: date) -> date:
    return month_start(start, -1) - timedelta(days=1)


def minutes(rng: random.Random, low: tuple[int, int], high: tuple[int, int]) -> tuple[int, int]:
    total = rng.randint(low[0] * 60 + low[1], high[0] * 60 + high[1])
    return divmod(total, 60)


def round_to(value: int, step: int) -> int:
    return ((value + step // 2) // step) * step


@cache
def _demo_hash(email: str, password: str) -> str:
    # Demo accounts only: a fixed salt derived from the email keeps reseeds byte-identical.
    salt = hashlib.sha256(f"jobproof-demo-salt:{email}".encode()).digest()[:16]
    return PasswordHasher().hash(password, salt=salt)


# --------------------------------------------------------------------------------------------
# Billing categories and slots
# --------------------------------------------------------------------------------------------


class Cat(StrEnum):
    NI_AW = "not invoiced, awaiting review"
    NI_REV = "not invoiced, reviewed"
    DR_AW = "draft, awaiting review"
    DR = "draft, reviewed"
    T_SENT = "sent (in terms)"
    T_PART = "part paid (in terms)"
    OVD = "overdue"
    OVD_PART = "overdue, part paid"
    PAID = "paid"
    VOID = "void"

    @property
    def awaiting(self) -> bool:
        return self in (Cat.NI_AW, Cat.DR_AW)

    @property
    def in_terms(self) -> bool:
        return self in (Cat.T_SENT, Cat.T_PART)

    @property
    def overdue(self) -> bool:
        return self in (Cat.OVD, Cat.OVD_PART)

    @property
    def invoiced(self) -> bool:
        return self not in (Cat.NI_AW, Cat.NI_REV)

    @property
    def issued(self) -> bool:
        return self in (Cat.T_SENT, Cat.T_PART, Cat.OVD, Cat.OVD_PART, Cat.PAID, Cat.VOID)

    @property
    def draft(self) -> bool:
        return self in (Cat.DR_AW, Cat.DR)


@dataclass
class Slot:
    month: int
    completed_on: date
    cat: Cat
    force_issue_in_current_month: bool = False


def _pick_dates(rng: random.Random, pool: Sequence[date], count: int) -> list[date]:
    if len(pool) >= count:
        chosen = rng.sample(list(pool), count)
    else:
        chosen = list(pool) + rng.choices(list(pool), k=count - len(pool))
    return sorted(chosen)


def _build_slots(rng: random.Random, anchor: date) -> list[Slot]:
    starts = [month_start(anchor, back) for back in range(6)]
    weekdays = [[d for d in days_between(s, month_end(s)) if is_weekday(d)] for s in starts]
    slots: list[Slot] = []

    # m0: dates from the 1st to the day before the anchor (all on the 1st when anchor is the 1st).
    last = anchor - timedelta(days=1) if anchor > starts[0] else anchor
    window = days_between(starts[0], last)
    pool = [d for d in window if is_weekday(d)] or window
    dates0 = _pick_dates(rng, pool, MONTH_COUNTS[0])
    cats0 = [Cat.T_SENT, Cat.T_SENT, Cat.DR_AW, Cat.DR_AW] + [Cat.NI_AW] * 4
    slots += [Slot(0, d, c) for d, c in zip(dates0, cats0, strict=True)]

    # m1: seven jobs in the last five working days (billed on time), four earlier.
    tail = weekdays[1][-5:]
    late = sorted(tail + rng.sample(tail, 2))
    earlier = sorted(rng.sample([d for d in weekdays[1] if d not in tail], 4))
    cats_early = [Cat.DR, Cat.NI_AW, Cat.NI_AW, Cat.NI_AW]
    rng.shuffle(cats_early)
    for d in late:
        force = anchor.day >= 10 and d in tail[-3:]
        slots.append(Slot(1, d, Cat.T_SENT, force))
    slots += [Slot(1, d, c) for d, c in zip(earlier, cats_early, strict=True)]

    plans = {
        2: [Cat.DR] * 3 + [Cat.OVD] * 3 + [Cat.PAID] * 5,
        3: [Cat.VOID] + [Cat.OVD] * 3 + [Cat.PAID] * 6,
        4: [Cat.NI_REV] + [Cat.PAID] * 9,
        5: [Cat.PAID] * 10,
    }
    for month, cats in plans.items():
        rng.shuffle(cats)
        dates = sorted(rng.sample(weekdays[month], MONTH_COUNTS[month]))
        slots += [Slot(month, d, c) for d, c in zip(dates, cats, strict=True)]

    in_terms = [s for s in slots if s.cat is Cat.T_SENT]
    for slot in rng.sample(in_terms, 2):
        slot.cat = Cat.T_PART
    overdue = [s for s in slots if s.cat is Cat.OVD]
    rng.choice(overdue).cat = Cat.OVD_PART
    slots.sort(key=lambda s: s.completed_on)  # stable
    return slots


# --------------------------------------------------------------------------------------------
# Matching customers and job types to slots
# --------------------------------------------------------------------------------------------


@dataclass
class Item:
    spec: cat.CustomerSpec
    job_type: JobType


def _assign_items(rng: random.Random, slots: list[Slot]) -> list[Item]:
    items = [Item(spec, jt) for spec in cat.CUSTOMERS for jt in spec.job_types]
    _check(len(items) == len(slots) == 60, "customer plan must contain 60 jobs")
    free_slots = list(range(len(slots)))
    free_items = list(range(len(items)))
    chosen: dict[int, int] = {}

    def take(slot_ok: Callable[[Slot], bool], item_ok: Callable[[Item], bool]) -> None:
        candidates_s = [s for s in free_slots if slot_ok(slots[s])]
        candidates_i = [i for i in free_items if item_ok(items[i])]
        _check(bool(candidates_s) and bool(candidates_i), "no slot/item pair for a requirement")
        s, i = rng.choice(candidates_s), rng.choice(candidates_i)
        free_slots.remove(s)
        free_items.remove(i)
        chosen[s] = i

    def harbourside(item: Item) -> bool:
        return item.spec.key == "harbourside"

    def homeowner(item: Item) -> bool:
        return item.spec.customer_type is CustomerType.homeowner

    interior = JobType.interior_repaint
    # Edge cases first: the long-address job and the report with no photos.
    take(
        lambda s: s.month == 4 and s.cat is Cat.PAID,
        lambda i: harbourside(i) and i.job_type is interior,
    )
    take(
        lambda s: s.month == 0 and s.cat is Cat.NI_AW,
        lambda i: homeowner(i) and i.job_type is interior,
    )
    # Harbourside Lettings spans most statuses.
    for slot_ok in (
        lambda s: s.month == 0 and s.cat is Cat.NI_AW,
        lambda s: s.cat is Cat.DR_AW,
        lambda s: s.month == 1 and s.cat is Cat.NI_AW,
        lambda s: s.cat is Cat.T_SENT,
        lambda s: s.cat is Cat.T_SENT,
        lambda s: s.cat is Cat.T_PART,
        lambda s: s.month == 3 and s.cat.overdue,
        lambda s: s.cat is Cat.VOID,
        lambda s: s.month == 2 and s.cat is Cat.DR,
        lambda s: s.cat is Cat.PAID,
        lambda s: s.cat is Cat.PAID,
    ):
        take(slot_ok, harbourside)
    # Recent invoices that must still be in terms need 30-day customers; old 14-day ones overdue.
    while any(slots[s].month == 2 and slots[s].cat.overdue for s in free_slots):
        take(lambda s: s.month == 2 and s.cat.overdue, homeowner)
    while any(slots[s].cat.in_terms for s in free_slots):
        take(
            lambda s: s.cat.in_terms,
            lambda i: i.spec.terms_days == 30 and not harbourside(i),
        )
    rng.shuffle(free_items)
    for s, i in zip(free_slots, free_items, strict=True):
        chosen[s] = i
    return [items[chosen[s]] for s in range(len(slots))]


# --------------------------------------------------------------------------------------------
# Working structures for one job
# --------------------------------------------------------------------------------------------


@dataclass
class Plan:
    slot: Slot
    item: Item
    site: cat.Address = field(default_factory=lambda: cat.DENTAL_SITE)
    title: str = ""
    notes: str | None = None
    is_long: bool = False
    is_no_photo: bool = False
    duration: int = 1
    start: date = date.min
    subtotal: int = 0
    painter_index: int = -1
    reference: str = ""
    # timeline
    next_morning: bool = False
    submitted_at: datetime = datetime.min.replace(tzinfo=UTC)
    reviewed_at: datetime | None = None
    issue_date: date | None = None
    due_date: date | None = None
    # quote
    has_quote: bool = False
    has_deposit: bool = False
    extras: int = 0
    quote_issued: date = date.min
    quote_accepted: date = date.min
    deposit_date: date = date.min

    @property
    def cat(self) -> Cat:
        return self.slot.cat

    @property
    def completed_on(self) -> date:
        return self.slot.completed_on


def _choose_sites(rng: random.Random, plans: list[Plan]) -> None:
    pools: dict[str, list[cat.Address]] = {}
    for spec in cat.CUSTOMERS:
        if spec.sites:
            pool = list(spec.sites)
            if spec.key == "harbourside":
                pool.remove(cat.LONG_SITE)
            rng.shuffle(pool)
            pools[spec.key] = pool
    for plan in plans:
        spec = plan.item.spec
        if plan.is_long:
            plan.site = cat.LONG_SITE
        elif spec.key in pools:
            pool = pools[spec.key]
            plan.site = pool.pop(0)
            if spec.key in ("larder", "dental"):
                pool.append(plan.site)  # a few sites shared by several jobs
        else:
            plan.site = spec.billing


def _choose_titles(rng: random.Random, plans: list[Plan]) -> None:
    used: dict[tuple[str, JobType], set[str]] = {}
    for plan in plans:
        options = cat.TITLES[plan.item.job_type]
        seen = used.setdefault((plan.item.spec.key, plan.item.job_type), set())
        fresh = [t for t in options if t not in seen] or options
        plan.title = rng.choice(fresh)
        seen.add(plan.title)
        if plan.is_long:
            plan.notes = cat.LONG_JOB_NOTES
        elif rng.random() < 0.85:
            sentences = cat.JOB_NOTES[plan.item.job_type]
            plan.notes = " ".join(rng.sample(sentences, rng.randint(1, 2)))


def _assign_painters(rng: random.Random, plans: list[Plan]) -> None:
    """Quota-respecting assignment that avoids overlapping jobs for a painter when it can.

    Seven jobs can finish within five working days, so overlaps are unavoidable for the most
    recent jobs; those fall back to any painter who still has quota.
    """
    remaining = list(cat.PAINTER_QUOTAS)
    busy: list[list[tuple[date, date]]] = [[] for _ in remaining]
    order = list(range(len(plans)))
    rng.shuffle(order)
    # Place the longest jobs first so they get the free painters.
    order.sort(key=lambda n: -plans[n].duration)
    for index in order:
        plan = plans[index]
        with_quota = [p for p in range(len(remaining)) if remaining[p] > 0]
        free = [
            p
            for p in with_quota
            if all(plan.completed_on < a or plan.start > b for a, b in busy[p])
        ]
        options = free or with_quota
        painter = rng.choices(options, weights=[remaining[p] for p in options])[0]
        remaining[painter] -= 1
        busy[painter].append((plan.start, plan.completed_on))
        plan.painter_index = painter


# --------------------------------------------------------------------------------------------
# Review and invoice timeline
# --------------------------------------------------------------------------------------------


def _plan_timeline(rng: random.Random, anchor: date, plan: Plan, terms: int) -> None:
    completed = plan.completed_on
    if completed == anchor:
        sub_date, (h, m) = completed, minutes(rng, (13, 0), (15, 0))
    elif plan.next_morning:
        sub_date, (h, m) = add_working_days(completed, 1), minutes(rng, (8, 0), (9, 30))
    else:
        sub_date, (h, m) = completed, minutes(rng, (15, 0), (18, 30))
    plan.submitted_at = at(sub_date, h, m)
    if plan.cat.awaiting:
        return

    min_issue = month_start(anchor, 0) if plan.slot.force_issue_in_current_month else None
    options: list[tuple[date, date | None]] = []
    for review_delay in (1, 2, 3):
        cand_review = min(add_working_days(sub_date, review_delay), anchor)
        if not plan.cat.issued:
            options.append((cand_review, None))
            continue
        for issue_wait in (0, 1, 2, 3):
            cand_issue = min(add_working_days(cand_review, issue_wait), anchor)
            due = cand_issue + timedelta(days=terms)
            if plan.cat.in_terms and (due < anchor or (min_issue and cand_issue < min_issue)):
                continue
            if plan.cat.overdue and due >= anchor:
                continue
            options.append((cand_review, cand_issue))
    _check(bool(options), f"no feasible review/issue dates for {plan.cat} job on {completed}")
    review_date, issue = rng.choice(options)
    earliest = (9, 0)
    if review_date == sub_date:
        earliest = divmod(h * 60 + m + 30, 60)
    rh, rm = minutes(rng, earliest, (16, 30))
    plan.reviewed_at = at(review_date, rh, rm)
    if issue is not None:
        plan.issue_date = issue
        plan.due_date = issue + timedelta(days=terms)


# --------------------------------------------------------------------------------------------
# build_dataset
# --------------------------------------------------------------------------------------------


def _vat(subtotal: int) -> int:
    return round_to(subtotal * VAT_PERCENT, 100) // 100


def _method(rng: random.Random, allow_cash: bool = True) -> PaymentMethod:
    methods = [PaymentMethod.bank_transfer, PaymentMethod.card, PaymentMethod.cash]
    weights = [60, 35, 5] if allow_cash else [60, 35, 0]
    return rng.choices(methods, weights=weights)[0]


def build_dataset(anchor: date) -> Dataset:  # noqa: PLR0915 - one linear build, split by comments
    rng = random.Random(SEED)  # noqa: S311
    stamp0 = at(anchor - timedelta(days=330), 9)

    # ---- users and customers
    manager_name, manager_email, manager_phone = cat.MANAGER
    users = [
        UserRow(
            uid("user", manager_email),
            manager_email,
            manager_name,
            UserRole.manager,
            manager_phone,
            _demo_hash(manager_email, cat.MANAGER_PASSWORD),
            True,
            stamp0,
            stamp0,
        )
    ]
    for name, email, phone, password in cat.PAINTERS:
        users.append(
            UserRow(
                uid("user", email),
                email,
                name,
                UserRole.painter,
                phone,
                _demo_hash(email, password) if password else None,
                True,
                stamp0,
                stamp0,
            )
        )
    manager_id = users[0].id
    painter_ids = [u.id for u in users[1:]]

    customers: dict[str, CustomerRow] = {}
    for spec in cat.CUSTOMERS:
        b = spec.billing
        customers[spec.key] = CustomerRow(
            uid("customer", spec.key),
            spec.customer_type,
            spec.name,
            spec.contact_name,
            spec.email,
            spec.phone,
            b.line1,
            b.line2,
            b.town,
            b.county,
            b.postcode,
            spec.terms_days,
            spec.notes,
            stamp0,
            stamp0,
        )

    # ---- jobs
    slots = _build_slots(rng, anchor)
    items = _assign_items(rng, slots)
    plans = [Plan(slot, item) for slot, item in zip(slots, items, strict=True)]
    for plan in plans:
        plan.is_long = (
            plan.item.spec.key == "harbourside"
            and plan.item.job_type is JobType.interior_repaint
            and plan.cat is Cat.PAID
            and plan.slot.month == 4
        )
        plan.is_no_photo = (
            plan.slot.month == 0
            and plan.cat is Cat.NI_AW
            and plan.item.spec.customer_type is CustomerType.homeowner
            and plan.item.job_type is JobType.interior_repaint
        )
    # Exactly one long-address job and one no-photo report, whatever the random matching gave.
    longs = [p for p in plans if p.is_long]
    nophotos = [p for p in plans if p.is_no_photo]
    _check(len(longs) >= 1 and len(nophotos) >= 1, "edge-case jobs missing")
    for extra in longs[1:]:
        extra.is_long = False
    for extra in nophotos[1:]:
        extra.is_no_photo = False

    _choose_sites(rng, plans)
    _choose_titles(rng, plans)
    for plan in plans:
        low, high = PRICE_RANGE_POUNDS[plan.item.job_type]
        plan.subtotal = rng.randrange(low, high + 1, 5) * 100
        dur_low, dur_high = DURATION_WORKING_DAYS[plan.item.job_type]
        plan.duration = rng.randint(dur_low, dur_high)
        plan.start = add_working_days(plan.completed_on, -(plan.duration - 1))
    _assign_painters(rng, plans)

    # JP numbers follow scheduled_start.
    by_start = sorted(range(len(plans)), key=lambda n: (plans[n].start, plans[n].completed_on, n))
    for number, index in enumerate(by_start, start=1001):
        plans[index].reference = f"JP-{number}"
    plans.sort(key=lambda p: p.reference)

    # ---- timeline: next-morning submissions (1 in 6), review and invoice dates
    eligible = [
        p
        for p in plans
        if p.completed_on != anchor
        and not p.slot.force_issue_in_current_month
        and not p.cat.in_terms
        and add_working_days(p.completed_on, 1) <= anchor
    ]
    for plan in rng.sample(eligible, 10):
        plan.next_morning = True
    for plan in plans:
        _plan_timeline(rng, anchor, plan, plan.item.spec.terms_days)

    # ---- quotes and extras
    quotable = [p for p in plans if p.subtotal >= 120000]
    extra_pool = [p for p in quotable if p.cat in (Cat.PAID, Cat.OVD, Cat.OVD_PART, Cat.T_SENT)]
    _check(len(quotable) >= 24 and len(extra_pool) >= 3, "not enough jobs eligible for quotes")
    with_extras = rng.sample(extra_pool, 3)
    others = rng.sample([p for p in quotable if p not in with_extras], 21)
    quoted = sorted(with_extras + others, key=lambda p: p.reference)
    for plan in quoted:
        plan.has_quote = True
    for plan in rng.sample(quoted, 14):
        plan.has_deposit = True
    for plan in with_extras:
        plan.extras = rng.randrange(120, 481, 5) * 100
    for plan in quoted:
        plan.quote_issued = plan.start - timedelta(days=rng.randint(7, 21))
        plan.quote_accepted = plan.quote_issued + timedelta(days=rng.randint(1, 3))
        plan.deposit_date = max(
            plan.quote_accepted, plan.start - timedelta(days=rng.randint(2, 10))
        )

    # ---- build rows
    customer_for = {p.reference: customers[p.item.spec.key] for p in plans}
    job_rows: list[JobRow] = []
    quote_rows: list[QuoteRow] = []
    report_rows: list[ReportRow] = []
    checklist_rows: list[ChecklistItemRow] = []
    photo_rows: list[PhotoRow] = []
    payment_rows: list[PaymentRow] = []
    job_ids: dict[str, uuid.UUID] = {}
    quote_by_ref: dict[str, QuoteRow] = {}

    snag_refs = {p.reference for p in rng.sample(plans, 12)}
    no_notes = {p.reference for p in rng.sample([p for p in plans if not p.is_long], 5)}

    for plan in plans:
        ref = plan.reference
        job_id = uid("job", ref)
        job_ids[ref] = job_id
        created_on = (
            plan.quote_issued
            if plan.has_quote
            else plan.start - timedelta(days=rng.randint(10, 28))
        )
        created = at(created_on, 10, 0)
        s = plan.site
        job_rows.append(
            JobRow(
                job_id,
                ref,
                customer_for[ref].id,
                painter_ids[plan.painter_index],
                plan.item.job_type,
                plan.title,
                JobStatus.completed,
                s.line1,
                s.line2,
                s.town,
                s.county,
                s.postcode,
                plan.notes,
                plan.start,
                plan.completed_on,
                created,
                plan.reviewed_at or plan.submitted_at,
            )
        )

        # report
        report_id = uid("report", ref)
        if plan.is_long:
            painter_notes: str | None = cat.LONG_PAINTER_NOTES
        elif ref in no_notes:
            painter_notes = None
        else:
            painter_notes = " ".join(
                rng.sample(cat.PAINTER_NOTES[plan.item.job_type], rng.randint(2, 4))
            )
        reviewed = plan.reviewed_at is not None
        report_rows.append(
            ReportRow(
                report_id,
                job_id,
                painter_ids[plan.painter_index],
                plan.submitted_at,
                painter_notes,
                ReviewStatus.reviewed if reviewed else ReviewStatus.awaiting_review,
                plan.reviewed_at,
                manager_id if reviewed else None,
                plan.submitted_at,
                plan.reviewed_at or plan.submitted_at,
            )
        )

        # checklist
        pool = cat.CHECKLISTS[plan.item.job_type]
        picked = sorted(rng.sample(range(len(pool)), rng.randint(5, 8)))
        snag_at = rng.randrange(len(picked)) if ref in snag_refs else -1
        for position, pool_index in enumerate(picked, start=1):
            done = position - 1 != snag_at
            if not done:
                note: str | None = rng.choice(cat.SNAG_NOTES)
            else:
                note = rng.choice(cat.CHECKLIST_DONE_NOTES) if rng.random() < 0.15 else None
            checklist_rows.append(
                ChecklistItemRow(
                    uid("checklist", f"{ref}:{position}"),
                    report_id,
                    position,
                    pool[pool_index],
                    done,
                    note,
                    plan.submitted_at,
                    plan.submitted_at,
                )
            )

        # photos
        if not plan.is_no_photo:
            photo_rows += _photos(rng, plan, report_id)

    # quotes numbered by issue date
    for number, plan in enumerate(
        sorted(quoted, key=lambda p: (p.quote_issued, p.reference)), start=301
    ):
        sub = plan.subtotal
        vat = _vat(sub)
        total = sub + vat
        deposit = max(500, round_to(total // 4, 500)) if plan.has_deposit else 0
        qref = f"Q-{number:04d}"
        row = QuoteRow(
            uid("quote", qref),
            job_ids[plan.reference],
            qref,
            QuoteStatus.accepted,
            sub,
            vat,
            total,
            deposit,
            "GBP",
            plan.quote_issued,
            plan.quote_issued + timedelta(days=30),
            plan.quote_accepted,
            at(plan.quote_issued, 10, 0),
            at(plan.quote_accepted, 11, 0),
        )
        quote_rows.append(row)
        quote_by_ref[plan.reference] = row
        if deposit:
            received = at(plan.deposit_date, *minutes(rng, (9, 0), (16, 0)))
            payment_rows.append(
                PaymentRow(
                    uid("payment", f"{qref}:deposit"),
                    PaymentKind.deposit,
                    row.id,
                    None,
                    deposit,
                    "GBP",
                    _method(rng, allow_cash=False),
                    received,
                    None,
                    received,
                    received,
                )
            )

    # invoices numbered by issue (or creation) order
    invoiced = [p for p in plans if p.cat.invoiced]

    def number_key(plan: Plan) -> tuple[date, str]:
        if plan.issue_date:
            return plan.issue_date, plan.reference
        base = (plan.reviewed_at or plan.submitted_at).astimezone(LONDON).date()
        return base, plan.reference

    paid_plans = [p for p in invoiced if p.cat is Cat.PAID]
    two_payments = {p.reference for p in rng.sample(paid_plans, 5)}
    invoice_rows: list[InvoiceRow] = []
    for number, plan in enumerate(sorted(invoiced, key=number_key), start=101):
        quote = quote_by_ref.get(plan.reference)
        sub = plan.subtotal + plan.extras
        vat = _vat(sub)
        deposit_applied = quote.deposit_pence if quote else 0
        total = sub + vat - deposit_applied
        inum = f"INV-{number:04d}"
        invoice_id = uid("invoice", inum)
        if plan.cat is Cat.VOID:
            state = InvoiceState.void
        elif plan.cat.draft:
            state = InvoiceState.draft
        else:
            state = InvoiceState.issued
        created = at(number_key(plan)[0], 9, 30)
        invoice_rows.append(
            InvoiceRow(
                invoice_id,
                job_ids[plan.reference],
                customer_for[plan.reference].id,
                inum,
                state,
                sub,
                vat,
                deposit_applied,
                total,
                "GBP",
                plan.issue_date,
                plan.due_date,
                created,
                created,
            )
        )
        payment_rows += _invoice_payments(
            rng, anchor, plan, invoice_id, inum, total, plan.reference in two_payments
        )

    dataset = Dataset(
        anchor,
        tuple(users),
        tuple(customers.values()),
        tuple(job_rows),
        tuple(quote_rows),
        tuple(report_rows),
        tuple(checklist_rows),
        tuple(photo_rows),
        tuple(invoice_rows),
        tuple(sorted(payment_rows, key=lambda p: (p.received_at, str(p.id)))),
    )
    _verify(dataset)
    return dataset


def _photos(rng: random.Random, plan: Plan, report_id: uuid.UUID) -> list[PhotoRow]:
    ref = plan.reference
    captions = cat.CAPTIONS[plan.item.job_type]
    counts = {
        PhotoStage.before: rng.randint(1, 3),
        PhotoStage.during: rng.randint(1, 3),
        PhotoStage.after: rng.randint(2, 4),
    }
    submitted_local = plan.submitted_at.astimezone(LONDON)
    same_day = submitted_local.date() == plan.completed_on
    middle = [d for d in days_between(plan.start, plan.completed_on)[1:-1] if is_weekday(d)]
    submitted_minute = submitted_local.hour * 60 + submitted_local.minute
    after_hi = submitted_minute - 10 if same_day else 17 * 60 + 30
    portrait = plan.item.job_type is JobType.staircase_woodwork
    width, height = (1200, 1600) if portrait else (1600, 1200)

    taken: dict[PhotoStage, list[datetime]] = {}
    for stage, count in counts.items():
        if stage is PhotoStage.before:
            when = [
                at(plan.start, *divmod(rng.randint(8 * 60 + 15, 10 * 60 + 30), 60))
                for _ in range(count)
            ]
        elif stage is PhotoStage.during:
            if middle:
                days = [rng.choice(middle) for _ in range(count)]
                when = [at(d, *divmod(rng.randint(9 * 60 + 30, 16 * 60 + 30), 60)) for d in days]
            else:
                when = [
                    at(plan.start, *divmod(rng.randint(10 * 60 + 40, 11 * 60 + 55), 60))
                    for _ in range(count)
                ]
        else:
            when = [
                at(plan.completed_on, *divmod(rng.randint(12 * 60, after_hi), 60))
                for _ in range(count)
            ]
        taken[stage] = sorted(when)

    rows: list[PhotoRow] = []
    position = 0
    for stage in (PhotoStage.before, PhotoStage.during, PhotoStage.after):
        stage_captions = rng.sample(captions[stage.value], min(counts[stage], 5))
        for index, when_taken in enumerate(taken[stage]):
            position += 1
            caption = stage_captions[index % len(stage_captions)]
            rows.append(
                PhotoRow(
                    uid("photo", f"{ref}:{position}"),
                    report_id,
                    stage,
                    position,
                    caption,
                    when_taken,
                    width,
                    height,
                    None,
                    None,
                    when_taken + timedelta(minutes=2),
                    when_taken + timedelta(minutes=2),
                )
            )
    return rows


def _invoice_payments(
    rng: random.Random,
    anchor: date,
    plan: Plan,
    invoice_id: uuid.UUID,
    number: str,
    total: int,
    two: bool,
) -> list[PaymentRow]:
    if plan.cat in (Cat.PAID, Cat.T_PART, Cat.OVD_PART):
        assert plan.issue_date is not None and plan.due_date is not None  # noqa: S101
        low = plan.issue_date
        high = min(plan.due_date + timedelta(days=10), anchor)
        if plan.cat is Cat.T_PART:
            high = anchor
        elif plan.cat is Cat.OVD_PART:
            high = min(plan.due_date, anchor)
        high = max(high, low)
    elif plan.cat in (Cat.T_SENT, Cat.OVD):
        return []
    else:
        return []
    if plan.cat is Cat.PAID:
        if two:
            first = max(100, round_to(total * rng.randint(40, 60) // 100, 100))
            first = min(first, total - 100)
            amounts = [first, total - first]
        else:
            amounts = [total]
    else:
        amounts = [min(total - 100, max(100, round_to(total * rng.randint(40, 60) // 100, 100)))]
    span = (high - low).days
    offsets = sorted(rng.randint(0, span) for _ in amounts)
    rows = []
    for index, (amount, offset) in enumerate(zip(amounts, offsets, strict=True), start=1):
        received = at(low + timedelta(days=offset), *minutes(rng, (9, 0), (17, 30)))
        rows.append(
            PaymentRow(
                uid("payment", f"{number}:{index}"),
                PaymentKind.invoice,
                None,
                invoice_id,
                amount,
                "GBP",
                _method(rng),
                received,
                None,
                received,
                received,
            )
        )
    return rows


def _verify(ds: Dataset) -> None:
    """Fail the build if the generated data misses any specified volume or mix."""
    _check(len(ds.users) == 7 and len(ds.customers) == 12 and len(ds.jobs) == 60, "volumes")
    _check(len(ds.reports) == 60 and len(ds.quotes) == 24 and len(ds.invoices) == 52, "volumes")
    awaiting = sum(r.review_status is ReviewStatus.awaiting_review for r in ds.reports)
    _check(awaiting == AWAITING_REVIEW_TOTAL, f"awaiting review {awaiting}")
    paid_by_invoice: dict[uuid.UUID, int] = {}
    for p in ds.payments:
        if p.invoice_id:
            paid_by_invoice[p.invoice_id] = paid_by_invoice.get(p.invoice_id, 0) + p.amount_pence
    counts: dict[InvoiceStatus, int] = {}
    for inv in ds.invoices:
        status = invoice_status(
            inv.state, inv.total_pence, paid_by_invoice.get(inv.id, 0), inv.due_date, ds.anchor
        )
        counts[status] = counts.get(status, 0) + 1
    _check(counts == EXPECTED_STATUS_COUNTS, f"invoice status mix {counts}")
    types: dict[JobType, int] = {}
    for job in ds.jobs:
        types[job.job_type] = types.get(job.job_type, 0) + 1
    _check(types == TYPE_COUNTS, f"job type mix {types}")
    deposits = [q for q in ds.quotes if q.deposit_pence]
    _check(len(deposits) == 14, "deposit count")


def dataset_as_dicts(ds: Dataset) -> dict[str, list[dict[str, object]]]:
    """Rows as plain dicts per table (used by the loader)."""
    return {
        name: [dataclasses.asdict(row) for row in rows]  # type: ignore[call-overload]
        for name, rows in ds.tables()
    }
