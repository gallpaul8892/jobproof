"""Device sessions for the operative app: rotating refresh tokens with reuse detection.

A refresh token is `"<session id>.<secret>"`. The secret is 256 random bits, so only its SHA-256
is stored (a fast hash is right for a high-entropy secret; argon2 is for passwords). The rules
are in specs/T-003-design.md section 4. Nothing here logs a token, an email or a secret.
"""

import datetime as dt
import hashlib
import hmac
import logging
import secrets
import uuid

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import ProblemError
from app.models import AuthSession, User
from app.security import create_access_token

logger = logging.getLogger(__name__)

SESSION_ENDED = "session_ended"
ACCOUNT_INACTIVE = "account_inactive"
_ENDED_MESSAGE = "Your session has ended. Sign in again."
_INACTIVE_MESSAGE = "Your account is no longer active."
_UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}


def session_ended() -> ProblemError:
    return ProblemError(401, SESSION_ENDED, _ENDED_MESSAGE, headers=dict(_UNAUTHENTICATED_HEADERS))


def account_inactive() -> ProblemError:
    return ProblemError(
        401, ACCOUNT_INACTIVE, _INACTIVE_MESSAGE, headers=dict(_UNAUTHENTICATED_HEADERS)
    )


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _new_token(session_id: uuid.UUID) -> tuple[str, str]:
    """(refresh token to hand out, hash to store)."""
    secret = secrets.token_urlsafe(32)  # 43 characters of base64url
    return f"{session_id}.{secret}", hash_secret(secret)


def _parse_token(token: str) -> tuple[uuid.UUID, str] | None:
    session_id, dot, secret = token.partition(".")
    if not dot or not secret:
        return None
    try:
        return uuid.UUID(session_id), secret
    except ValueError:
        return None


def _same(left: str | None, right: str) -> bool:
    return left is not None and hmac.compare_digest(left.encode(), right.encode())


class IssuedSession:
    """What the router needs to build a `DeviceSession` response."""

    def __init__(self, row: AuthSession, user: User, access_token: str, refresh_token: str) -> None:
        self.row = row
        self.user = user
        self.access_token = access_token
        self.refresh_token = refresh_token


def _access_token(row: AuthSession, user: User, settings: Settings, now: dt.datetime) -> str:
    return create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        secret=settings.jwt_secret,
        ttl_seconds=settings.device_access_ttl_seconds,
        now=now,
        sid=str(row.id),
    )


def create_session(
    session: Session,
    settings: Settings,
    *,
    user: User,
    device_id: uuid.UUID,
    device_name: str | None,
    platform: str,
    app_version: str,
    now: dt.datetime,
) -> IssuedSession:
    """Start a session for `user` on this device; the device's previous session is replaced."""
    for attempt in (1, 2):
        revoke_device_sessions(session, user.id, device_id, "replaced", now)
        session_id = uuid.uuid4()
        refresh_token, refresh_hash = _new_token(session_id)
        absolute = now + dt.timedelta(days=settings.device_session_max_days)
        idle = min(now + dt.timedelta(days=settings.device_session_idle_days), absolute)
        row = AuthSession(
            id=session_id,
            user_id=user.id,
            device_id=device_id,
            device_name=device_name,
            platform=platform,
            app_version=app_version,
            created_at=now,
            last_used_at=now,
            idle_expires_at=idle,
            absolute_expires_at=absolute,
            refresh_hash=refresh_hash,
            generation=1,
        )
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            # A concurrent sign-in on the same device won the unique index; replace it and retry.
            session.rollback()
            if attempt == 2:
                raise
            continue
        logger.info(
            "device session created", extra={"session_id": str(row.id), "outcome": "created"}
        )
        return IssuedSession(row, user, _access_token(row, user, settings, now), refresh_token)
    raise AssertionError("unreachable")  # pragma: no cover


def revoke(session: Session, row: AuthSession, reason: str, now: dt.datetime) -> None:
    """Mark one session revoked (no commit). Already revoked sessions keep their first reason."""
    if row.revoked_at is None:
        row.revoked_at = now
        row.revoked_reason = reason


