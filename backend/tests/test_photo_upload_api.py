"""T-003g: PUT /operative/jobs/{id}/photos/{photo_id}/content (validate, strip, store once)."""

import io
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.config import DEV_PHOTO_BUCKET
from app.photos.object_store import S3ObjectStore
from app.services import photo_upload
from tests.conftest import FIXED_NOW, bearer, make_token
from tests.contract import assert_contract
from tests.operative_helpers import DAN_EMAIL, PRIYA_EMAIL, temp_job, user_id
from tests.photo_helpers import (
    BASE,
    iso,
    make_jpeg,
    make_png,
    put_content,
    put_registration,
    registration,
    sha256,
)


@pytest.fixture
def dan(db_engine: Any) -> Any:
    return user_id(db_engine, DAN_EMAIL)


def _register(
    client: TestClient,
    headers: dict[str, str],
    job_id: Any,
    data: bytes,
    *,
    content_type: str = "image/jpeg",
    width: int = 64,
    height: int = 48,
    **extra: Any,
) -> str:
    photo_id = str(uuid.uuid4())
    response = put_registration(
        client,
        headers,
        job_id,
        photo_id,
        registration(data, content_type=content_type, width=width, height=height, **extra),
    )
    assert response.status_code == 201, response.text
    return photo_id


def _upload(
    client: TestClient,
    headers: dict[str, str],
    job_id: Any,
    photo_id: Any,
    data: bytes,
    content_type: str = "image/jpeg",
) -> Any:
    response = put_content(client, headers, job_id, photo_id, data, content_type)
    assert_contract(response, "uploadOperativePhotoContent")
    return response


def _row(db_engine: Any, photo_id: Any) -> Any:
    with db_engine.connect() as connection:
        return connection.execute(
            text("SELECT * FROM report_photos WHERE id = :p"), {"p": photo_id}
        ).one()


def _object(photo_storage: Any, key: str) -> dict[str, Any]:
    result: dict[str, Any] = photo_storage.get_object(Bucket=DEV_PHOTO_BUCKET, Key=key)
    result["Body"] = result["Body"].read()
    return result


def _exists(photo_storage: Any, key: str) -> bool:
    try:
        photo_storage.head_object(Bucket=DEV_PHOTO_BUCKET, Key=key)
    except ClientError:
        return False
    return True


