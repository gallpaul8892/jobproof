"""PhotoStore strategy: where photo bytes and URLs come from.

Seeded photos (`registered_at` null) use `PlaceholderPhotoStore` (generated SVG, no files, no
network). Photos uploaded from the app (T-003g) have files in the `ObjectStore`; the
`DispatchingPhotoStore` hands out presigned GET URLs for them and delegates the rest.
"""

import datetime as dt
import textwrap
from collections.abc import Callable
from typing import Literal, Protocol
from urllib.parse import urlencode
from xml.sax.saxutils import escape

from app.clock import LONDON
from app.models import ReportPhoto
from app.models.enums import PhotoStage
from app.photos.object_store import ObjectStore
from app.photos.signing import expiry_for, sign

Variant = Literal["thumb", "full"]
SVG_CONTENT_TYPE = "image/svg+xml"

_STAGE_STYLE = {
    PhotoStage.before: ("Before", "#8a97a8", "#aab5c3", "#6f7c8d"),
    PhotoStage.during: ("During", "#d9a441", "#ebc680", "#b98727"),
    PhotoStage.after: ("After", "#5f9e6e", "#92c59c", "#487c55"),
}
_THUMB_DIVISOR = 4
_MAX_CAPTION_LINES = 3
_XML_ENTITIES = {'"': "&quot;", "'": "&apos;"}


class PhotoStore(Protocol):
    def url_for(self, photo: ReportPhoto, variant: Variant) -> str: ...

    def render(self, photo: ReportPhoto, variant: Variant) -> tuple[bytes, str]: ...


def _esc(value: str) -> str:
    return escape(value, _XML_ENTITIES)


def _caption_lines(caption: str, width: int) -> list[str]:
    lines = textwrap.wrap(caption, width=width, break_long_words=True)
    if len(lines) > _MAX_CAPTION_LINES:
        lines = lines[:_MAX_CAPTION_LINES]
        lines[-1] = lines[-1][: width - 1].rstrip() + "…"
    return lines or [""]


def _illustration(kind: int, w: int, h: int, wall: str, accent: str) -> str:
    """A simple room: wall, floor and one feature chosen by `kind` (0 window, 1 door, 2 frame)."""
    floor_y = round(h * 0.72)
    parts = [
        f'<rect y="{floor_y}" width="{w}" height="{h - floor_y}" fill="{accent}"/>',
        f'<rect y="{floor_y - round(h * 0.03)}" width="{w}" height="{round(h * 0.03)}" '
        f'fill="#f4f1ea"/>',
    ]
    if kind == 0:
        x, y, fw, fh = round(w * 0.55), round(h * 0.14), round(w * 0.3), round(h * 0.34)
        parts.append(f'<rect x="{x}" y="{y}" width="{fw}" height="{fh}" fill="#f4f1ea"/>')
        parts.append(
            f'<rect x="{x + 12}" y="{y + 12}" width="{fw - 24}" height="{fh - 24}" fill="#cfe3ee"/>'
        )
        parts.append(
            f'<rect x="{x + fw // 2 - 4}" y="{y + 12}" width="8" height="{fh - 24}" '
            f'fill="#f4f1ea"/>'
        )
    elif kind == 1:
        x, y, fw, fh = round(w * 0.12), round(h * 0.1), round(w * 0.22), floor_y - round(h * 0.1)
        parts.append(f'<rect x="{x}" y="{y}" width="{fw}" height="{fh}" fill="#f4f1ea"/>')
        parts.append(
            f'<rect x="{x + 14}" y="{y + 14}" width="{fw - 28}" height="{fh - 14}" '
            f'fill="{accent}"/>'
        )
        parts.append(f'<circle cx="{x + fw - 34}" cy="{y + fh // 2}" r="9" fill="#c9b27c"/>')
    else:
        x, y, fw, fh = round(w * 0.35), round(h * 0.16), round(w * 0.3), round(h * 0.22)
        parts.append(f'<rect x="{x}" y="{y}" width="{fw}" height="{fh}" fill="#f4f1ea"/>')
        parts.append(
            f'<rect x="{x + 14}" y="{y + 14}" width="{fw - 28}" height="{fh - 28}" fill="{wall}" '
            f'opacity="0.55"/>'
        )
    return "".join(parts)


