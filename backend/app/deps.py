"""Request dependencies: settings, the signed-in user and role checks."""

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.clock import now
from app.config import Settings
from app.db import get_session
from app.errors import ProblemError
from app.models import AuthSession, User
from app.models.enums import UserRole
from app.photos.store import PhotoStore, PlaceholderPhotoStore
from app.security import InvalidTokenError, decode_access_token
from app.services.sessions import account_inactive, session_ended

SessionDep = Annotated[Session, Depends(get_session)]


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


def get_photo_store(settings: SettingsDep) -> PhotoStore:
    return PlaceholderPhotoStore(
        secret=settings.photo_url_secret,
        base_url=settings.public_api_base_url,
        ttl_seconds=settings.photo_url_ttl_seconds,
        now=now,
    )


PhotoStoreDep = Annotated[PhotoStore, Depends(get_photo_store)]

# One message for every authentication failure: the client learns nothing about why.
_UNAUTHENTICATED = "Authentication required."


def _unauthenticated() -> ProblemError:
    return ProblemError(
        401, "unauthenticated", _UNAUTHENTICATED, headers={"WWW-Authenticate": "Bearer"}
    )


def _bearer_token(request: Request) -> str:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthenticated()
    return token


def _authenticate(
    request: Request, session: Session, settings: Settings, *, lenient_session: bool = False
) -> User:
    """The signed-in user, reloaded from the database so role and is_active are always current.

    A token with a `sid` claim (operative device session, T-003b) is also checked against its
    `auth_sessions` row on every request, so deactivation and sign-out act at once, not when the
    15-minute access token expires. Tokens without `sid` (web) behave as before.
    `lenient_session` is for sign-out only: it skips the session-state checks.
    """
    token = _bearer_token(request)
    try:
        claims = decode_access_token(token, secret=settings.jwt_secret, now=now())
        user_id = uuid.UUID(str(claims["sub"]))
        sid = uuid.UUID(str(claims["sid"])) if "sid" in claims else None
    except (InvalidTokenError, ValueError) as exc:
        raise _unauthenticated() from exc
    user = session.get(User, user_id)
    if user is None:
        raise _unauthenticated()
    if sid is None:
        if not user.is_active:
            raise _unauthenticated()
    else:
        device_session = session.get(AuthSession, sid)
        if device_session is None or device_session.user_id != user.id:
            raise _unauthenticated()
        if not lenient_session:
            if not user.is_active:
                raise account_inactive()
            if device_session.revoked_at is not None or now() >= device_session.absolute_expires_at:
                raise session_ended()
        request.scope["jobproof_session_id"] = str(sid)
    request.scope["jobproof_user_id"] = str(user.id)  # picked up by the access log
    return user


def current_user(request: Request, session: SessionDep, settings: SettingsDep) -> User:
    return _authenticate(request, session, settings)


def current_user_for_sign_out(request: Request, session: SessionDep, settings: SettingsDep) -> User:
    return _authenticate(request, session, settings, lenient_session=True)


def session_id_of(request: Request) -> uuid.UUID | None:
    """The device session id of the authenticated request (None for web tokens)."""
    raw = request.scope.get("jobproof_session_id")
    return uuid.UUID(raw) if raw else None


CurrentUser = Annotated[User, Depends(current_user)]
SignOutUser = Annotated[User, Depends(current_user_for_sign_out)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Dependency factory: 403 unless the user's database role is one of `roles`."""
    allowed = frozenset(roles)

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise ProblemError(403, "forbidden", "Your role does not allow this action.")
        return user

    return dependency
