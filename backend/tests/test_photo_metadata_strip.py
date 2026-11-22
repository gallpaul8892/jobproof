"""T-003g: embedded metadata is removed from JPEG and PNG files without re-encoding."""

import io
import struct

import pytest
from PIL import Image

from app.photos.metadata import MalformedImageError, strip_jpeg, strip_metadata, strip_png
from tests.photo_helpers import make_jpeg, make_png


def _jpeg_segments(data: bytes) -> list[int]:
    """Marker codes of the header segments up to the start of scan."""
    markers: list[int] = []
    pos = 2
    while True:
        marker = data[pos + 1]
        markers.append(marker)
        if marker == 0xDA:
            return markers
        pos += 2 + struct.unpack(">H", data[pos + 2 : pos + 4])[0]


def _png_chunks(data: bytes) -> list[bytes]:
    kinds: list[bytes] = []
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kinds.append(data[pos + 4 : pos + 8])
        pos += 12 + length
    return kinds


def _pixels(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGB").tobytes()


def test_jpeg_exif_gps_and_comment_are_removed_and_pixels_are_untouched() -> None:
    original = make_jpeg(gps=True, comment=b"private note")
    assert 0xE1 in _jpeg_segments(original) and 0xFE in _jpeg_segments(original)
    cleaned = strip_jpeg(original)
    assert 0xE1 not in _jpeg_segments(cleaned) and 0xFE not in _jpeg_segments(cleaned)
    assert b"Exif" not in cleaned and b"TestMaker" not in cleaned and b"private note" not in cleaned
    assert cleaned != original and len(cleaned) < len(original)
    assert _pixels(cleaned) == _pixels(original)  # no re-encode: the scan data is byte-identical
    assert cleaned.endswith(original[original.rindex(b"\xff\xda") :])


def test_jpeg_without_metadata_is_returned_unchanged() -> None:
    clean = strip_jpeg(make_jpeg(gps=True))
    assert strip_jpeg(clean) == clean


def test_png_text_exif_and_time_chunks_are_removed() -> None:
    original = make_png(text=True)
    kinds = _png_chunks(original)
    assert {b"tEXt", b"iTXt", b"eXIf"} <= set(kinds)
    cleaned = strip_png(original)
    assert not {b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"tIME"} & set(_png_chunks(cleaned))
    assert b"someone@example.test" not in cleaned
    assert _png_chunks(cleaned)[0] == b"IHDR" and _png_chunks(cleaned)[-1] == b"IEND"
    assert _pixels(cleaned) == _pixels(original)


def test_png_without_metadata_is_unchanged() -> None:
    clean = strip_png(make_png(text=True))
    assert strip_png(clean) == clean


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"\xff\xd8",
        b"\xff\xd8\xff",
        b"\xff\xd8\xff\xe1\x00",  # length cut off
        b"\xff\xd8\xff\xe1\xff\xff" + b"x" * 10,  # length past the end
        b"\xff\xd8\xff\xe1\x00\x01",  # length below the minimum of 2
        b"\xff\xd8\x12\x34",  # no marker
        b"\xff\xd8\xff\xd9",  # EOI before any scan
        b"GIF89a",
    ],
)
def test_malformed_jpeg_is_refused(data: bytes) -> None:
    with pytest.raises(MalformedImageError):
        strip_jpeg(data)


def test_truncated_jpeg_header_is_refused() -> None:
    good = make_jpeg(gps=True)
    with pytest.raises(MalformedImageError):
        strip_jpeg(good[: good.index(b"\xff\xda")])


@pytest.mark.parametrize("cut", [8, 20, 33, 50])
def test_truncated_png_is_refused(cut: int) -> None:
    with pytest.raises(MalformedImageError):
        strip_png(make_png()[:cut])


def test_png_with_a_bad_first_chunk_or_trailing_bytes_is_refused() -> None:
    good = make_png()
    with pytest.raises(MalformedImageError):
        strip_png(good[:8] + b"\x00\x00\x00\x00tEXt\x00\x00\x00\x00" + good[8:])
    with pytest.raises(MalformedImageError):
        strip_png(good + b"junk")
    with pytest.raises(MalformedImageError):
        strip_png(b"\x89PNG\r\n\x1a\n")


def test_unsupported_type_is_refused() -> None:
    with pytest.raises(MalformedImageError):
        strip_metadata(b"GIF89a", "image/gif")
    assert strip_metadata(make_jpeg(), "image/jpeg")
    assert strip_metadata(make_png(), "image/png")
