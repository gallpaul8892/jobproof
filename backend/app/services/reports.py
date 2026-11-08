"""Report queries for the manager: list, recent, detail.

List endpoints use one count query plus one page query, joined and aggregated in SQL, so the
number of statements does not depend on the page size. Displayed billing statuses come from the
pure functions in `billing.py`; the SQL expressions in `billing_sql.py` only filter.
"""

import dataclasses
import datetime as dt
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql.elements import ColumnElement

from app.errors import ProblemError
from app.models import (
    Customer,
    Invoice,
    Job,
    JobReport,
    Payment,
    Quote,
    ReportChecklistItem,
    ReportPhoto,
    User,
)
from app.models.enums import (
    InvoiceState,
    PaymentKind,
    PhotoStage,
    QuoteStatus,
    ReportSort,
    ReviewStatus,
)
from app.photos.store import PhotoStore
from app.schemas import manager as schemas
from app.schemas.common import Address, PersonRef
from app.services.billing import (
    BillingStatus,
    InvoiceStatus,
    balance_pence,
    billing_status,
    invoice_status,
)
from app.services.billing_sql import (
    billing_status_expr,
    has_void_invoice_expr,
    invoice_status_expr,
    live_invoice_join_condition,
    paid_expr,
)

Painter = aliased(User)
Reviewer = aliased(User)
ChangedBy = aliased(User)
LiveInvoice = aliased(Invoice)

_STAGE_ORDER = case(
    (ReportPhoto.stage == PhotoStage.before, 0),
    (ReportPhoto.stage == PhotoStage.during, 1),
    else_=2,
)


@dataclasses.dataclass(frozen=True)
class ReportFilters:
    review_status: ReviewStatus | None = None
    billing_status: BillingStatus | None = None
    painter_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    q: str | None = None
    sort: ReportSort = ReportSort.default


def _summary_from(stmt: Select[Any]) -> Select[Any]:
    return (
        stmt.select_from(JobReport)
        .join(Job, Job.id == JobReport.job_id)
        .join(Customer, Customer.id == Job.customer_id)
        .join(Painter, Painter.id == JobReport.painter_id)
        .outerjoin(LiveInvoice, live_invoice_join_condition(Job.id, LiveInvoice))
    )


def _search_clause(q: str) -> ColumnElement[bool]:
    """Case-insensitive contains over customer, site address and job reference.

    `autoescape` makes `%`, `_` and `\\` literal. The postcode is also compared with spaces
    removed on both sides, so `bs84pa` and `BS8 4PA` both find `BS8 4PA`.
    """
    clauses = [
        Customer.name.icontains(q, autoescape=True),
        Job.site_line1.icontains(q, autoescape=True),
        Job.site_line2.icontains(q, autoescape=True),
        Job.site_town.icontains(q, autoescape=True),
        Job.site_county.icontains(q, autoescape=True),
        Job.site_postcode.icontains(q, autoescape=True),
        Job.reference.icontains(q, autoescape=True),
    ]
    squashed = "".join(q.split())
    if squashed:
        clauses.append(
            func.replace(Job.site_postcode, " ", "").icontains(squashed, autoescape=True)
        )
    return or_(*clauses)


def _filter_clauses(filters: ReportFilters, today: dt.date) -> list[ColumnElement[bool]]:
    clauses: list[ColumnElement[bool]] = []
    if filters.review_status is not None:
        clauses.append(JobReport.review_status == filters.review_status)
    if filters.billing_status is not None:
        live_status = invoice_status_expr(LiveInvoice, paid_expr(LiveInvoice), today)
        clauses.append(
            billing_status_expr(Job.id, LiveInvoice, live_status) == filters.billing_status.value
        )
    if filters.painter_id is not None:
        clauses.append(JobReport.painter_id == filters.painter_id)
    if filters.customer_id is not None:
        clauses.append(Job.customer_id == filters.customer_id)
    if filters.date_from is not None:
        clauses.append(Job.completed_on >= filters.date_from)
    if filters.date_to is not None:
        clauses.append(Job.completed_on <= filters.date_to)
    if filters.q:
        clauses.append(_search_clause(filters.q))
    return clauses


