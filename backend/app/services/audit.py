"""The append-only audit trail (T-002f).

Events are written by an explicit `record_event` call in each write service, inside the same
transaction as the change: a failed action leaves no trace. Immutability is enforced by database
triggers (migration 0005), not by this code.
"""

import dataclasses
import datetime as dt
import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.errors import ProblemError
from app.logging import request_id_var
from app.models import AuditEvent, Customer, Job, JobReport, User
from app.models.enums import AuditAction, AuditEntity
from app.schemas import audit as schemas
from app.schemas.common import PersonRef

HISTORY_LIMIT = 100


@dataclasses.dataclass(frozen=True)
class FieldChange:
    """One changed field. Values are JSON strings, booleans or null."""

    field: str
    old_value: str | bool | None
    new_value: str | bool | None
    item_id: uuid.UUID | None = None
    item_label: str | None = None
    extra: dict[str, Any] = dataclasses.field(default_factory=dict)  # stored, never returned

    def to_json(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "item_id": str(self.item_id) if self.item_id else None,
            "item_label": self.item_label,
            "old_value": self.old_value,
            "new_value": self.new_value,
            **self.extra,
        }


def record_event(
    session: Session,
    *,
    actor: User,
    action: AuditAction,
    changes: list[FieldChange],
    now: dt.datetime,
    report_id: uuid.UUID | None = None,
    customer_id: uuid.UUID | None = None,
) -> AuditEvent:
    """Add an event to the session (the caller commits). Flushes so `seq` follows call order."""
    if not changes:
        raise ValueError("record_event needs at least one change; do not record no-op events")
    if action == AuditAction.settings_changed:
        entity = AuditEntity.settings
    elif action == AuditAction.customer_edited:
        entity = AuditEntity.customer
    else:
        entity = AuditEntity.report
    if (entity == AuditEntity.report) != (report_id is not None):
        raise ValueError("report events need a report_id and other events must not have one")
    if (entity == AuditEntity.customer) != (customer_id is not None):
        raise ValueError("customer events need a customer_id and other events must not have one")
    event = AuditEvent(
        occurred_at=now,
        actor_id=actor.id,
        actor_name=actor.full_name,
        action=action,
        entity_type=entity,
        report_id=report_id,
        customer_id=customer_id,
        request_id=request_id_var.get(),
        changes=[change.to_json() for change in changes],
    )
    session.add(event)
    session.flush()
    return event


def _to_schema(event: AuditEvent) -> schemas.AuditEvent:
    return schemas.AuditEvent(
        id=event.id,
        occurred_at=event.occurred_at,
        actor=PersonRef(id=event.actor_id, name=event.actor_name),
        action=event.action,
        customer_id=event.customer_id,
        changes=[
            schemas.AuditChange(
                field=c["field"],
                item_id=c.get("item_id"),
                item_label=c.get("item_label"),
                old_value=c.get("old_value"),
                new_value=c.get("new_value"),
            )
            for c in event.changes
        ],
    )


def _history(session: Session, *where: Any) -> schemas.AuditHistory:
    total = session.scalar(select(func.count()).select_from(AuditEvent).where(*where)) or 0
    events = session.scalars(
        select(AuditEvent).where(*where).order_by(AuditEvent.seq.desc()).limit(HISTORY_LIMIT)
    ).all()
    return schemas.AuditHistory(items=[_to_schema(e) for e in events], total=total)


def report_history(session: Session, report_id: uuid.UUID) -> schemas.AuditHistory:
    """The report's own events plus the `customer.edited` events of its job's customer (D8)."""
    customer_id = session.scalar(
        select(Job.customer_id)
        .join(JobReport, JobReport.job_id == Job.id)
        .where(JobReport.id == report_id)
    )
    if customer_id is None:
        raise ProblemError(404, "not_found", "Report not found.")
    return _history(
        session, or_(AuditEvent.report_id == report_id, AuditEvent.customer_id == customer_id)
    )


def customer_history(session: Session, customer_id: uuid.UUID) -> schemas.AuditHistory:
    if session.scalar(select(Customer.id).where(Customer.id == customer_id)) is None:
        raise ProblemError(404, "not_found", "Customer not found.")
    return _history(session, AuditEvent.customer_id == customer_id)


def settings_history(session: Session) -> schemas.AuditHistory:
    return _history(session, AuditEvent.entity_type == AuditEntity.settings)
