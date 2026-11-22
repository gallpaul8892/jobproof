"""Photo registration, file upload and deletion for the operative (T-003g, T-003k).

Two requests per photo, both safe to repeat: `register` stores the metadata under the phone's own
photo id, `store_content` validates and stores the file once. Evidence fields are fixed at
registration and a stored file is never replaced (design sections 5 and 8). Never log bodies,
file names or coordinates.
"""

import datetime as dt
import hashlib
import logging
import threading
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ProblemError
from app.models import Job, JobReport, ReportPhoto, User
from app.models.enums import AuditAction, ReportState
from app.photos.metadata import MalformedImageError, strip_metadata
from app.photos.object_store import ObjectStore
from app.photos.validate import (
    EXTENSION_FOR_TYPE,
    PhotoRejectedError,
    check_decodes,
    has_magic_bytes,
    make_thumbnail,
)
from app.schemas import operative as schemas
from app.services import drafts, operative_jobs
from app.services.audit import record_event
from app.services.review import iso_utc

logger = logging.getLogger("jobproof.photos")

MAX_PHOTOS_PER_REPORT = 60
MAX_PHOTOS_PER_ITEM = 12
BUSY_RETRY_AFTER_SECONDS = 5


# ---- registration -----------------------------------------------------------------------------
def _mismatch() -> ProblemError:
    return ProblemError(
        409,
        "photo_content_mismatch",
        "This photo id is already used for a different photo.",
    )


def _report_submitted(report: JobReport) -> ProblemError:
    return ProblemError(
        409,
        "report_submitted",
        "This report has already been submitted.",
        extensions={"submitted_at": iso_utc(report.submitted_at)},
    )


def _evidence_matches(photo: ReportPhoto, body: schemas.PhotoRegistration) -> bool:
    """Every evidence field of a repeated registration equals what was stored the first time."""
    location = body.location
    stored_location = (
        (photo.latitude, photo.longitude, photo.location_accuracy_m, photo.location_source)
        if photo.latitude is not None
        else None
    )
    sent_location = (
        (location.latitude, location.longitude, location.accuracy_m, location.source)
        if location is not None
        else None
    )
    return (
        photo.source == body.source
        and photo.taken_at == body.taken_at
        and photo.taken_at_source == body.taken_at_source
        and stored_location == sent_location
        and (photo.original_width, photo.original_height, photo.original_bytes)
        == (body.original.width, body.original.height, body.original.bytes)
        and photo.original_sha256 == body.original.sha256
        and (photo.width, photo.height, photo.upload_bytes)
        == (body.upload.width, body.upload.height, body.upload.bytes)
        and photo.sha256 == body.upload.sha256
        and photo.content_type == body.upload.content_type
    )


def _validated_item(
    session: Session,
    job: Job,
    report: JobReport,
    item_id: uuid.UUID | None,
    *,
    current_item_id: uuid.UUID | None = None,
) -> uuid.UUID | None:
    """422 when the item is not the job's; 409 when it already has 12 photos."""
    if item_id is None:
        return None
    if drafts.ensure_report_item(session, report, job, item_id) is None:
        raise ProblemError(
            422,
            "validation_error",
            "Request validation failed.",
            errors=[
                {
                    "loc": ["body", "checklist_item_id"],
                    "message": "Checklist item does not belong to this job.",
                }
            ],
        )
    if item_id != current_item_id:
        on_item = sum(1 for p in report.photos if p.checklist_item_id == item_id)
        if on_item >= MAX_PHOTOS_PER_ITEM:
            raise ProblemError(
                409,
                "photo_limit_reached",
                f"A checklist item can have at most {MAX_PHOTOS_PER_ITEM} photos.",
            )
    return item_id


