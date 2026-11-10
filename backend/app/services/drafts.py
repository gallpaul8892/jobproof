"""The operative's draft report (T-003f; also used by photo registration and submit later).

One report per job, keyed by the job, so every write is a set-to-value and a repeat is harmless.
Writers lock the job row first (`FOR UPDATE`), which serialises two devices and a submit.
Drafts are invisible to managers, so no audit event is written and `version` (which counts
manager changes) does not move.
"""

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ProblemError
from app.models import Job, JobReport, ReportChecklistItem, User
from app.models.enums import JobStatus, ReportState
from app.schemas import operative as schemas
from app.schemas.report_write import empty_to_none
from app.services.review import iso_utc


def lock_own_job(session: Session, user: User, job_id: uuid.UUID) -> None:
    """Lock the caller's job row; anything else is a 404 (no hint that it exists)."""
    locked = session.scalar(
        select(Job.id).where(Job.id == job_id, Job.painter_id == user.id).with_for_update()
    )
    if locked is None:
        raise ProblemError(404, "not_found", "Job not found.")


def _sync_items(
    session: Session, report: JobReport, job: Job
) -> dict[uuid.UUID, ReportChecklistItem]:
    """Report items by id; creates the missing ones for job items that are not removed."""
    have = {i.id: i for i in report.checklist_items}
    for item in job.checklist_items:
        if item.removed_at is None and item.id not in have:
            row = ReportChecklistItem(
                id=item.id,
                report=report,
                position=item.position,
                label=item.label,
                done=False,
                cannot_do=False,
            )
            session.add(row)
            have[item.id] = row
    return have


def ensure_draft(session: Session, job: Job, user: User, now: dt.datetime) -> JobReport:
    """Create the draft if there is none; refuse a cancelled or office-closed job.

    The job row must already be locked (`lock_own_job`). A submitted report is returned as it
    is: callers decide what that means (`apply_draft_update` refuses it).
    """
    report = job.report
    if job.status == JobStatus.cancelled:
        raise ProblemError(409, "job_cancelled", "This job was cancelled by the office.")
    if job.status == JobStatus.completed and (
        report is None or report.state != ReportState.submitted
    ):
        raise ProblemError(409, "job_closed", "This job was closed by the office.")
    if report is None:
        report = JobReport(job=job, painter_id=user.id, state=ReportState.draft, version=1)
        session.add(report)
        session.flush()
        _sync_items(session, report, job)
    if job.status == JobStatus.scheduled:
        job.status = JobStatus.in_progress
    return report


def apply_draft_update(
    session: Session, job: Job, report: JobReport, body: schemas.DraftUpdate
) -> None:
    """Set the sent fields on a draft. 409 if submitted; 422 for an item not on the job."""
    if report.state == ReportState.submitted:
        raise ProblemError(
            409,
            "report_submitted",
            "This report has already been submitted.",
            extensions={"submitted_at": iso_utc(report.submitted_at)},
        )
    sent = body.model_fields_set
    updates = body.checklist or []
    job_item_ids = {i.id for i in job.checklist_items}  # removed items are allowed
    unknown = [
        {
            "loc": ["body", "checklist", index, "item_id"],
            "message": "Checklist item does not belong to this job.",
        }
        for index, update in enumerate(updates)
        if update.item_id not in job_item_ids
    ]
    if unknown:
        raise ProblemError(422, "validation_error", "Request validation failed.", errors=unknown)

    if "notes" in sent:
        report.painter_notes = empty_to_none(body.notes)
    if updates:
        rows = _sync_items(session, report, job)
        by_job_item = {i.id: i for i in job.checklist_items}
        for update in updates:
            row = rows.get(update.item_id)
            if row is None:  # a removed item the operative had not recorded anything on
                source = by_job_item[update.item_id]
                row = ReportChecklistItem(
                    id=source.id,
                    report=report,
                    position=source.position,
                    label=source.label,
                    done=False,
                    cannot_do=False,
                )
                session.add(row)
            if update.status is not None:
                row.done = update.status == schemas.ChecklistStatus.done
                row.cannot_do = update.status == schemas.ChecklistStatus.not_done
            if "note" in update.model_fields_set:
                row.note = empty_to_none(update.note)
    session.flush()
