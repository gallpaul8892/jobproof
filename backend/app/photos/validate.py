"""Checks on an uploaded photo's bytes: magic bytes, size, decode, dimensions, thumbnail."""

import io
import threading
import warnings
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

from app.photos.metadata import JPEG_MAGIC, PNG_SIGNATURE

# Design section 5 / R8: Pillow parses untrusted files, so bound the work it may be asked to do.
MAX_IMAGE_PIXELS = 50_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

THUMB_EDGE = 480
THUMB_QUALITY = 75
_FORMAT_FOR_TYPE = {"image/jpeg": "JPEG", "image/png": "PNG"}
EXTENSION_FOR_TYPE = {"image/jpeg": "jpg", "image/png": "png"}
# warnings.catch_warnings is not thread-safe; uploads decode in worker threads.
_WARNINGS_LOCK = threading.Lock()


class PhotoRejectedError(Exception):
    """The file is refused. `status` is the HTTP status, `code` the problem code."""

    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def _not_a_photo(
    detail: str = "The file is not a JPEG or PNG photo that matches its details.",
) -> PhotoRejectedError:
    return PhotoRejectedError(415, "unsupported_photo_type", detail)


def _too_large() -> PhotoRejectedError:
    return PhotoRejectedError(413, "photo_too_large", "The photo has too many pixels.")


def has_magic_bytes(data: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg":
        return data.startswith(JPEG_MAGIC)
    if content_type == "image/png":
        return data.startswith(PNG_SIGNATURE)
    return False


@dataclass(frozen=True)
class DecodedPhoto:
    width: int
    height: int


def check_decodes(data: bytes, content_type: str, width: int, height: int) -> DecodedPhoto:
    """Pillow opens and verifies the file, then reopens it (verify() leaves the image unusable).

    Raises `PhotoRejectedError`: 413 over the pixel limit (a decompression bomb), 415 when it is
    not the registered type or does not decode, or its dimensions differ from the registration.
    """
    try:
        with _WARNINGS_LOCK, warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(data))
        with probe:
            if probe.format != _FORMAT_FOR_TYPE[content_type]:
                raise _not_a_photo()
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            size = image.size
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _too_large() from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise _not_a_photo() from None
    if size != (width, height):
        raise _not_a_photo("The photo's size does not match its details.")
    return DecodedPhoto(width=size[0], height=size[1])


def make_thumbnail(data: bytes) -> bytes:
    """A JPEG thumbnail (long edge 480 px, quality 75); `draft()` lets JPEG decode at reduced size.

    This is the first full decode, so a truncated or corrupt file is refused here (415).
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.draft("RGB", (THUMB_EDGE, THUMB_EDGE))
            rgb = image.convert("RGB")
            rgb.thumbnail((THUMB_EDGE, THUMB_EDGE))
            out = io.BytesIO()
            rgb.save(out, format="JPEG", quality=THUMB_QUALITY)
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise _not_a_photo() from None
    return out.getvalue()
