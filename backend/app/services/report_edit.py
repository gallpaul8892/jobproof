"""Edit a report's notes and checklist (T-002i).

Order of checks: body validation (Pydantic, before this module), lock and load (404), checklist
ids belong to the report (422), version (409), diff (no-op returns unchanged), apply and audit,
reopen if it was reviewed. All in one transaction; the single commit is at the end.
"""

import dataclasses
import datetime as dt
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ProblemError
from app.models import JobReport, ReportChecklistItem, User
from app.models.enums import AuditAction, ReviewStatus
from app.schemas.report_write import ReportUpdate, empty_to_none
from app.services.audit import FieldChange, record_event
from app.services.review import iso_utc, lock_report, version_conflict


@dataclasses.dataclass(frozen=True)
class ItemEdit:
    item: ReportChecklistItem
    done: bool | None  # None: not sent
    note_sent: bool
    note: str | None


@dataclasses.dataclass(frozen=True)
class Edits:
    painter_notes_sent: bool
    painter_notes: str | None
    manager_notes_sent: bool
    manager_notes: str | None
    items: list[ItemEdit]


def diff_report(report: JobReport, edits: Edits) -> list[FieldChange]:
    """Fields whose sent value differs from the stored one. Empty means a no-op edit."""
    changes: list[FieldChange] = []
    if edits.painter_notes_sent and edits.painter_notes != report.painter_notes:
        changes.append(FieldChange("painter_notes", report.painter_notes, edits.painter_notes))
    if edits.manager_notes_sent and edits.manager_notes != report.manager_notes:
        changes.append(FieldChange("manager_notes", report.manager_notes, edits.manager_notes))
    for edit in edits.items:
        item = edit.item
        if edit.done is not None and edit.done != item.done:
            changes.append(FieldChange("checklist_done", item.done, edit.done, item.id, item.label))
        if edit.note_sent and edit.note != item.note:
            changes.append(FieldChange("checklist_note", item.note, edit.note, item.id, item.label))
    return changes


def _current_values(
    report: JobReport, update: ReportUpdate, items: dict[uuid.UUID, ReportChecklistItem]
) -> dict[str, Any]:
    current: dict[str, Any] = {}
    sent = update.model_fields_set
    if "painter_notes" in sent:
        current["painter_notes"] = report.painter_notes
    if "manager_notes" in sent:
        current["manager_notes"] = report.manager_notes
    if update.checklist is not None:
        current["checklist"] = [
            {"id": str(i.id), "done": items[i.id].done, "note": items[i.id].note}
            for i in update.checklist
        ]
    return current


def update_report(
    session: Session, report_id: uuid.UUID, user: User, update: ReportUpdate, now: dt.datetime
) -> None:
    report = lock_report(session, report_id)
    items = {
        i.id: i
        for i in session.scalars(
            select(ReportChecklistItem)
            .where(ReportChecklistItem.report_id == report.id)
            .order_by(ReportChecklistItem.position)
        )
    }
    sent_items = update.checklist or []
    foreign = [
        {
            "loc": ["body", "checklist", index, "id"],
            "message": "Checklist item does not belong to this report.",
        }
        for index, item in enumerate(sent_items)
        if item.id not in items
    ]
    if foreign:
        raise ProblemError(422, "validation_error", "Request validation failed.", errors=foreign)
    if report.version != update.version:
        raise version_conflict(session, report, {"current": _current_values(report, update, items)})

    sent = update.model_fields_set
    edits = Edits(
        painter_notes_sent="painter_notes" in sent,
        painter_notes=empty_to_none(update.painter_notes),
        manager_notes_sent="manager_notes" in sent,
        manager_notes=empty_to_none(update.manager_notes),
        items=[
            ItemEdit(items[i.id], i.done, "note" in i.model_fields_set, empty_to_none(i.note))
            for i in sent_items
        ],
    )
    changes = diff_report(report, edits)
    if not changes:
        session.rollback()  # nothing to write; release the row lock
        return

    for change in changes:
        if change.field == "painter_notes":
            report.painter_notes = edits.painter_notes
        elif change.field == "manager_notes":
            report.manager_notes = edits.manager_notes
        elif change.field == "checklist_done":
            items[change.item_id].done = bool(change.new_value)  # type: ignore[index]
        else:
            items[change.item_id].note = change.new_value  # type: ignore[index, assignment]
    report.version += 1
    report.last_changed_at = now
    report.last_changed_by_id = user.id
    record_event(
        session,
        actor=user,
        action=AuditAction.report_edited,
        changes=changes,
        now=now,
        report_id=report.id,
    )

    if report.review_status == ReviewStatus.reviewed:
        previous = report.reviewed_by
        previous_name = previous.full_name if previous else ""
        previous_at = iso_utc(report.reviewed_at)
        previous_id = str(report.reviewed_by_id)
        report.review_status = ReviewStatus.awaiting_review
        report.reviewed_at = None
        report.reviewed_by_id = None
        record_event(
            session,
            actor=user,
            action=AuditAction.report_reopened,
            changes=[
                FieldChange(
                    "review_status",
                    ReviewStatus.reviewed.value,
                    ReviewStatus.awaiting_review.value,
                ),
                FieldChange("reviewed_by", previous_name, None, extra={"old_id": previous_id}),
                FieldChange("reviewed_at", previous_at, None),
            ],
            now=now,
            report_id=report.id,
        )
    session.commit()
