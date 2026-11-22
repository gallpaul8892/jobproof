"""Submit the completion report (T-003h).

One transaction under a row lock on the job, in the order the contract fixes: replay or
`already_submitted`, `job_cancelled`/`job_closed`, the optional draft, `photos_not_registered`,
`submission_incomplete`, then the write. Two concurrent submits therefore produce one report: the
second waits on the lock and then finds the report submitted (same `submission_id` is a replay).

The completeness rule exists twice: here (`submission_problems`) and in
`shared/src/operative/submitRules.ts`, both tested against `submitCases.json`.
"""

import dataclasses
import datetime as dt
import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import LONDON
from app.errors import ProblemError
from app.models import JobReport, User
from app.models.enums import AuditAction, JobStatus, ReportState, ReviewStatus
from app.schemas import operative as schemas
from app.services import drafts, operative_jobs
from app.services.audit import record_event
from app.services.review import iso_utc

MSG_BEFORE = "Add at least 1 Before photo."
MSG_AFTER = "Add at least 1 After photo."
MSG_ITEM = "Tick this item or say why it wasn't done."


@dataclasses.dataclass(frozen=True)
class ItemState:
    """A checklist item as the rule sees it: only items the office has not removed."""

    id: uuid.UUID | str
    status: str  # open | done | not_done
    note: str | None


@dataclasses.dataclass(frozen=True)
class Problem:
    loc: tuple[str, ...]
    message: str


def submission_problems(photo_stages: Iterable[str], items: Sequence[ItemState]) -> list[Problem]:
    """What stops a report being submitted: Before, After, then each unfinished item in order."""
    stages = list(photo_stages)
    problems: list[Problem] = []
    if "before" not in stages:
        problems.append(Problem(("photos", "before"), MSG_BEFORE))
    if "after" not in stages:
        problems.append(Problem(("photos", "after"), MSG_AFTER))
    for item in items:
        done = item.status == "done" or (
            item.status == "not_done" and bool(item.note and item.note.strip())
        )
        if not done:
            problems.append(Problem(("checklist", str(item.id)), MSG_ITEM))
    return problems


def _incomplete(problems: Sequence[Problem]) -> ProblemError:
    return ProblemError(
        422,
        "submission_incomplete",
        "The report is not complete.",
        errors=[{"loc": list(p.loc), "message": p.message} for p in problems],
    )


def submit(
    session: Session,
    user: User,
    job_id: uuid.UUID,
    body: schemas.SubmitRequest,
    now: dt.datetime,
) -> bool:
    """Submit. Returns False for a replay of the accepted submission (nothing was written).

    The caller commits when this returns True.
    """
    drafts.lock_own_job(session, user, job_id)
    job = operative_jobs.get_own_job(session, user, job_id)

    existing = job.report
    if existing is not None and existing.state == ReportState.submitted:
        if existing.submission_id == body.submission_id:
            return False
        raise ProblemError(
            409,
            "already_submitted",
            "This report has already been submitted.",
            extensions={"submitted_at": iso_utc(existing.submitted_at)},
        )

    report = drafts.ensure_draft(session, job, user, now)  # job_cancelled / job_closed
    if body.draft is not None:
        drafts.apply_draft_update(session, job, report, body.draft)

    registered = {p.id: p for p in report.photos if p.registered_at is not None}
    missing = [str(pid) for pid in body.photo_ids if pid not in registered]
    if missing:
        raise ProblemError(
            409,
            "photos_not_registered",
            "Some photos are not registered yet. Register them, then submit again.",
            extensions={"missing_photo_ids": missing},
        )

    drafts.ensure_all_items(session, report, job)
    recorded = {i.id: i for i in report.checklist_items}
    items = [
        ItemState(
            id=i.id,
            status=operative_jobs.item_status(recorded.get(i.id)).value,
            note=recorded[i.id].note if i.id in recorded else None,
        )
        for i in job.checklist_items
        if i.removed_at is None
    ]
    problems = submission_problems([p.stage.value for p in registered.values()], items)
    if problems:
        raise _incomplete(problems)

    clash = session.scalar(
        select(JobReport.id).where(
            JobReport.submission_id == body.submission_id, JobReport.id != report.id
        )
    )
    if clash is not None:
        raise ProblemError(
            422,
            "validation_error",
            "Request validation failed.",
            errors=[
                {
                    "loc": ["body", "submission_id"],
                    "message": "This submission id was used for another job.",
                }
            ],
        )

    report.state = ReportState.submitted
    report.submitted_at = now
    report.submitted_by_id = user.id
    report.submission_id = body.submission_id
    report.device_submitted_at = body.device_submitted_at
    report.submit_clock_offset_seconds = round((now - body.device_sent_at).total_seconds())
    report.review_status = ReviewStatus.awaiting_review
    job.status = JobStatus.completed
    job.completed_on = max(job.scheduled_start, now.astimezone(LONDON).date())
    session.flush()
    record_event(
        session,
        actor=user,
        action=AuditAction.report_submitted,
        changes=[],
        now=now,
        report_id=report.id,
    )
    return True
