"""Remove embedded metadata from JPEG and PNG files without re-encoding (T-003g, design 5).

The phone's upload copy is already re-encoded and carries no EXIF. This is defence in depth: a
small segment walk drops what could hold location or personal text and copies every other byte
unchanged, so the picture itself is never touched.

* JPEG: APP1 (EXIF, XMP), APP13 (IPTC) and COM segments, found by walking the header segments up
  to the start of scan (everything after it is entropy-coded data and is copied as it is).
* PNG: `eXIf`, `tEXt`, `iTXt`, `zTXt` and `tIME` chunks.

A structure that does not parse is refused (`MalformedImageError`), never passed through.
"""

import struct

_JPEG_SOI = b"\xff\xd8"
_JPEG_SOS = 0xDA
_JPEG_EOI = 0xD9
_JPEG_DROP = frozenset({0xE1, 0xED, 0xFE})  # APP1, APP13, COM
_JPEG_NO_LENGTH = frozenset({0x01, 0xD8, *range(0xD0, 0xD8)})  # TEM, SOI, RSTn

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_DROP = frozenset({b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"})

JPEG_MAGIC = b"\xff\xd8\xff"


class MalformedImageError(ValueError):
    """The file's segment or chunk structure is invalid."""


def strip_jpeg(data: bytes) -> bytes:
    if not data.startswith(_JPEG_SOI):
        raise MalformedImageError("not a JPEG")
    out = bytearray(_JPEG_SOI)
    pos = 2
    size = len(data)
    while True:
        if pos >= size:
            raise MalformedImageError("JPEG ends before the start of scan")
        if data[pos] != 0xFF:
            raise MalformedImageError("JPEG marker expected")
        # fill bytes: any number of 0xFF may precede a marker code
        while pos < size and data[pos] == 0xFF:
            pos += 1
        if pos >= size:
            raise MalformedImageError("JPEG ends inside a marker")
        marker = data[pos]
        pos += 1
        if marker == 0x00:
            raise MalformedImageError("invalid JPEG marker")
        if marker == _JPEG_EOI:
            raise MalformedImageError("JPEG has no image data")
        if marker in _JPEG_NO_LENGTH:
            out += bytes((0xFF, marker))
            continue
        if pos + 2 > size:
            raise MalformedImageError("JPEG segment length is cut off")
        (length,) = struct.unpack(">H", data[pos : pos + 2])
        if length < 2 or pos + length > size:
            raise MalformedImageError("JPEG segment length is invalid")
        segment_end = pos + length
        if marker == _JPEG_SOS:
            out += bytes((0xFF, marker)) + data[pos:]
            return bytes(out)
        if marker not in _JPEG_DROP:
            out += bytes((0xFF, marker)) + data[pos:segment_end]
        pos = segment_end


def strip_png(data: bytes) -> bytes:
    if not data.startswith(PNG_SIGNATURE):
        raise MalformedImageError("not a PNG")
    out = bytearray(PNG_SIGNATURE)
    pos = len(PNG_SIGNATURE)
    size = len(data)
    first = True
    while pos < size:
        if pos + 12 > size:
            raise MalformedImageError("PNG chunk is cut off")
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        end = pos + 12 + length
        if length > 0x7FFFFFFF or end > size:
            raise MalformedImageError("PNG chunk length is invalid")
        if first and kind != b"IHDR":
            raise MalformedImageError("PNG must start with IHDR")
        first = False
        if kind not in _PNG_DROP:
            out += data[pos:end]
        pos = end
        if kind == b"IEND":
            if pos != size:
                raise MalformedImageError("data after the end of the PNG")
            return bytes(out)
    raise MalformedImageError("PNG has no IEND chunk")


def strip_metadata(data: bytes, content_type: str) -> bytes:
    """The file without metadata; the same bytes when there was nothing to remove."""
    if content_type == "image/jpeg":
        return strip_jpeg(data)
    if content_type == "image/png":
        return strip_png(data)
    raise MalformedImageError("unsupported type")
