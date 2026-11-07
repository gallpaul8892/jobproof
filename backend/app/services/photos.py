"""Photo lookup for the signed image endpoint."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import JobReport, ReportPhoto


def get_photo(session: Session, photo_id: uuid.UUID) -> ReportPhoto | None:
    """The photo with its report and job loaded (the placeholder renderer prints the job ref)."""
    return session.scalars(
        select(ReportPhoto)
        .where(ReportPhoto.id == photo_id)
        .options(joinedload(ReportPhoto.report).joinedload(JobReport.job))
    ).one_or_none()