def test_upload_stores_the_file_and_a_thumbnail_once(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg(1200, 900)
        photo_id = _register(client, painter_headers, job_id, data, width=1200, height=900)
        response = _upload(client, painter_headers, job_id, photo_id, data)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["received_at"] == iso(FIXED_NOW) and body["thumb_url"]
        assert body["thumb_url"].startswith("http") and "thumb.jpg" in body["thumb_url"]
        assert "location" not in body and "storage_key" not in body

        row = _row(db_engine, photo_id)
        report_id = row.report_id
        base = f"reports/{report_id}/photos/{photo_id}"
        assert (row.storage_key, row.thumb_storage_key) == (f"{base}/full.jpg", f"{base}/thumb.jpg")
        assert row.sha256 == sha256(data) and row.stored_sha256 == sha256(data)  # nothing to strip
        full = _object(photo_storage, row.storage_key)
        assert full["Body"] == data and full["ContentType"] == "image/jpeg"
        assert full["ServerSideEncryption"] == "AES256"
        assert full["ContentDisposition"] == "inline"
        thumb = _object(photo_storage, row.thumb_storage_key)
        assert thumb["ContentType"] == "image/jpeg"
        with Image.open(io.BytesIO(thumb["Body"])) as image:
            assert image.format == "JPEG" and max(image.size) == 480

        # the operative's job now shows it as sent
        detail = client.get(f"{BASE}/{job_id}", headers=painter_headers).json()
        assert detail["report"]["photos"][0]["received_at"] == iso(FIXED_NOW)


def test_the_same_bytes_again_is_200_and_nothing_is_rewritten(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        first = _upload(client, painter_headers, job_id, photo_id, data)
        key = _row(db_engine, photo_id).storage_key
        etag = photo_storage.head_object(Bucket=DEV_PHOTO_BUCKET, Key=key)["LastModified"]
        time.sleep(1.1)
        second = _upload(client, painter_headers, job_id, photo_id, data)
        assert (first.status_code, second.status_code) == (200, 200)
        assert {**first.json(), "thumb_url": None} == {**second.json(), "thumb_url": None}
        assert first.json()["thumb_url"].split("?")[0] == second.json()["thumb_url"].split("?")[0]
        assert photo_storage.head_object(Bucket=DEV_PHOTO_BUCKET, Key=key)["LastModified"] == etag


def test_different_bytes_for_a_stored_photo_are_409_and_the_file_is_not_replaced(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 200
        other = make_jpeg(color=(1, 200, 1))
        response = _upload(client, painter_headers, job_id, photo_id, other)
        assert response.status_code == 409 and response.json()["code"] == "photo_content_mismatch"
        assert _object(photo_storage, _row(db_engine, photo_id).storage_key)["Body"] == data


def test_a_png_is_stored_with_its_own_extension(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_png()
        photo_id = _register(
            client, painter_headers, job_id, data, content_type="image/png", width=40, height=30
        )
        response = _upload(client, painter_headers, job_id, photo_id, data, "image/png")
        assert response.status_code == 200, response.text
        row = _row(db_engine, photo_id)
        assert row.storage_key.endswith("/full.png") and row.content_type == "image/png"
        assert _object(photo_storage, row.storage_key)["ContentType"] == "image/png"
        assert _object(photo_storage, row.thumb_storage_key)["ContentType"] == "image/jpeg"


def test_exif_gps_and_comments_are_removed_from_the_stored_object(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg(gps=True, comment=b"secret comment")
        assert b"Exif" in data
        photo_id = _register(client, painter_headers, job_id, data)
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 200
        row = _row(db_engine, photo_id)
        stored = _object(photo_storage, row.storage_key)["Body"]
        assert b"Exif" not in stored and b"secret comment" not in stored
        assert b"\xff\xe1" not in stored[:200]
        assert row.sha256 == sha256(data) and row.stored_sha256 == sha256(stored)
        assert row.stored_sha256 != row.sha256
        with Image.open(io.BytesIO(stored)) as image:
            assert image.size == (64, 48) and not image.getexif()


def test_png_text_chunks_are_removed(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_png(text=True)
        photo_id = _register(
            client, painter_headers, job_id, data, content_type="image/png", width=40, height=30
        )
        assert (
            _upload(client, painter_headers, job_id, photo_id, data, "image/png").status_code == 200
        )
        row = _row(db_engine, photo_id)
        stored = _object(photo_storage, row.storage_key)["Body"]
        assert b"someone@example.test" not in stored and b"eXIf" not in stored
        assert row.stored_sha256 == sha256(stored) != row.sha256


def test_over_10_mib_is_413_before_the_body_is_read(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        photo_id = _register(client, painter_headers, job_id, make_jpeg())
        big = b"\xff\xd8\xff" + b"0" * (11 * 1024 * 1024)
        response = _upload(client, painter_headers, job_id, photo_id, big)
        assert response.status_code == 413 and response.json()["code"] == "photo_too_large"


def test_a_body_that_outgrows_its_declared_length_limit_is_413(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    """The cap also applies while reading (a chunked body has no Content-Length: 422 first)."""
    with temp_job(db_engine, dan) as job_id:
        photo_id = _register(client, painter_headers, job_id, make_jpeg())

        def chunks() -> Iterator[bytes]:
            yield b"\xff\xd8\xff"

        response = client.put(
            f"{BASE}/{job_id}/photos/{photo_id}/content",
            headers={**painter_headers, "Content-Type": "image/jpeg"},
            content=chunks(),
        )
        assert response.status_code == 422
        assert response.json()["errors"][0]["loc"] == ["header", "content-length"]
        assert_contract(response, "uploadOperativePhotoContent")


@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        (b"GIF89a" + b"0" * 100, "image/gif"),
        (b"just some text", "text/plain"),
        (b"just some text", "image/jpeg"),  # declared JPEG, not one
        (b"\x89PNG\r\n\x1a\n" + b"0" * 50, "image/jpeg"),  # a PNG header declared as JPEG
        (b"\xff\xd8\xff\xe0" + b"0" * 50, "application/octet-stream"),
        (b"", "image/jpeg"),
    ],
)
def test_other_files_are_415(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    data: bytes,
    content_type: str,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        photo_id = _register(client, painter_headers, job_id, make_jpeg())
        response = _upload(client, painter_headers, job_id, photo_id, data, content_type)
        assert response.status_code == 415, response.text
        assert response.json()["code"] == "unsupported_photo_type"
        assert _row(db_engine, photo_id).received_at is None


def test_content_type_must_equal_the_registered_one(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_png()
        photo_id = _register(
            client, painter_headers, job_id, data, content_type="image/png", width=40, height=30
        )
        response = _upload(client, painter_headers, job_id, photo_id, data, "image/jpeg")
        assert response.status_code == 415


def test_a_wrong_checksum_is_422_and_a_retry_with_the_right_file_works(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        damaged = make_jpeg(color=(9, 9, 200))
        response = _upload(client, painter_headers, job_id, photo_id, damaged)
        assert response.status_code == 422 and response.json()["code"] == "checksum_mismatch"
        assert _row(db_engine, photo_id).received_at is None
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 200


def test_dimensions_must_match_the_registration(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg(64, 48)
        photo_id = _register(client, painter_headers, job_id, data, width=65, height=48)
        response = _upload(client, painter_headers, job_id, photo_id, data)
        assert response.status_code == 415 and response.json()["code"] == "unsupported_photo_type"


def test_a_truncated_or_corrupt_jpeg_is_415(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        good = make_jpeg(200, 150)
        for number, broken in enumerate(
            (good[: len(good) // 2], good[:300], good[:2] + b"\xff\xe1\x00\x03x")
        ):
            photo_id = _register(
                client,
                painter_headers,
                job_id,
                broken,
                width=200,
                height=150,
                original=make_jpeg(color=(number, 1, 1)),
            )
            response = _upload(client, painter_headers, job_id, photo_id, broken)
            assert response.status_code == 415, response.text


def test_a_decompression_bomb_is_413(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    """8000 x 8000 is over the 50 million pixel limit (a warning, made an error); 12000 x 12000
    is over twice the limit (Pillow's own error). Both compress to a few kilobytes."""
    with temp_job(db_engine, dan) as job_id:
        for mode, size in (("L", 8000), ("1", 12000)):
            image = Image.new(mode, (size, size))
            out = io.BytesIO()
            image.save(out, format="PNG", optimize=False)
            data = out.getvalue()
            assert len(data) < 10 * 1024 * 1024
            photo_id = _register(
                client,
                painter_headers,
                job_id,
                data,
                content_type="image/png",
                width=4096,
                height=4096,
                original=data,
            )
            response = _upload(client, painter_headers, job_id, photo_id, data, "image/png")
            assert response.status_code == 413, (mode, response.text)
            assert response.json()["code"] == "photo_too_large"


def test_upload_for_an_unknown_or_unregistered_photo_is_404(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        response = _upload(client, painter_headers, job_id, uuid.uuid4(), make_jpeg())
        assert response.status_code == 404


def test_upload_scoping_and_personas(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
) -> None:
    priya = user_id(db_engine, PRIYA_EMAIL)
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        priya_headers = bearer(make_token(priya, role="painter"))
        assert put_content(client, priya_headers, job_id, photo_id, data).status_code == 404
        assert put_content(client, manager_headers, job_id, photo_id, data).status_code == 403
        assert put_content(client, admin_headers, job_id, photo_id, data).status_code == 403
        assert put_content(client, {}, job_id, photo_id, data).status_code == 401
        assert _row(db_engine, photo_id).received_at is None
    with temp_job(db_engine, dan) as other_job, temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        # the right photo id under the wrong job of the same operative
        assert put_content(client, painter_headers, other_job, photo_id, data).status_code == 404


def test_a_late_file_after_submission_is_accepted_and_audited(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("Only",), keep=True) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE job_reports SET state = 'submitted', submitted_at = now(), "
                    "submitted_by_id = painter_id, review_status = 'awaiting_review' "
                    "WHERE job_id = :j"
                ),
                {"j": job_id},
            )
        response = _upload(client, painter_headers, job_id, photo_id, data)
        assert response.status_code == 200
        with db_engine.connect() as connection:
            events = connection.execute(
                text(
                    "SELECT action::text, actor_id, changes FROM audit_events "
                    "WHERE action = 'report.photo_received'"
                )
            ).all()
        assert [(e.action, e.actor_id, e.changes) for e in events] == [
            ("report.photo_received", dan, [])
        ]
        # a repeat does not audit again
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 200
        with db_engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM audit_events WHERE action = 'report.photo_received'")
                ).scalar()
                == 1
            )


# ---- deletion with stored files ----------------------------------------------------------------
def test_delete_before_the_file_arrives_then_a_late_upload_is_404(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        assert (
            client.delete(f"{BASE}/{job_id}/photos/{photo_id}", headers=painter_headers).status_code
            == 204
        )
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 404


def test_delete_after_the_file_arrived_removes_both_objects(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 200
        row = _row(db_engine, photo_id)
        assert _exists(photo_storage, row.storage_key) and _exists(
            photo_storage, row.thumb_storage_key
        )
        assert (
            client.delete(f"{BASE}/{job_id}/photos/{photo_id}", headers=painter_headers).status_code
            == 204
        )
        assert not _exists(photo_storage, row.storage_key)
        assert not _exists(photo_storage, row.thumb_storage_key)


def test_a_failed_object_delete_is_logged_with_the_photo_id_only(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        assert _upload(client, painter_headers, job_id, photo_id, data).status_code == 200
        store = client.app.state.object_store  # type: ignore[attr-defined]

        def broken(key: str) -> None:
            raise ConnectionError("boom with secret-bucket-detail")

        original = store.delete
        store.delete = broken
        try:
            with caplog.at_level("WARNING", logger="jobproof.photos"):
                response = client.delete(
                    f"{BASE}/{job_id}/photos/{photo_id}", headers=painter_headers
                )
        finally:
            store.delete = original
        assert response.status_code == 204  # the row is gone; the orphan object is harmless
        messages = [r.getMessage() for r in caplog.records if r.name == "jobproof.photos"]
        assert messages and all(photo_id in m and "secret-bucket-detail" not in m for m in messages)


# ---- concurrency -------------------------------------------------------------------------------
def test_five_parallel_uploads_with_a_limit_of_four_give_exactly_one_503(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        ids = []
        files = []
        for number in range(5):
            data = make_jpeg(color=(number * 40, 7, 7))
            ids.append(_register(client, painter_headers, job_id, data))
            files.append(data)
        gate = threading.Event()
        entered = threading.Semaphore(0)
        real = photo_upload._store

        def slow(*args: Any, **kwargs: Any) -> Any:
            entered.release()
            gate.wait(10)
            return real(*args, **kwargs)

        monkeypatch.setattr(photo_upload, "_store", slow)
        results: list[Any] = [None] * 5

        def send(index: int) -> None:
            results[index] = put_content(client, painter_headers, job_id, ids[index], files[index])

        threads = [threading.Thread(target=send, args=(i,)) for i in range(5)]
        for thread in threads[:4]:
            thread.start()
        for _ in range(4):
            assert entered.acquire(timeout=10)  # four uploads are now inside
        threads[4].start()
        threads[4].join(10)  # the fifth is refused at once, without waiting for a slot
        assert results[4].status_code == 503
        assert results[4].headers["Retry-After"] == "5" and results[4].json()["code"] == "busy"
        assert_contract(results[4], "uploadOperativePhotoContent")
        gate.set()
        for thread in threads[:4]:
            thread.join(30)
        assert [r.status_code for r in results[:4]] == [200] * 4
        # the refused photo can be sent once there is room
        monkeypatch.setattr(photo_upload, "_store", real)
        assert put_content(client, painter_headers, job_id, ids[4], files[4]).status_code == 200


def test_two_uploads_of_the_same_photo_at_once_store_one_object(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    photo_storage: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg()
        photo_id = _register(client, painter_headers, job_id, data)
        results: list[Any] = [None, None]

        def send(index: int) -> None:
            results[index] = put_content(client, painter_headers, job_id, photo_id, data)

        threads = [threading.Thread(target=send, args=(i,)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        assert [r.status_code for r in results] == [200, 200]
        prefix = f"reports/{_row(db_engine, photo_id).report_id}/photos/{photo_id}/"
        listing = photo_storage.list_objects_v2(Bucket=DEV_PHOTO_BUCKET, Prefix=prefix)
        assert sorted(o["Key"] for o in listing["Contents"]) == [
            prefix + "full.jpg",
            prefix + "thumb.jpg",
        ]


def test_the_object_store_presigns_against_the_public_endpoint() -> None:
    store = S3ObjectStore(
        bucket="photos-bucket",
        region="eu-west-2",
        endpoint_url="http://photos:8333",
        public_endpoint_url="http://localhost:8333",
        addressing_style="path",
    )
    url = store.presign_get("reports/r/photos/p/full.jpg", 900)
    assert url.startswith("http://localhost:8333/photos-bucket/reports/r/photos/p/full.jpg?")
    assert "X-Amz-Expires=900" in url and "X-Amz-Signature=" in url
    virtual = S3ObjectStore(bucket="photos-bucket", region="eu-west-2", addressing_style="virtual")
    assert virtual.presign_get("k.jpg", 60).startswith(
        "https://photos-bucket.s3.eu-west-2.amazonaws.com/k.jpg?"
    )