def register(
    session: Session,
    user: User,
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
    body: schemas.PhotoRegistration,
    now: dt.datetime,
) -> tuple[ReportPhoto, bool]:
    """Register a photo (or repeat/update one). Returns the row and whether it was created.

    The caller commits and answers 201 (created) or 200.
    """
    drafts.lock_own_job(session, user, job_id)
    job = operative_jobs.get_own_job(session, user, job_id)
    report = drafts.ensure_draft(session, job, user, now)

    existing = session.get(ReportPhoto, photo_id)
    if existing is not None:
        if existing.report_id != report.id or not _evidence_matches(existing, body):
            raise _mismatch()
        item_id = body.checklist_item_id
        changed = (
            existing.stage != body.stage
            or existing.checklist_item_id != item_id
            or existing.caption != body.caption
        )
        if changed:
            if report.state == ReportState.submitted:
                raise _report_submitted(report)
            existing.checklist_item_id = _validated_item(
                session, job, report, item_id, current_item_id=existing.checklist_item_id
            )
            existing.stage = body.stage
            existing.caption = body.caption
            session.flush()
        return existing, False

    if report.state == ReportState.submitted:
        raise _report_submitted(report)
    item_id = _validated_item(session, job, report, body.checklist_item_id)
    if len(report.photos) >= MAX_PHOTOS_PER_REPORT:
        raise ProblemError(
            409,
            "photo_limit_reached",
            f"A report can have at most {MAX_PHOTOS_PER_REPORT} photos.",
        )
    duplicate = next((p for p in report.photos if p.original_sha256 == body.original.sha256), None)
    if duplicate is not None:
        raise ProblemError(
            409,
            "duplicate_photo",
            "This photo is already on this job.",
            extensions={"existing_photo_id": str(duplicate.id)},
        )
    position = (
        session.scalar(
            select(func.coalesce(func.max(ReportPhoto.position), 0)).where(
                ReportPhoto.report_id == report.id
            )
        )
        or 0
    ) + 1
    location = body.location
    photo = ReportPhoto(
        id=photo_id,
        report_id=report.id,
        stage=body.stage,
        position=position,
        caption=body.caption,
        taken_at=body.taken_at,
        width=body.upload.width,
        height=body.upload.height,
        content_type=body.upload.content_type,
        checklist_item_id=item_id,
        source=body.source,
        taken_at_source=body.taken_at_source,
        registered_at=now,
        registered_by_id=user.id,
        device_sent_at=body.device_sent_at,
        clock_offset_seconds=round((now - body.device_sent_at).total_seconds()),
        latitude=location.latitude if location else None,
        longitude=location.longitude if location else None,
        location_accuracy_m=location.accuracy_m if location else None,
        location_source=location.source if location else None,
        original_width=body.original.width,
        original_height=body.original.height,
        original_bytes=body.original.bytes,
        original_sha256=body.original.sha256,
        upload_bytes=body.upload.bytes,
        sha256=body.upload.sha256,
    )
    session.add(photo)
    session.flush()
    report.photos.append(photo)
    return photo, True


# ---- file upload ------------------------------------------------------------------------------
_SLOTS: dict[int, threading.BoundedSemaphore] = {}
_SLOTS_LOCK = threading.Lock()


def _slots(limit: int) -> threading.BoundedSemaphore:
    """The process-wide upload limit (one semaphore per configured size)."""
    with _SLOTS_LOCK:
        if limit not in _SLOTS:
            _SLOTS[limit] = threading.BoundedSemaphore(limit)
        return _SLOTS[limit]


def _rejected(exc: PhotoRejectedError) -> ProblemError:
    return ProblemError(exc.status, exc.code, exc.detail)


def _lock_own_photo(
    session: Session, user: User, job_id: uuid.UUID, photo_id: uuid.UUID
) -> tuple[ReportPhoto, JobReport]:
    row = session.execute(
        select(ReportPhoto, JobReport)
        .join(JobReport, JobReport.id == ReportPhoto.report_id)
        .join(Job, Job.id == JobReport.job_id)
        .where(
            ReportPhoto.id == photo_id,
            Job.id == job_id,
            Job.painter_id == user.id,
            ReportPhoto.registered_at.is_not(None),
        )
        .with_for_update(of=ReportPhoto)
    ).one_or_none()
    if row is None:
        raise ProblemError(404, "not_found", "Photo not found.")
    return row[0], row[1]