def _summary_columns() -> list[Any]:
    paid = paid_expr(LiveInvoice)
    photo_count = (
        select(func.count())
        .select_from(ReportPhoto)
        .where(ReportPhoto.report_id == JobReport.id)
        .scalar_subquery()
    )
    return [
        JobReport.id.label("id"),
        Job.id.label("job_id"),
        Job.reference,
        Job.job_type,
        Customer.id.label("customer_id"),
        Customer.name.label("customer_name"),
        Job.site_line1,
        Job.site_line2,
        Job.site_town,
        Job.site_county,
        Job.site_postcode,
        Painter.id.label("painter_id"),
        Painter.full_name.label("painter_name"),
        Job.completed_on,
        JobReport.submitted_at,
        photo_count.label("photo_count"),
        JobReport.review_status,
        LiveInvoice.id.label("live_invoice_id"),
        LiveInvoice.state.label("live_state"),
        LiveInvoice.total_pence.label("live_total"),
        LiveInvoice.due_date.label("live_due"),
        paid.label("live_paid"),
        has_void_invoice_expr(Job.id).label("has_void_invoice"),
    ]


def _billing_from_row(row: Any, today: dt.date) -> BillingStatus:
    """Billing status via the pure functions, from the joined live invoice (if any)."""
    if row.live_invoice_id is None:
        return billing_status(
            [(InvoiceState.void, InvoiceStatus.void)] if row.has_void_invoice else []
        )
    status = invoice_status(row.live_state, row.live_total, row.live_paid, row.live_due, today)
    return billing_status([(row.live_state, status)])


def _to_summary(row: Any, today: dt.date) -> schemas.ReportSummary:
    return schemas.ReportSummary(
        id=row.id,
        job_id=row.job_id,
        job_reference=row.reference,
        job_type=row.job_type,
        customer=PersonRef(id=row.customer_id, name=row.customer_name),
        site_address=Address(
            line1=row.site_line1,
            line2=row.site_line2,
            town=row.site_town,
            county=row.site_county,
            postcode=row.site_postcode,
        ),
        painter=PersonRef(id=row.painter_id, name=row.painter_name),
        completed_on=row.completed_on,
        submitted_at=row.submitted_at,
        photo_count=row.photo_count,
        review_status=row.review_status,
        billing_status=_billing_from_row(row, today),
    )


def _list_order(sort: ReportSort) -> tuple[Any, ...]:
    if sort == ReportSort.submitted_asc:
        return (JobReport.submitted_at.asc(), Job.reference.asc())
    return (Job.completed_on.desc(), JobReport.submitted_at.desc(), Job.reference.desc())


def list_reports(
    session: Session,
    filters: ReportFilters,
    *,
    page: int,
    page_size: int,
    today: dt.date,
) -> schemas.ReportPage:
    where = _filter_clauses(filters, today)
    total = session.scalar(_summary_from(select(func.count(JobReport.id))).where(*where)) or 0
    offset = (page - 1) * page_size
    items: list[schemas.ReportSummary] = []
    if offset < total:
        stmt = (
            _summary_from(select(*_summary_columns()))
            .where(*where)
            .order_by(*_list_order(filters.sort))
            .limit(page_size)
            .offset(offset)
        )
        items = [_to_summary(row, today) for row in session.execute(stmt)]
    return schemas.ReportPage(items=items, total=total, page=page, page_size=page_size)


def recent_reports(session: Session, *, today: dt.date, limit: int) -> list[schemas.ReportSummary]:
    stmt = (
        _summary_from(select(*_summary_columns()))
        .order_by(JobReport.submitted_at.desc(), Job.reference.desc())
        .limit(limit)
    )
    return [_to_summary(row, today) for row in session.execute(stmt)]


