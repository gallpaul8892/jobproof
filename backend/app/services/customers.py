"""Read and correct a customer's details (T-002n).

Concurrency: a row lock on the customer (`SELECT ... FOR UPDATE`) plus a version compare in one
transaction, as in `review.py`. No report row is touched: reports keep their version and review
status (D9), and the change reaches their History through the customer's events (D8).
"""

import dataclasses
import datetime as dt
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ProblemError
from app.models import Customer, Invoice, Job, JobReport, User
from app.models.enums import AuditAction, InvoiceState, ReviewStatus
from app.schemas import manager as schemas
from app.schemas.common import Address, PersonRef
from app.schemas.customer_write import CustomerUpdate
from app.services.audit import FieldChange, record_event
from app.services.review import iso_utc

# API key -> (Customer attribute, audit field). Billing address parts are sent under
# `billing_address`; the attribute names are the same as the column names.
TOP_LEVEL = {
    "name": ("name", "customer_name"),
    "contact_name": ("contact_name", "customer_contact_name"),
    "email": ("email", "customer_email"),
    "phone": ("phone", "customer_phone"),
}
ADDRESS = {
    "line1": ("billing_line1", "customer_billing_line1"),
    "line2": ("billing_line2", "customer_billing_line2"),
    "town": ("billing_town", "customer_billing_town"),
    "county": ("billing_county", "customer_billing_county"),
    "postcode": ("billing_postcode", "customer_billing_postcode"),
}


def get_customer_record(session: Session, customer_id: uuid.UUID) -> schemas.CustomerRecord:
    """One statement: the customer, who last changed it, and four correlated counts."""
    jobs = (
        select(func.count())
        .select_from(Job)
        .where(Job.customer_id == Customer.id)
        .correlate(Customer)
        .scalar_subquery()
    )

    def reports(*where: Any) -> Any:
        return (
            select(func.count())
            .select_from(JobReport)
            .join(Job, Job.id == JobReport.job_id)
            .where(Job.customer_id == Customer.id, *where)
            .correlate(Customer)
            .scalar_subquery()
        )

    invoices = (
        select(func.count())
        .select_from(Invoice)
        .where(Invoice.customer_id == Customer.id, Invoice.state == InvoiceState.issued)
        .correlate(Customer)
        .scalar_subquery()
    )
    row = session.execute(
        select(
            Customer,
            User.full_name,
            jobs,
            reports(),
            reports(JobReport.review_status == ReviewStatus.reviewed),
            invoices,
        )
        .outerjoin(User, User.id == Customer.last_changed_by_id)
        .where(Customer.id == customer_id)
    ).one_or_none()
    if row is None:
        raise ProblemError(404, "not_found", "Customer not found.")
    customer, changed_by, job_count, report_count, reviewed_count, invoice_count = row
    return schemas.CustomerRecord(
        id=customer.id,
        name=customer.name,
        customer_type=customer.customer_type,
        contact_name=customer.contact_name,
        email=customer.email,
        phone=customer.phone,
        billing_address=Address(
            line1=customer.billing_line1,
            line2=customer.billing_line2,
            town=customer.billing_town,
            county=customer.billing_county,
            postcode=customer.billing_postcode,
        ),
        version=customer.version,
        last_changed_at=customer.last_changed_at,
        last_changed_by=(
            PersonRef(id=customer.last_changed_by_id, name=changed_by)
            if customer.last_changed_by_id is not None
            else None
        ),
        impact=schemas.CustomerImpact(
            job_count=job_count,
            report_count=report_count,
            reviewed_report_count=reviewed_count,
            issued_invoice_count=invoice_count,
        ),
    )


@dataclasses.dataclass(frozen=True)
class Edit:
    """One sent field: where it lives, its new (normalised) value."""

    attribute: str
    audit_field: str
    value: str | None


def sent_edits(update: CustomerUpdate) -> tuple[list[Edit], dict[str, Edit], dict[str, Edit]]:
    """(all edits, top-level edits by API key, address edits by API key)."""
    top = {
        key: Edit(*TOP_LEVEL[key], getattr(update, key))
        for key in TOP_LEVEL
        if key in update.model_fields_set
    }
    address: dict[str, Edit] = {}
    if update.billing_address is not None:
        sent = update.billing_address.model_fields_set
        address = {
            key: Edit(*ADDRESS[key], getattr(update.billing_address, key))
            for key in ADDRESS
            if key in sent
        }
    return [*top.values(), *address.values()], top, address


def diff_customer(customer: Customer, edits: list[Edit]) -> list[FieldChange]:
    """Fields whose sent (normalised) value differs from the stored one. Empty is a no-op."""
    return [
        FieldChange(e.audit_field, getattr(customer, e.attribute), e.value)
        for e in edits
        if getattr(customer, e.attribute) != e.value
    ]


def _person(session: Session, user_id: uuid.UUID | None) -> dict[str, str] | None:
    if user_id is None:
        return None
    user = session.get(User, user_id)
    return {"id": str(user_id), "name": user.full_name if user else ""}


def _conflict(
    session: Session, customer: Customer, top: dict[str, Edit], address: dict[str, Edit]
) -> ProblemError:
    current: dict[str, Any] = {key: getattr(customer, e.attribute) for key, e in top.items()}
    if address:
        current["billing_address"] = {
            key: getattr(customer, e.attribute) for key, e in address.items()
        }
    return ProblemError(
        409,
        "version_conflict",
        "This customer was changed after you loaded it.",
        extensions={
            "current_version": customer.version,
            "last_changed_at": iso_utc(customer.last_changed_at),
            "last_changed_by": _person(session, customer.last_changed_by_id),
            "current": current,
        },
    )


def update_customer(
    session: Session,
    customer_id: uuid.UUID,
    user: User,
    update: CustomerUpdate,
    now: dt.datetime,
) -> schemas.CustomerRecord:
    customer = session.get(Customer, customer_id, with_for_update=True)
    if customer is None:
        raise ProblemError(404, "not_found", "Customer not found.")
    edits, top, address = sent_edits(update)
    if customer.version != update.version:
        raise _conflict(session, customer, top, address)

    changes = diff_customer(customer, edits)
    if not changes:
        session.rollback()  # nothing to write; release the row lock
        return get_customer_record(session, customer_id)

    for edit in edits:
        setattr(customer, edit.attribute, edit.value)
    customer.version += 1
    customer.last_changed_at = now
    customer.last_changed_by_id = user.id
    record_event(
        session,
        actor=user,
        action=AuditAction.customer_edited,
        changes=changes,
        now=now,
        customer_id=customer.id,
    )
    session.commit()
    return get_customer_record(session, customer_id)
