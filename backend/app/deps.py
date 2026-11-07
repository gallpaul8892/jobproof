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
from app.models import User
from app.models.enums import UserRole
from app.photos.store import PhotoStore, PlaceholderPhotoStore
from app.security import InvalidTokenError, decode_access_token

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


def current_user(request: Request, session: SessionDep, settings: SettingsDep) -> User:
    """The signed-in user, reloaded from the database so role and is_active are always current."""
    token = _bearer_token(request)
    try:
        claims = decode_access_token(token, secret=settings.jwt_secret, now=now())
        user_id = uuid.UUID(str(claims["sub"]))
    except (InvalidTokenError, ValueError) as exc:
        raise _unauthenticated() from exc
    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthenticated()
    request.scope["jobproof_user_id"] = str(user.id)  # picked up by the access log
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Dependency factory: 403 unless the user's database role is one of `roles`."""
    allowed = frozenset(roles)

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise ProblemError(403, "forbidden", "Your role does not allow this action.")
        return user

    return dependency