def review_queue(
    session: Session, *, today: dt.date, limit: int = 5
) -> list[schemas.ReportSummary]:
    """Reports awaiting review that have waited longest (T-002k)."""
    stmt = (
        _summary_from(select(*_summary_columns()))
        .where(JobReport.review_status == ReviewStatus.awaiting_review)
        .order_by(*_list_order(ReportSort.submitted_asc))
        .limit(limit)
    )
    return [_to_summary(row, today) for row in session.execute(stmt)]


def _chosen_invoice_id() -> Any:
    """The job's invoice: its live one, else its latest void one."""
    return (
        select(Invoice.id)
        .where(Invoice.job_id == Job.id)
        .order_by(
            case((Invoice.state == InvoiceState.void, 1), else_=0),
            Invoice.issue_date.desc().nulls_last(),
            Invoice.number.desc(),
        )
        .limit(1)
        .correlate(Job)
        .scalar_subquery()
    )


def _chosen_quote_id() -> Any:
    """The job's quote: its latest accepted one, else its latest issued one."""
    return (
        select(Quote.id)
        .where(Quote.job_id == Job.id)
        .order_by(
            case((Quote.status == QuoteStatus.accepted, 0), else_=1),
            Quote.issued_on.desc(),
            Quote.reference.desc(),
        )
        .limit(1)
        .correlate(Job)
        .scalar_subquery()
    )


def _address(prefix: str, obj: Any) -> Address:
    return Address(
        line1=getattr(obj, f"{prefix}_line1"),
        line2=getattr(obj, f"{prefix}_line2"),
        town=getattr(obj, f"{prefix}_town"),
        county=getattr(obj, f"{prefix}_county"),
        postcode=getattr(obj, f"{prefix}_postcode"),
    )


