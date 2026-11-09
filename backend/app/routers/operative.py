"""Operative (mobile) endpoints. Painter only; a job that is not the caller's is a 404."""

import uuid

from fastapi import APIRouter, Depends

from app.clock import now, today_london
from app.deps import CurrentUser, SessionDep, require_roles
from app.models.enums import UserRole
from app.schemas import operative as schemas
from app.services import operative_jobs

router = APIRouter(
    prefix="/api/v1/operative", dependencies=[Depends(require_roles(UserRole.painter))]
)


@router.get("/jobs", response_model=schemas.OperativeJobList)
def list_operative_jobs(session: SessionDep, user: CurrentUser) -> schemas.OperativeJobList:
    return operative_jobs.list_jobs(session, user, now=now(), today=today_london())


@router.get("/jobs/{job_id}", response_model=schemas.OperativeJob)
def get_operative_job(
    job_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> schemas.OperativeJob:
    return operative_jobs.get_job(session, user, job_id)
