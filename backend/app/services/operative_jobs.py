"""The operative's view of their own jobs (T-003c, T-003d).

Ownership is one rule applied in one place: a job is the caller's when `jobs.painter_id` is the
caller. Anything else is a 404, never a 403, so nothing reveals that another operative's job
exists. Jobs, their checklists and their report load in a fixed number of statements however
many jobs there are (`selectinload` for collections, `joinedload` for single rows).
"""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import Select, and_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.errors import ProblemError
from app.models import Job, JobReport, ReportChecklistItem, User
from app.models.enums import JobStatus, ReportState
from app.schemas import operative as schemas
from app.schemas.common import Address, PersonRef

_LOAD_OPTIONS: tuple[Any, ...] = (
    joinedload(Job.customer),
    selectinload(Job.checklist_items),
    selectinload(Job.report).options(
        joinedload(JobReport.submitted_by),
        joinedload(JobReport.reviewed_by),
        selectinload(JobReport.checklist_items),
    ),
)

# The earlier-unfinished list is bounded (T-003 review): 30 days back, 50 rows.
EARLIER_DAYS = 30
EARLIER_LIMIT = 50

# Sort order of today's list: open work first, then what is finished or cancelled.
_STATUS_RANK = {
    schemas.OperativeJobStatus.in_progress: 0,
    schemas.OperativeJobStatus.to_do: 0,
    schemas.OperativeJobStatus.submitted: 1,
    schemas.OperativeJobStatus.completed_by_office: 2,
    schemas.OperativeJobStatus.cancelled: 3,
}


def _draft_of_another(user: User) -> Any:
    return Job.report.has(
        and_(JobReport.state == ReportState.draft, JobReport.painter_id != user.id)
    )


def _own_jobs(user: User) -> Select[Any]:
    """Every query over operative jobs starts here: only the caller's jobs."""
    return select(Job).where(Job.painter_id == user.id).options(*_LOAD_OPTIONS)


def get_own_job(session: Session, user: User, job_id: uuid.UUID) -> Job:
    job: Job | None = (
        session.scalars(_own_jobs(user).where(Job.id == job_id)).unique().one_or_none()
    )
    if job is None:
        raise ProblemError(404, "not_found", "Job not found.")
    # A draft belongs to the operative who started it. After a reassignment the new assignee
    # neither sees nor writes it until the office resolves it (backlog B15).
    report = job.report
    if report is not None and report.state == ReportState.draft and report.painter_id != user.id:
        raise ProblemError(
            409, "draft_owned_by_other", "Another operative started this job's report."
        )
    return job


def job_status(job: Job) -> schemas.OperativeJobStatus:
    """cancelled > submitted > completed_by_office > in_progress > to_do."""
    report = job.report
    if job.status == JobStatus.cancelled:
        return schemas.OperativeJobStatus.cancelled
    if report is not None and report.state == ReportState.submitted:
        return schemas.OperativeJobStatus.submitted
    if job.status == JobStatus.completed:
        return schemas.OperativeJobStatus.completed_by_office
    if report is not None:
        return schemas.OperativeJobStatus.in_progress
    return schemas.OperativeJobStatus.to_do


def _item_status(item: ReportChecklistItem | None) -> schemas.ChecklistStatus:
    if item is None:
        return schemas.ChecklistStatus.open
    if item.done:
        return schemas.ChecklistStatus.done
    if item.cannot_do:
        return schemas.ChecklistStatus.not_done
    return schemas.ChecklistStatus.open


def _dealt_with(item: ReportChecklistItem | None) -> bool:
    """Done, or "can't do" with a reason (a blank reason does not count)."""
    if item is None:
        return False
    return item.done or (item.cannot_do and bool(item.note and item.note.strip()))


def _person(user: User | None) -> PersonRef | None:
    return PersonRef(id=user.id, name=user.full_name) if user is not None else None


def build_job(job: Job) -> schemas.OperativeJob:
    """The full OperativeJob for a loaded job (used by the list and the detail alike)."""
    report = job.report
    recorded = {i.id: i for i in report.checklist_items} if report is not None else {}

    live = [i for i in job.checklist_items if i.removed_at is None]
    checklist: list[schemas.OperativeChecklistItem] = []
    for item in live:
        row = recorded.get(item.id)
        checklist.append(
            schemas.OperativeChecklistItem(
                id=item.id,
                position=item.position,
                label=item.label,
                status=_item_status(row),
                note=row.note if row is not None else None,
                removed=False,
            )
        )
    # Removed by the office after the operative recorded something: kept, last, not counted.
    # (Photos on an item will count here too once they carry an item id, T-003g.)
    for item in job.checklist_items:
        row = recorded.get(item.id)
        if item.removed_at is None or row is None:
            continue
        status = _item_status(row)
        if status != schemas.ChecklistStatus.open or row.note:
            checklist.append(
                schemas.OperativeChecklistItem(
                    id=item.id,
                    position=item.position,
                    label=item.label,
                    status=status,
                    note=row.note,
                    removed=True,
                )
            )

    customer = job.customer
    return schemas.OperativeJob(
        id=job.id,
        reference=job.reference,
        title=job.title,
        job_type=job.job_type,
        status=job_status(job),
        scheduled_start=job.scheduled_start,
        site_address=Address(
            line1=job.site_line1,
            line2=job.site_line2,
            town=job.site_town,
            county=job.site_county,
            postcode=job.site_postcode,
        ),
        checklist_total=len(live),
        checklist_dealt_with=sum(_dealt_with(recorded.get(i.id)) for i in live),
        notes=job.notes,
        contact=schemas.OperativeContact(
            name=customer.contact_name or customer.name, phone=customer.phone
        ),
        checklist=checklist,
        report=(
            schemas.OperativeReport(
                id=report.id,
                state=report.state,
                notes=report.painter_notes,
                submitted_at=report.submitted_at,
                submitted_by=_person(report.submitted_by),
                review_status=report.review_status,
                reviewed_at=report.reviewed_at,
                reviewed_by=_person(report.reviewed_by),
            )
            if report is not None
            else None
        ),
    )


def get_job(session: Session, user: User, job_id: uuid.UUID) -> schemas.OperativeJob:
    return build_job(get_own_job(session, user, job_id))


def list_jobs(
    session: Session, user: User, *, now: dt.datetime, today: dt.date
) -> schemas.OperativeJobList:
    """Today's jobs (any state) plus earlier jobs that are still open and unsubmitted.

    The earlier list is bounded: at most EARLIER_DAYS back and EARLIER_LIMIT rows (oldest first).
    """
    todays_jobs: list[Job] = list(
        session.scalars(
            _own_jobs(user).where(Job.scheduled_start == today, ~_draft_of_another(user))
        )
        .unique()
        .all()
    )
    earlier_jobs: list[Job] = list(
        session.scalars(
            _own_jobs(user)
            .where(
                Job.scheduled_start < today,
                Job.scheduled_start >= today - dt.timedelta(days=EARLIER_DAYS),
                Job.status.notin_([JobStatus.completed, JobStatus.cancelled]),
                ~Job.report.has(JobReport.state == ReportState.submitted),
                ~_draft_of_another(user),
            )
            .order_by(Job.scheduled_start, Job.reference)
            .limit(EARLIER_LIMIT)
        )
        .unique()
        .all()
    )
    todays = sorted(
        (build_job(job) for job in todays_jobs),
        key=lambda b: (_STATUS_RANK[b.status], b.reference),
    )
    earlier = [build_job(job) for job in earlier_jobs]
    return schemas.OperativeJobList(
        as_of=now, today=today, jobs_today=todays, earlier_unfinished=earlier
    )
