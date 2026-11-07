"""Dashboard figures (assumption A3 in specs/T-001-manager-view.md)."""

import calendar
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import Invoice, Job, JobReport
from app.models.enums import InvoiceState, ReviewStatus
from app.schemas.manager import Dashboard
from app.services.billing import InvoiceStatus
from app.services.billing_sql import balance_expr, invoice_status_expr, paid_expr
from app.services.reports import recent_reports


def month_bounds(today: dt.date) -> tuple[dt.date, dt.date]:
    last_day = calendar.monthrange(today.year, today.month)[1]
    return today.replace(day=1), today.replace(day=last_day)


def get_dashboard(session: Session, *, now: dt.datetime, today: dt.date) -> Dashboard:
    start, end = month_bounds(today)
    inv = aliased(Invoice)
    paid = paid_expr(inv)

    awaiting = (
        select(func.count())
        .select_from(JobReport)
        .where(JobReport.review_status == ReviewStatus.awaiting_review)
        .scalar_subquery()
    )
    completed = (
        select(func.count())
        .select_from(Job)
        .where(Job.completed_on >= start, Job.completed_on <= end)
        .scalar_subquery()
    )
    invoiced = (
        select(func.coalesce(func.sum(inv.total_pence), 0))
        .where(inv.state == InvoiceState.issued, inv.issue_date >= start, inv.issue_date <= end)
        .scalar_subquery()
    )
    # Outstanding: balance of invoices whose derived status is sent, part_paid or overdue,
    # which is every issued invoice with a balance.
    status = invoice_status_expr(inv, paid, today)
    outstanding = (
        select(func.coalesce(func.sum(balance_expr(inv, paid)), 0))
        .where(status.in_([InvoiceStatus.sent, InvoiceStatus.part_paid, InvoiceStatus.overdue]))
        .scalar_subquery()
    )
    overdue = select(func.count()).where(status == InvoiceStatus.overdue).scalar_subquery()

    row = session.execute(select(awaiting, completed, invoiced, outstanding, overdue)).one()
    return Dashboard(
        as_of=now,
        period_start=start,
        period_end=end,
        reports_awaiting_review=row[0],
        jobs_completed_this_month=row[1],
        invoiced_this_month_pence=int(row[2]),
        outstanding_pence=int(row[3]),
        overdue_invoice_count=row[4],
        recent_reports=recent_reports(session, today=today, limit=5),
    )
