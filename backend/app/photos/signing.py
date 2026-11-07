"""HMAC signing of photo URLs: `hex(HMAC-SHA256(secret, "{photo_id}:{variant}:{exp}"))`."""

import hashlib
import hmac
import uuid

VARIANTS = ("thumb", "full")
EXPIRY_BUCKET_SECONDS = 600


def sign(secret: str, photo_id: uuid.UUID | str, variant: str, exp: int) -> str:
    message = f"{photo_id}:{variant}:{exp}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify(
    secret: str, photo_id: uuid.UUID | str, variant: str, exp: int, sig: str, now_ts: int
) -> bool:
    """True when the signature matches and `exp` (Unix seconds) is not in the past."""
    if variant not in VARIANTS or exp < now_ts:
        return False
    return hmac.compare_digest(sign(secret, photo_id, variant, exp), sig)


def expiry_for(now_ts: int, ttl_seconds: int) -> int:
    """Expiry bucketed up to the next 10 minutes, plus the TTL, so URLs are stable for caching."""
    bucket_end = -(-now_ts // EXPIRY_BUCKET_SECONDS) * EXPIRY_BUCKET_SECONDS
    return bucket_end + ttl_seconds
