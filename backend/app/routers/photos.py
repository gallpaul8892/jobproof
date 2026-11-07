"""Signed photo delivery. No bearer token: the signed, expiring URL is the credential."""

import re
import uuid
from typing import Literal

from fastapi import APIRouter, Response

from app.clock import now
from app.deps import PhotoStoreDep, SessionDep, SettingsDep
from app.errors import ProblemError
from app.photos.signing import verify
from app.services.photos import get_photo

router = APIRouter(prefix="/api/v1/photos")

_SIG_FORMAT = re.compile(r"^[0-9a-f]{64}$")
_SVG_HEADERS = {
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
}


def _invalid_signature() -> ProblemError:
    return ProblemError(403, "invalid_signature", "The image link is invalid or has expired.")


@router.get("/{photo_id}/image", response_model=None)
def get_photo_image(
    photo_id: uuid.UUID,
    variant: Literal["thumb", "full"],
    exp: int,
    sig: str,
    session: SessionDep,
    settings: SettingsDep,
    photo_store: PhotoStoreDep,
) -> Response:
    # Check the signature before touching the database: an unsigned caller learns nothing about
    # which photo ids exist. A malformed signature is simply an invalid one (403), and the format
    # check also keeps non-ASCII input away from the constant-time comparison.
    if not _SIG_FORMAT.fullmatch(sig) or not verify(
        settings.photo_url_secret, photo_id, variant, exp, sig, int(now().timestamp())
    ):
        raise _invalid_signature()
    photo = get_photo(session, photo_id)
    if photo is None:
        raise ProblemError(404, "not_found", "Photo not found.")
    body, content_type = photo_store.render(photo, variant)
    return Response(content=body, media_type=content_type, headers=_SVG_HEADERS)
