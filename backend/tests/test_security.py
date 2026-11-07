"""Unit tests for password and token handling."""

import datetime as dt
import uuid

import jwt
import pytest
from argon2 import PasswordHasher

from app.security import (
    AUDIENCE,
    ISSUER,
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    verify_password,
)

SECRET = "unit-test-jwt-secret-0123456789-abcdefghijklm"
NOW = dt.datetime(2026, 10, 15, 10, 0, tzinfo=dt.UTC)


def token(**overrides: object) -> str:
    claims: dict[str, object] = {
        "sub": str(uuid.uuid4()),
        "role": "manager",
        "iat": int(NOW.timestamp()),
        "exp": int(NOW.timestamp()) + 1800,
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, SECRET, algorithm="HS256")


def test_round_trip() -> None:
    user_id = str(uuid.uuid4())
    encoded = create_access_token(
        user_id=user_id, role="painter", secret=SECRET, ttl_seconds=900, now=NOW
    )
    claims = decode_access_token(encoded, secret=SECRET, now=NOW)
    assert claims["sub"] == user_id and claims["role"] == "painter"
    assert claims["exp"] - claims["iat"] == 900
    assert (claims["iss"], claims["aud"]) == ("jobproof", "jobproof-api")


@pytest.mark.parametrize("claim", ["sub", "role", "iat", "exp", "iss", "aud"])
def test_every_claim_is_required(claim: str) -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token(token(**{claim: None}), secret=SECRET, now=NOW)


def test_expiry_uses_the_injected_clock_with_30_seconds_of_leeway() -> None:
    encoded = token()
    exp = NOW + dt.timedelta(seconds=1800)
    assert decode_access_token(encoded, secret=SECRET, now=exp + dt.timedelta(seconds=30))
    with pytest.raises(InvalidTokenError, match="expired"):
        decode_access_token(encoded, secret=SECRET, now=exp + dt.timedelta(seconds=31))


def test_tokens_from_the_future_are_refused() -> None:
    encoded = token(iat=int(NOW.timestamp()) + 600, exp=int(NOW.timestamp()) + 2400)
    with pytest.raises(InvalidTokenError):
        decode_access_token(encoded, secret=SECRET, now=NOW)


@pytest.mark.parametrize(
    "bad",
    [
        {"aud": "other"},
        {"iss": "other"},
        {"exp": "tomorrow"},
        {"iat": True},
    ],
)
def test_wrong_claims_are_refused(bad: dict[str, object]) -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token(token(**bad), secret=SECRET, now=NOW)


def test_other_secret_algorithm_and_garbage_are_refused() -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token(token(), secret="another-secret-another-secret-0123456789", now=NOW)
    with pytest.raises(InvalidTokenError):
        decode_access_token("garbage", secret=SECRET, now=NOW)
    unsigned = jwt.encode({"sub": "x"}, key="", algorithm="none")
    with pytest.raises(InvalidTokenError):
        decode_access_token(unsigned, secret=SECRET, now=NOW)


def test_verify_password() -> None:
    stored = PasswordHasher().hash("Correct-Horse-1")
    assert verify_password(stored, "Correct-Horse-1")
    assert not verify_password(stored, "correct-horse-1")
    assert not verify_password(None, "anything")  # dummy hash verified, always False
    assert not verify_password("not-a-hash", "anything")
    assert not verify_password("", "anything")
