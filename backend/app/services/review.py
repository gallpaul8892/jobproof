"""Mark a report reviewed (T-002g).

Concurrency: a row lock (`SELECT ... FOR UPDATE`) plus a version compare inside one transaction.
On any `ProblemError` nothing has been committed; `get_session` closes the session, which rolls
back and releases the lock.
"""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.errors import ProblemError
from app.models import JobReport, User
from app.models.enums import AuditAction, ReportState, ReviewStatus
from app.services.audit import FieldChange, record_event


def iso_utc(value: dt.datetime | None) -> str | None:
    """ISO 8601 UTC with a trailing Z, the format of every API datetime."""
    if value is None:
        return None
    return value.astimezone(dt.UTC).isoformat().replace("+00:00", "Z")


def _person(session: Session, user_id: uuid.UUID | None) -> dict[str, str] | None:
    if user_id is None:
        return None
    user = session.get(User, user_id)
    return {"id": str(user_id), "name": user.full_name if user else ""}


def conflict_extensions(session: Session, report: JobReport) -> dict[str, Any]:
    """Current review and change fields, carried by `version_conflict` (also used by T-002i)."""
    return {
        "current_version": report.version,
        "last_changed_at": iso_utc(report.last_changed_at),
        "last_changed_by": _person(session, report.last_changed_by_id),
        "review_status": report.review_status.value if report.review_status else None,
        "reviewed_at": iso_utc(report.reviewed_at),
        "reviewed_by": _person(session, report.reviewed_by_id),
    }


def lock_report(session: Session, report_id: uuid.UUID) -> JobReport:
    report = session.get(JobReport, report_id, with_for_update=True)
    if report is None or report.state != ReportState.submitted:  # drafts are the operative's
        raise ProblemError(404, "not_found", "Report not found.")
    return report


def version_conflict(
    session: Session, report: JobReport, extra: dict[str, Any] | None = None
) -> ProblemError:
    return ProblemError(
        409,
        "version_conflict",
        "This report was changed after you loaded it.",
        extensions={**conflict_extensions(session, report), **(extra or {})},
    )


def review_report(
    session: Session, report_id: uuid.UUID, user: User, version: int, now: dt.datetime
) -> None:
    report = lock_report(session, report_id)
    if report.version != version:
        raise version_conflict(session, report)
    if report.review_status == ReviewStatus.reviewed:
        reviewer = _person(session, report.reviewed_by_id)
        name = reviewer["name"] if reviewer else "another manager"
        raise ProblemError(
            409,
            "already_reviewed",
            f"Already reviewed by {name} at {iso_utc(report.reviewed_at)}.",
            extensions={
                "current_version": report.version,
                "reviewed_at": iso_utc(report.reviewed_at),
                "reviewed_by": reviewer,
            },
        )
    report.review_status = ReviewStatus.reviewed
    report.reviewed_at = now
    report.reviewed_by_id = user.id
    report.version += 1
    report.last_changed_at = now
    report.last_changed_by_id = user.id
    record_event(
        session,
        actor=user,
        action=AuditAction.report_reviewed,
        changes=[
            FieldChange(
                "review_status", ReviewStatus.awaiting_review.value, ReviewStatus.reviewed.value
            )
        ],
        now=now,
        report_id=report.id,
    )
    session.commit()