def get_report_detail(
    session: Session, report_id: uuid.UUID, *, today: dt.date, photo_store: PhotoStore
) -> schemas.ReportDetail:
    """Full evidence for one report in five statements: main row, checklist, photos, payments."""
    job_count = (
        select(func.count())
        .select_from(Job)
        .where(Job.customer_id == Customer.id)
        .correlate(Customer)
        .scalar_subquery()
    )
    InvoiceAlias = aliased(Invoice)  # noqa: N806
    QuoteAlias = aliased(Quote)  # noqa: N806
    stmt = (
        select(
            JobReport,
            Job,
            Customer,
            Painter,
            Reviewer,
            ChangedBy,
            InvoiceAlias,
            QuoteAlias,
            job_count,
        )
        .select_from(JobReport)
        .join(Job, Job.id == JobReport.job_id)
        .join(Customer, Customer.id == Job.customer_id)
        .join(Painter, Painter.id == JobReport.painter_id)
        .outerjoin(Reviewer, Reviewer.id == JobReport.reviewed_by_id)
        .outerjoin(ChangedBy, ChangedBy.id == JobReport.last_changed_by_id)
        .outerjoin(InvoiceAlias, InvoiceAlias.id == _chosen_invoice_id())
        .outerjoin(QuoteAlias, QuoteAlias.id == _chosen_quote_id())
        .where(JobReport.id == report_id)
    )
    row = session.execute(stmt).one_or_none()
    if row is None:
        raise ProblemError(404, "not_found", "Report not found.")
    report, job, customer, painter, reviewer, changed_by, invoice, quote, customers_jobs = row

    checklist = session.scalars(
        select(ReportChecklistItem)
        .where(ReportChecklistItem.report_id == report.id)
        .order_by(ReportChecklistItem.position)
    ).all()
    photos = session.scalars(
        select(ReportPhoto)
        .where(ReportPhoto.report_id == report.id)
        .order_by(_STAGE_ORDER, ReportPhoto.taken_at, ReportPhoto.position, ReportPhoto.id)
    ).all()

    payments: Sequence[Payment] = []
    targets: list[ColumnElement[bool]] = []
    if invoice is not None:
        targets.append(and_(Payment.kind == PaymentKind.invoice, Payment.invoice_id == invoice.id))
    if quote is not None:
        targets.append(and_(Payment.kind == PaymentKind.deposit, Payment.quote_id == quote.id))
    if targets:
        payments = session.scalars(
            select(Payment).where(or_(*targets)).order_by(Payment.received_at, Payment.id)
        ).all()

    invoice_summary: schemas.InvoiceSummary | None = None
    status = BillingStatus.not_invoiced
    if invoice is not None:
        paid = sum(p.amount_pence for p in payments if p.kind == PaymentKind.invoice)
        invoice_state = invoice_status(
            invoice.state, invoice.total_pence, paid, invoice.due_date, today
        )
        status = billing_status([(invoice.state, invoice_state)])
        invoice_summary = schemas.InvoiceSummary(
            id=invoice.id,
            number=invoice.number,
            status=InvoiceStatus(invoice_state),
            subtotal_pence=invoice.subtotal_pence,
            vat_pence=invoice.vat_pence,
            deposit_applied_pence=invoice.deposit_applied_pence,
            total_pence=invoice.total_pence,
            paid_pence=paid,
            balance_pence=balance_pence(invoice.total_pence, paid),
            issue_date=invoice.issue_date,
            due_date=invoice.due_date,
        )
    quote_summary: schemas.QuoteSummary | None = None
    if quote is not None:
        quote_summary = schemas.QuoteSummary(
            id=quote.id,
            reference=quote.reference,
            status=quote.status,
            total_pence=quote.total_pence,
            deposit_pence=quote.deposit_pence,
            deposit_paid_pence=sum(
                p.amount_pence for p in payments if p.kind == PaymentKind.deposit
            ),
            issued_on=quote.issued_on,
            accepted_on=quote.accepted_on,
        )

    return schemas.ReportDetail(
        id=report.id,
        review_status=report.review_status,
        submitted_at=report.submitted_at,
        reviewed_at=report.reviewed_at,
        reviewed_by=PersonRef(id=reviewer.id, name=reviewer.full_name) if reviewer else None,
        version=report.version,
        last_changed_at=report.last_changed_at,
        last_changed_by=(
            PersonRef(id=changed_by.id, name=changed_by.full_name) if changed_by else None
        ),
        painter_notes=report.painter_notes,
        manager_notes=report.manager_notes,
        billing_status=status,
        job=schemas.JobDetail(
            id=job.id,
            reference=job.reference,
            job_type=job.job_type,
            title=job.title,
            status=job.status,
            site_address=_address("site", job),
            notes=job.notes,
            scheduled_start=job.scheduled_start,
            completed_on=job.completed_on,
        ),
        customer=schemas.CustomerDetail(
            id=customer.id,
            name=customer.name,
            customer_type=customer.customer_type,
            contact_name=customer.contact_name,
            email=customer.email,
            phone=customer.phone,
            billing_address=_address("billing", customer),
            job_count=customers_jobs,
        ),
        painter=PersonRef(id=painter.id, name=painter.full_name),
        checklist=[
            schemas.ChecklistItem(id=i.id, label=i.label, done=i.done, note=i.note)
            for i in checklist
        ],
        photos=[
            schemas.ReportPhoto(
                id=p.id,
                stage=p.stage,
                caption=p.caption,
                taken_at=p.taken_at,
                width=p.width,
                height=p.height,
                url=photo_store.url_for(p, "full"),
                thumb_url=photo_store.url_for(p, "thumb"),
            )
            for p in photos
        ],
        quote=quote_summary,
        invoice=invoice_summary,
        payments=[
            schemas.Payment(
                id=p.id,
                kind=p.kind,
                amount_pence=p.amount_pence,
                received_at=p.received_at,
                method=p.method,
            )
            for p in payments
        ],
    )
