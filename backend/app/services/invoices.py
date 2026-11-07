"""Invoice list for the billing page."""

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer, Invoice, Job, JobReport
from app.schemas import manager as schemas
from app.schemas.common import PersonRef
from app.services.billing import InvoiceStatus, balance_pence, invoice_status
from app.services.billing_sql import invoice_status_expr, paid_expr


def list_invoices(
    session: Session,
    status: InvoiceStatus | None,
    *,
    page: int,
    page_size: int,
    today: dt.date,
) -> schemas.InvoicePage:
    paid = paid_expr(Invoice)
    where = [invoice_status_expr(Invoice, paid, today) == status.value] if status else []

    total = session.scalar(select(func.count(Invoice.id)).where(*where)) or 0
    offset = (page - 1) * page_size
    items: list[schemas.InvoiceRow] = []
    if offset < total:
        stmt = (
            select(
                Invoice.id,
                Invoice.number,
                Invoice.state,
                Invoice.total_pence,
                Invoice.due_date,
                Invoice.issue_date,
                Invoice.currency,
                paid.label("paid"),
                Customer.id.label("customer_id"),
                Customer.name.label("customer_name"),
                Job.id.label("job_id"),
                Job.reference,
                JobReport.id.label("report_id"),
            )
            .select_from(Invoice)
            .join(Job, Job.id == Invoice.job_id)
            .join(Customer, Customer.id == Invoice.customer_id)
            .outerjoin(JobReport, JobReport.job_id == Job.id)
            .where(*where)
            # Drafts (no issue date) first; the number breaks ties so pages are stable.
            .order_by(Invoice.issue_date.desc().nulls_first(), Invoice.number.desc())
            .limit(page_size)
            .offset(offset)
        )
        for row in session.execute(stmt):
            items.append(
                schemas.InvoiceRow(
                    id=row.id,
                    number=row.number,
                    status=invoice_status(
                        row.state, row.total_pence, row.paid, row.due_date, today
                    ),
                    customer=PersonRef(id=row.customer_id, name=row.customer_name),
                    job_id=row.job_id,
                    job_reference=row.reference,
                    report_id=row.report_id,
                    total_pence=row.total_pence,
                    paid_pence=row.paid,
                    balance_pence=balance_pence(row.total_pence, row.paid),
                    issue_date=row.issue_date,
                    due_date=row.due_date,
                )
            )
    return schemas.InvoicePage(items=items, total=total, page=page, page_size=page_size)