def store_content(
    session: Session,
    objects: ObjectStore,
    user: User,
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
    *,
    content_type: str,
    data: bytes,
    now: dt.datetime,
    concurrency: int,
) -> ReportPhoto:
    """Validate and store the file (blocking: run in a worker thread)."""
    slots = _slots(concurrency)
    if not slots.acquire(blocking=False):
        raise ProblemError(
            503,
            "busy",
            "The server is busy receiving photos. Try again shortly.",
            headers={"Retry-After": str(BUSY_RETRY_AFTER_SECONDS)},
        )
    try:
        return _store(session, objects, user, job_id, photo_id, content_type, data, now)
    finally:
        slots.release()


def _store(
    session: Session,
    objects: ObjectStore,
    user: User,
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
    content_type: str,
    data: bytes,
    now: dt.datetime,
) -> ReportPhoto:
    photo, report = _lock_own_photo(session, user, job_id, photo_id)
    digest = hashlib.sha256(data).hexdigest()
    if photo.received_at is not None:  # stored once, never replaced
        if digest == photo.sha256:
            return photo
        raise _mismatch()

    try:
        if content_type not in EXTENSION_FOR_TYPE or content_type != photo.content_type:
            raise PhotoRejectedError(
                415, "unsupported_photo_type", "The photo type does not match its registration."
            )
        if not has_magic_bytes(data, content_type):
            raise PhotoRejectedError(
                415, "unsupported_photo_type", "The file is not a JPEG or PNG photo."
            )
        if digest != photo.sha256:
            raise PhotoRejectedError(
                422, "checksum_mismatch", "The file does not match its checksum. Send it again."
            )
        check_decodes(data, content_type, photo.width, photo.height)
        try:
            stored = strip_metadata(data, content_type)
        except MalformedImageError:
            raise PhotoRejectedError(
                415, "unsupported_photo_type", "The file is not a valid JPEG or PNG photo."
            ) from None
        thumb = make_thumbnail(stored)
    except PhotoRejectedError as exc:
        raise _rejected(exc) from None

    base = f"reports/{report.id}/photos/{photo.id}"
    full_key = f"{base}/full.{EXTENSION_FOR_TYPE[content_type]}"
    thumb_key = f"{base}/thumb.jpg"
    objects.put(full_key, stored, content_type)
    objects.put(thumb_key, thumb, "image/jpeg")

    photo.storage_key = full_key
    photo.thumb_storage_key = thumb_key
    photo.stored_sha256 = hashlib.sha256(stored).hexdigest()
    photo.upload_bytes = len(data)
    photo.received_at = now
    if report.state == ReportState.submitted:  # arrived after the report was submitted
        record_event(
            session,
            actor=user,
            action=AuditAction.report_photo_received,
            changes=[],
            now=now,
            report_id=report.id,
        )
    session.commit()
    return photo


# ---- deletion ---------------------------------------------------------------------------------
def delete(
    session: Session,
    objects: ObjectStore,
    user: User,
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
) -> None:
    """Remove a draft photo's row, then its stored files (best effort). 204 if it is not there."""
    drafts.lock_own_job(session, user, job_id)
    job = operative_jobs.get_own_job(session, user, job_id)
    report = job.report
    photo = session.get(ReportPhoto, photo_id)
    if report is None or photo is None or photo.report_id != report.id:
        return
    if report.state == ReportState.submitted:
        raise _report_submitted(report)
    keys = [k for k in (photo.storage_key, photo.thumb_storage_key) if k is not None]
    session.delete(photo)
    session.commit()
    for key in keys:
        try:
            objects.delete(key)
        except Exception as exc:  # best effort: an orphan object is harmless, a failure is not
            logger.warning(
                "could not delete a stored file of photo %s (%s)", photo_id, type(exc).__name__
            )
