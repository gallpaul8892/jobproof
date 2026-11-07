"""Password verification (argon2id) and access tokens (JWT, HS256).

Token expiry is checked against `app.clock` rather than the wall clock inside PyJWT, so a pinned
`FIXED_NOW` (tests only) behaves the same for issuing and verifying.
"""

import datetime as dt
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

ALGORITHM = "HS256"
ISSUER = "jobproof"
AUDIENCE = "jobproof-api"
LEEWAY_SECONDS = 30
_REQUIRED_CLAIMS = ["sub", "role", "iat", "exp", "iss", "aud"]

_hasher = PasswordHasher()
# Verified against when no real hash exists, so unknown users, password-less users and wrong
# passwords all cost one argon2id verification. Built with the same parameters as real hashes.
_DUMMY_HASH = _hasher.hash("jobproof-dummy-password-never-valid")


def verify_password(stored_hash: str | None, password: str) -> bool:
    """True only when `stored_hash` exists and matches. Always performs one verification."""
    try:
        matched = _hasher.verify(stored_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return matched and stored_hash is not None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


class InvalidTokenError(Exception):
    """The bearer token is missing claims, expired, mis-signed or otherwise unusable."""


def create_access_token(
    *, user_id: str, role: str, secret: str, ttl_seconds: int, now: dt.datetime
) -> str:
    issued = int(now.timestamp())
    claims = {
        "sub": user_id,
        "role": role,
        "iat": issued,
        "exp": issued + ttl_seconds,
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(claims, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, *, secret: str, now: dt.datetime) -> dict[str, Any]:
    """Verify signature, issuer, audience and required claims, then expiry against `now`."""
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            secret,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={
                "require": _REQUIRED_CLAIMS,
                "verify_exp": False,
                "verify_iat": False,
                "verify_nbf": False,
            },
        )
    except jwt.InvalidTokenError as exc:
        raise InvalidTokenError(type(exc).__name__) from exc
    now_ts = now.timestamp()
    exp, iat = claims["exp"], claims["iat"]
    if (
        isinstance(exp, bool)
        or isinstance(iat, bool)
        or not isinstance(exp, int | float)
        or not isinstance(iat, int | float)
    ):
        raise InvalidTokenError("bad time claims")
    if exp + LEEWAY_SECONDS < now_ts:
        raise InvalidTokenError("expired")
    if iat - LEEWAY_SECONDS > now_ts:
        raise InvalidTokenError("issued in the future")
    return claims