class PlaceholderPhotoStore:
    """Renders a deterministic SVG from the photo row. Offline, safe, a few KB each."""

    def __init__(
        self,
        *,
        secret: str,
        base_url: str,
        ttl_seconds: int,
        now: Callable[[], dt.datetime],
    ) -> None:
        self._secret = secret
        self._base_url = base_url.rstrip("/")
        self._ttl = ttl_seconds
        self._now = now

    def url_for(self, photo: ReportPhoto, variant: Variant) -> str:
        exp = expiry_for(int(self._now().timestamp()), self._ttl)
        query = urlencode(
            {"variant": variant, "exp": exp, "sig": sign(self._secret, photo.id, variant, exp)}
        )
        return f"{self._base_url}/api/v1/photos/{photo.id}/image?{query}"

    def render(self, photo: ReportPhoto, variant: Variant) -> tuple[bytes, str]:
        w, h = photo.width, photo.height
        label, bg, wall, accent = _STAGE_STYLE[photo.stage]
        reference = photo.report.job.reference
        taken = photo.taken_at.astimezone(LONDON)
        stamp = f"{taken.day} {taken:%b %Y}, {taken:%H:%M}"
        out_w, out_h = (w // _THUMB_DIVISOR, h // _THUMB_DIVISOR) if variant == "thumb" else (w, h)
        font = round(min(w, h) * 0.04)
        lines = _caption_lines(photo.caption, width=max(20, round(w * 0.9 / (font * 0.56))))
        bar_h = font * (len(lines) + 3)
        bar_y = h - bar_h
        kind = photo.id.int % 3
        text_x = round(w * 0.04)
        text = [
            f'<text x="{text_x}" y="{bar_y + font + 6}" font-size="{font}" font-weight="700">'
            f"{_esc(reference)} · {label}</text>"
        ]
        for index, line in enumerate(lines):
            text.append(
                f'<text x="{text_x}" y="{bar_y + font * (index + 2) + 10}" font-size="{font}">'
                f"{_esc(line)}</text>"
            )
        text.append(
            f'<text x="{text_x}" y="{bar_y + font * (len(lines) + 2) + 14}" '
            f'font-size="{round(font * 0.8)}" opacity="0.85">{_esc(stamp)}</text>'
        )
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{out_w}" height="{out_h}" '
            f'viewBox="0 0 {w} {h}" role="img">'
            f"<title>{_esc(reference)} {label}: {_esc(photo.caption)}</title>"
            f'<rect width="{w}" height="{h}" fill="{wall}"/>'
            f"{_illustration(kind, w, h, bg, accent)}"
            f'<rect y="{bar_y}" width="{w}" height="{bar_h}" fill="#1f2933" opacity="0.82"/>'
            f'<g fill="white" font-family="sans-serif">{"".join(text)}</g>'
            f"</svg>"
        )
        return svg.encode(), SVG_CONTENT_TYPE


class DispatchingPhotoStore:
    """Chooses per photo: placeholder URL when never registered, else a presigned object URL."""

    def __init__(
        self, placeholder: PlaceholderPhotoStore, objects: ObjectStore, ttl_seconds: int
    ) -> None:
        self._placeholder = placeholder
        self._objects = objects
        self._ttl = ttl_seconds

    def url_for(self, photo: ReportPhoto, variant: Variant) -> str:
        if photo.registered_at is None:
            return self._placeholder.url_for(photo, variant)
        key = photo.thumb_storage_key if variant == "thumb" else photo.storage_key
        key = key or photo.storage_key or photo.thumb_storage_key
        if key is None:  # registered but not received: managers are never shown these
            raise ValueError("photo has no stored file")
        return self._objects.presign_get(key, self._ttl)

    def thumb_url_if_received(self, photo: ReportPhoto) -> str | None:
        """The operative's thumbnail link: null until the file has arrived."""
        if photo.received_at is None or photo.thumb_storage_key is None:
            return None
        return self._objects.presign_get(photo.thumb_storage_key, self._ttl)

    def render(self, photo: ReportPhoto, variant: Variant) -> tuple[bytes, str]:
        return self._placeholder.render(photo, variant)
