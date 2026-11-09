"""Operative device sessions: sign in on a phone, rotate the refresh token, sign out."""

import logging

from fastapi import APIRouter, Request, Response

from app.clock import now
from app.deps import SessionDep, SettingsDep, SignOutUser, session_id_of
from app.errors import ProblemError
from app.models.enums import UserRole
from app.schemas.common import User
from app.schemas.sessions import DeviceSession, DeviceSessionRequest, RefreshRequest
from app.services import sessions as session_service
from app.services.auth import authenticate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth/sessions")

_BAD_CREDENTIALS = "Email or password is incorrect."


def _response(issued: session_service.IssuedSession, expires_in: int) -> DeviceSession:
    return DeviceSession(
        access_token=issued.access_token,
        expires_in=expires_in,
        refresh_token=issued.refresh_token,
        refresh_expires_at=issued.row.idle_expires_at,
        session_id=issued.row.id,
        user=User.model_validate(issued.user, from_attributes=True),
    )


@router.post("", response_model=DeviceSession, status_code=201)
def create_device_session(
    body: DeviceSessionRequest, session: SessionDep, settings: SettingsDep
) -> DeviceSession:
    user = authenticate(session, body.email, body.password)
    if user is None:
        logger.info("device sign-in failed")
        raise ProblemError(401, "invalid_credentials", _BAD_CREDENTIALS)
    # Checked after the password, so the answer reveals nothing to someone without it.
    if user.role != UserRole.painter:
        logger.info("device sign-in refused: not an operative", extra={"user_id": str(user.id)})
        raise ProblemError(
            403, "operatives_only", "This app is for operatives. Managers use the web app."
        )
    issued = session_service.create_session(
        session,
        settings,
        user=user,
        device_id=body.device_id,
        device_name=body.device_name,
        platform=body.platform,
        app_version=body.app_version,
        now=now(),
    )
    return _response(issued, settings.device_access_ttl_seconds)


@router.post("/refresh", response_model=DeviceSession)
def refresh_device_session(
    body: RefreshRequest, session: SessionDep, settings: SettingsDep
) -> DeviceSession:
    issued = session_service.refresh(session, settings, refresh_token=body.refresh_token, now=now())
    return _response(issued, settings.device_access_ttl_seconds)


@router.delete("/current", status_code=204)
def end_device_session(request: Request, user: SignOutUser, session: SessionDep) -> Response:
    session_id = session_id_of(request)
    if session_id is not None:
        session_service.end_session(session, session_id, now())
    return Response(status_code=204)