def revoke_device_sessions(
    session: Session, user_id: uuid.UUID, device_id: uuid.UUID, reason: str, now: dt.datetime
) -> None:
    session.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user_id,
            AuthSession.device_id == device_id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=now, revoked_reason=reason)
    )
    session.flush()


def revoke_all_for_user(session: Session, user_id: uuid.UUID, reason: str, now: dt.datetime) -> int:
    """Revoke every active session of the user (no commit). Returns how many were revoked."""
    result = session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason=reason)
    )
    return int(getattr(result, "rowcount", 0) or 0)


def _fail(session: Session, row: AuthSession, error: ProblemError, outcome: str) -> ProblemError:
    """Commit whatever revocation was applied, log the outcome (session id only), return `error`."""
    session.commit()
    logger.info(
        "device session refresh refused", extra={"session_id": str(row.id), "outcome": outcome}
    )
    return error


def refresh(
    session: Session, settings: Settings, *, refresh_token: str, now: dt.datetime
) -> IssuedSession:
    """Spend a refresh token for a new pair, or raise 401 `session_ended` / `account_inactive`."""
    parsed = _parse_token(refresh_token)
    if parsed is None:
        raise session_ended()
    session_id, secret = parsed
    row = session.scalar(select(AuthSession).where(AuthSession.id == session_id).with_for_update())
    if row is None:
        raise session_ended()
    # 1. Prove possession of a token for this session before anything else is revealed or done.
    #    An unknown secret (a guessed or mangled token) changes nothing: it must not be a way
    #    to log somebody else's phone out.
    presented = hash_secret(secret)
    is_current = _same(row.refresh_hash, presented)
    is_previous = not is_current and _same(row.previous_refresh_hash, presented)
    if not is_current and not is_previous:
        session.rollback()
        raise session_ended()
    in_grace = (
        is_previous
        and row.rotated_at is not None
        and now - row.rotated_at <= dt.timedelta(seconds=settings.refresh_reuse_grace_seconds)
    )
    if is_previous and not in_grace:
        # A token that was already replaced, presented after the grace window: it was copied
        # or replayed. End the session.
        revoke(session, row, "reuse_detected", now)
        raise _fail(session, row, session_ended(), "reuse_detected")
    # 2. A deactivated account is reported as such even though deactivation also revoked the
    #    session (only someone holding a valid token learns this).
    user = session.get(User, row.user_id)
    if user is None or not user.is_active:
        revoke(session, row, "deactivated", now)
        raise _fail(session, row, account_inactive(), "account_inactive")
    # 3. Revoked or expired.
    if row.revoked_at is not None or now >= row.idle_expires_at or now >= row.absolute_expires_at:
        session.rollback()
        raise session_ended()
    absolute = row.absolute_expires_at
    if is_current:
        row.previous_refresh_hash = row.refresh_hash
        row.rotated_at = now
    # else: the client lost the last response; issue another pair. The token it never received
    # stops working; the grace window is still measured from the original rotation.
    new_token, new_hash = _new_token(row.id)
    row.refresh_hash = new_hash
    row.generation += 1
    row.last_used_at = now
    row.idle_expires_at = min(now + dt.timedelta(days=settings.device_session_idle_days), absolute)
    session.commit()
    logger.info("device session refreshed", extra={"session_id": str(row.id), "outcome": "rotated"})
    return IssuedSession(row, user, _access_token(row, user, settings, now), new_token)


def end_session(session: Session, session_id: uuid.UUID, now: dt.datetime) -> None:
    """Sign out: revoke the session if it is still active (idempotent)."""
    row = session.get(AuthSession, session_id)
    if row is not None and row.revoked_at is None:
        revoke(session, row, "signed_out", now)
        session.commit()
        logger.info(
            "device session ended", extra={"session_id": str(row.id), "outcome": "signed_out"}
        )
