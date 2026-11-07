import datetime as dt
import uuid
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse
from xml.etree import ElementTree

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import Job, JobReport, ReportPhoto
from app.photos.signing import expiry_for, sign, verify
from app.photos.store import PlaceholderPhotoStore, Variant
from tests.conftest import TEST_DATABASE_URL

SECRET = "unit-test-photo-secret-0123456789-abcdef"
NOW = dt.datetime(2026, 10, 15, 10, 3, tzinfo=dt.UTC)


@pytest.fixture(scope="module")
def session() -> Iterator[Session]:
    engine = create_engine(TEST_DATABASE_URL)
    with Session(engine) as db:
        yield db
    engine.dispose()


@pytest.fixture
def store() -> PlaceholderPhotoStore:
    return PlaceholderPhotoStore(
        secret=SECRET, base_url="http://localhost:8000/", ttl_seconds=900, now=lambda: NOW
    )


def test_every_seeded_photo_renders_valid_small_safe_svg(
    session: Session, store: PlaceholderPhotoStore
) -> None:
    photos = session.scalars(select(ReportPhoto)).all()
    assert len(photos) > 300
    for photo in photos:
        reference = photo.report.job.reference
        for variant in ("thumb", "full"):
            body, content_type = store.render(photo, variant)  # type: ignore[arg-type]
            assert content_type == "image/svg+xml"
            assert len(body) < 6 * 1024, (photo.id, variant, len(body))
            root = ElementTree.fromstring(body)  # parses as XML
            assert root.tag == "{http://www.w3.org/2000/svg}svg"
            text = body.decode()
            assert reference in text
            assert photo.stage.value.capitalize() in text
            assert photo.caption.replace("&", "&amp;") in text
            assert "href" not in text
            assert "url(" not in text
            assert "<script" not in text
            assert "http://" not in text.replace("http://www.w3.org/2000/svg", "")
            assert "https://" not in text


def test_thumb_is_smaller_than_full_with_the_same_viewbox(
    session: Session, store: PlaceholderPhotoStore
) -> None:
    photo = session.scalars(select(ReportPhoto)).first()
    assert photo is not None
    thumb = ElementTree.fromstring(store.render(photo, "thumb")[0])
    full = ElementTree.fromstring(store.render(photo, "full")[0])
    assert thumb.get("viewBox") == full.get("viewBox")
    assert int(thumb.get("width", "0")) * 4 == int(full.get("width", "0"))
    assert full.get("width") == str(photo.width) and full.get("height") == str(photo.height)


def test_render_is_deterministic(session: Session, store: PlaceholderPhotoStore) -> None:
    photo = session.scalars(select(ReportPhoto)).first()
    assert photo is not None
    assert store.render(photo, "full") == store.render(photo, "full")


def test_hostile_caption_is_escaped(session: Session, store: PlaceholderPhotoStore) -> None:
    photo = session.scalars(select(ReportPhoto)).first()
    assert photo is not None
    hostile = "<script>alert(1)</script>&\"'"
    detached = ReportPhoto(
        id=photo.id,
        report_id=photo.report_id,
        stage=photo.stage,
        position=1,
        caption=hostile,
        taken_at=photo.taken_at,
        width=photo.width,
        height=photo.height,
    )
    detached.report = JobReport(job=Job(reference="JP-<9999>&"))
    body, _ = store.render(detached, "full")
    text = body.decode()
    ElementTree.fromstring(body)  # still well formed
    assert "<script" not in text
    assert "&lt;script&gt;" in text
    assert "&amp;" in text
    assert "JP-&lt;9999&gt;&amp;" in text
    assert '"' not in text.split("<title>")[1].split("</title>")[0]


def _parts(url: str) -> tuple[str, str, int, str]:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    photo_id = parsed.path.split("/")[-2]
    return photo_id, query["variant"][0], int(query["exp"][0]), query["sig"][0]


def test_signed_url_verifies_and_rejects_tampering(
    session: Session, store: PlaceholderPhotoStore
) -> None:
    photo = session.scalars(select(ReportPhoto)).first()
    assert photo is not None
    variant: Variant = "thumb"
    url = store.url_for(photo, variant)
    assert url.startswith(f"http://localhost:8000/api/v1/photos/{photo.id}/image?")
    photo_id, got_variant, exp, sig = _parts(url)
    now_ts = int(NOW.timestamp())
    assert photo_id == str(photo.id)
    assert verify(SECRET, photo_id, got_variant, exp, sig, now_ts)
    assert len(sig) == 64

    assert not verify(SECRET, uuid.uuid4(), got_variant, exp, sig, now_ts)
    assert not verify(SECRET, photo_id, "full", exp, sig, now_ts)
    assert not verify(SECRET, photo_id, got_variant, exp + 1, sig, now_ts)
    assert not verify(SECRET, photo_id, got_variant, exp, sig[:-1] + "0", now_ts)
    assert not verify(
        "another-secret-another-secret-0123456789", photo_id, "thumb", exp, sig, now_ts
    )
    # expired: a correctly signed URL whose exp has passed
    old_sig = sign(SECRET, photo_id, "thumb", now_ts - 1)
    assert not verify(SECRET, photo_id, "thumb", now_ts - 1, old_sig, now_ts)
    assert verify(
        SECRET, photo_id, "thumb", now_ts, sign(SECRET, photo_id, "thumb", now_ts), now_ts
    )


def test_urls_are_stable_within_a_ten_minute_bucket(
    session: Session, store: PlaceholderPhotoStore
) -> None:
    photo = session.scalars(select(ReportPhoto)).first()
    assert photo is not None
    later = PlaceholderPhotoStore(
        secret=SECRET,
        base_url="http://localhost:8000",
        ttl_seconds=900,
        now=lambda: NOW + dt.timedelta(minutes=4),
    )
    assert store.url_for(photo, "full") == later.url_for(photo, "full")
    assert expiry_for(1200, 900) == 1200 + 900
    assert expiry_for(1201, 900) == 1800 + 900
