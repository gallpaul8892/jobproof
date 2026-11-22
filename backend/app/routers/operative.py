"""Operative (mobile) endpoints. Painter only; a job that is not the caller's is a 404."""

import uuid

from fastapi import APIRouter, Depends, Request, Response
from fastapi.concurrency import run_in_threadpool

from app.clock import now, today_london
from app.deps import (
    CurrentUser,
    ObjectStoreDep,
    PhotoStoreDep,
    SessionDep,
    SettingsDep,
    require_roles,
)
from app.errors import ProblemError
from app.models.enums import UserRole
from app.schemas import operative as schemas
from app.services import drafts, operative_jobs, photo_upload, submission

router = APIRouter(
    prefix="/api/v1/operative", dependencies=[Depends(require_roles(UserRole.painter))]
)

_PHOTO_TYPES = frozenset({"image/jpeg", "image/png"})


@router.get("/jobs", response_model=schemas.OperativeJobList)
def list_operative_jobs(
    session: SessionDep, user: CurrentUser, photo_store: PhotoStoreDep
) -> schemas.OperativeJobList:
    return operative_jobs.list_jobs(
        session, user, now=now(), today=today_london(), photo_store=photo_store
    )


@router.get("/jobs/{job_id}", response_model=schemas.OperativeJob)
def get_operative_job(
    job_id: uuid.UUID, session: SessionDep, user: CurrentUser, photo_store: PhotoStoreDep
) -> schemas.OperativeJob:
    return operative_jobs.get_job(session, user, job_id, photo_store)


@router.patch("/jobs/{job_id}/report", response_model=schemas.OperativeJob)
def save_operative_draft(
    job_id: uuid.UUID,
    body: schemas.DraftUpdate,
    session: SessionDep,
    user: CurrentUser,
    photo_store: PhotoStoreDep,
) -> schemas.OperativeJob:
    drafts.lock_own_job(session, user, job_id)
    job = operative_jobs.get_own_job(session, user, job_id)
    report = drafts.ensure_draft(session, job, user, now())
    drafts.apply_draft_update(session, job, report, body)
    session.commit()
    session.expunge_all()
    return operative_jobs.get_job(session, user, job_id, photo_store)


@router.post("/jobs/{job_id}/report/submit", response_model=schemas.OperativeJob)
def submit_operative_report(
    job_id: uuid.UUID,
    body: schemas.SubmitRequest,
    session: SessionDep,
    user: CurrentUser,
    photo_store: PhotoStoreDep,
) -> schemas.OperativeJob:
    if submission.submit(session, user, job_id, body, now()):
        session.commit()
    session.expunge_all()
    return operative_jobs.get_job(session, user, job_id, photo_store)


@router.put(
    "/jobs/{job_id}/photos/{photo_id}",
    response_model=schemas.OperativePhoto,
    responses={201: {"model": schemas.OperativePhoto}},
)
def register_operative_photo(
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
    body: schemas.PhotoRegistration,
    response: Response,
    session: SessionDep,
    user: CurrentUser,
    photo_store: PhotoStoreDep,
) -> schemas.OperativePhoto:
    photo, created = photo_upload.register(session, user, job_id, photo_id, body, now())
    session.commit()
    response.status_code = 201 if created else 200
    return operative_jobs.operative_photo(photo, photo_store)


@router.delete("/jobs/{job_id}/photos/{photo_id}", status_code=204)
def delete_operative_photo(
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    objects: ObjectStoreDep,
) -> Response:
    photo_upload.delete(session, objects, user, job_id, photo_id)
    return Response(status_code=204)


def _required_length(request: Request, limit: int) -> int:
    """`Content-Length` is required and checked before a byte of the body is read."""
    raw = request.headers.get("content-length")
    if raw is None or not raw.isascii() or not raw.isdigit():
        raise ProblemError(
            422,
            "validation_error",
            "Request validation failed.",
            errors=[
                {"loc": ["header", "content-length"], "message": "Content-Length is required."}
            ],
        )
    length = int(raw)
    if length > limit:
        raise ProblemError(413, "photo_too_large", "The photo is larger than 10 MB.")
    return length


@router.put(
    "/jobs/{job_id}/photos/{photo_id}/content",
    response_model=schemas.OperativePhoto,
    openapi_extra={"requestBody": {"content": {"image/jpeg": {}, "image/png": {}}}},
)
async def upload_operative_photo_content(
    job_id: uuid.UUID,
    photo_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
    objects: ObjectStoreDep,
    photo_store: PhotoStoreDep,
) -> schemas.OperativePhoto:
    limit = settings.photo_max_bytes
    _required_length(request, limit)
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in _PHOTO_TYPES:
        raise ProblemError(
            415, "unsupported_photo_type", "Send the photo as image/jpeg or image/png."
        )
    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > limit:  # a body longer than it declared
            raise ProblemError(413, "photo_too_large", "The photo is larger than 10 MB.")
        chunks.append(chunk)
    photo = await run_in_threadpool(
        photo_upload.store_content,
        session,
        objects,
        user,
        job_id,
        photo_id,
        content_type=content_type,
        data=b"".join(chunks),
        now=now(),
        concurrency=settings.photo_upload_concurrency,
    )
    return operative_jobs.operative_photo(photo, photo_store)
