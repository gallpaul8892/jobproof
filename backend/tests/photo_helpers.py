"""Helpers for photo tests: real tiny JPEG/PNG files (built with Pillow) and request bodies."""

import datetime as dt
import hashlib
import io
import random
import uuid
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin

from tests.conftest import FIXED_NOW

BASE = "/api/v1/operative/jobs"


def make_jpeg(
    width: int = 64,
    height: int = 48,
    *,
    color: tuple[int, int, int] = (200, 30, 30),
    gps: bool = False,
    comment: bytes | None = None,
) -> bytes:
    """A small JPEG; `gps` embeds EXIF GPS coordinates, `comment` a COM segment."""
    image = Image.new("RGB", (width, height), color)
    noise = random.Random(color[0] * 65536 + color[1] * 256 + color[2])  # noqa: S311 - test data
    for _ in range(40):  # texture, so every colour gives different bytes whatever the quantiser
        image.putpixel(
            (noise.randrange(width), noise.randrange(height)),
            (noise.randrange(256), noise.randrange(256), noise.randrange(256)),
        )
    kwargs: dict[str, Any] = {"quality": 80}
    if gps:
        exif = Image.Exif()
        exif[0x010F] = "TestMaker"
        exif[0x8825] = {
            1: "N",
            2: (51.0, 27.0, 54.0),
            3: "W",
            4: (2.0, 35.0, 46.0),
        }
        kwargs["exif"] = exif
    if comment is not None:
        kwargs["comment"] = comment
    out = io.BytesIO()
    image.save(out, format="JPEG", **kwargs)
    return out.getvalue()


def make_png(width: int = 40, height: int = 30, *, text: bool = False) -> bytes:
    image = Image.new("RGB", (width, height), (10, 120, 200))
    info = PngImagePlugin.PngInfo()
    if text:
        info.add_text("Author", "someone@example.test")
        info.add_itxt("Description", "a private description")
    exif = Image.Exif()
    exif[0x010F] = "TestMaker"
    out = io.BytesIO()
    image.save(out, format="PNG", pnginfo=info, exif=exif if text else None)
    return out.getvalue()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iso(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).isoformat().replace("+00:00", "Z")


def registration(
    data: bytes,
    *,
    stage: str = "before",
    width: int = 64,
    height: int = 48,
    content_type: str = "image/jpeg",
    taken_at: dt.datetime | None = None,
    sent_at: dt.datetime | None = None,
    original: bytes | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """A PhotoRegistration body for `data` (the upload copy). `extra` overrides or adds keys."""
    taken = taken_at or FIXED_NOW - dt.timedelta(hours=1)
    sent = sent_at or FIXED_NOW
    big = original if original is not None else data
    body: dict[str, Any] = {
        "stage": stage,
        "source": "camera",
        "taken_at": iso(taken),
        "taken_at_source": "device_clock",
        "device_sent_at": iso(sent),
        "original": {
            "width": width * 2,
            "height": height * 2,
            "bytes": len(big) + 1000,
            "sha256": sha256(big),
        },
        "upload": {
            "width": width,
            "height": height,
            "bytes": len(data),
            "sha256": sha256(data),
            "content_type": content_type,
        },
    }
    body.update(extra)
    return body


def put_registration(
    client: TestClient, headers: dict[str, str], job_id: Any, photo_id: Any, body: Any
) -> Any:
    return client.put(f"{BASE}/{job_id}/photos/{photo_id}", headers=headers, json=body)


def put_content(
    client: TestClient,
    headers: dict[str, str],
    job_id: Any,
    photo_id: Any,
    data: bytes,
    content_type: str = "image/jpeg",
) -> Any:
    return client.put(
        f"{BASE}/{job_id}/photos/{photo_id}/content",
        headers={**headers, "Content-Type": content_type},
        content=data,
    )


def send_photo(
    client: TestClient,
    headers: dict[str, str],
    job_id: Any,
    *,
    stage: str = "before",
    color: tuple[int, int, int] = (200, 30, 30),
    upload: bool = True,
    **extra: Any,
) -> dict[str, Any]:
    """Register (and by default upload) one fresh JPEG; returns id, bytes and the responses."""
    photo_id = str(uuid.uuid4())
    data = make_jpeg(color=color)
    registered = put_registration(
        client, headers, job_id, photo_id, registration(data, stage=stage, **extra)
    )
    assert registered.status_code in (200, 201), registered.text
    result: dict[str, Any] = {"id": photo_id, "data": data, "registered": registered}
    if upload:
        uploaded = put_content(client, headers, job_id, photo_id, data)
        assert uploaded.status_code == 200, uploaded.text
        result["uploaded"] = uploaded
    return result
