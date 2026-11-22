"""T-003g: PUT /operative/jobs/{id}/photos/{photo_id} (register, repeat, update) and DELETE."""

import datetime as dt
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.models.enums import JobStatus, ReportState
from tests.conftest import FIXED_NOW, bearer, make_token
from tests.contract import assert_contract
from tests.operative_helpers import DAN_EMAIL, PRIYA_EMAIL, temp_job, user_id
from tests.photo_helpers import (
    BASE,
    iso,
    make_jpeg,
    put_registration,
    registration,
    send_photo,
)


def _put(client: TestClient, headers: dict[str, str], job_id: Any, photo_id: Any, body: Any) -> Any:
    response = put_registration(client, headers, job_id, photo_id, body)
    if response.status_code in (200, 201, 401, 403, 404, 409, 422):
        assert_contract(response, "registerOperativePhoto")
    return response


def _items(client: TestClient, headers: dict[str, str], job_id: Any) -> dict[str, str]:
    body = client.get(f"{BASE}/{job_id}", headers=headers).json()
    return {i["label"]: i["id"] for i in body["checklist"]}


def _new(stage: str = "before", color: tuple[int, int, int] = (200, 30, 30)) -> tuple[str, bytes]:
    return str(uuid.uuid4()), make_jpeg(color=color)


@pytest.fixture
def dan(db_engine: Any) -> Any:
    return user_id(db_engine, DAN_EMAIL)


def test_first_registration_creates_the_draft_and_the_photo(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        photo_id, data = _new()
        sent = FIXED_NOW - dt.timedelta(seconds=90)
        body = registration(data, caption="  Hallway wall  ", sent_at=sent)
        response = _put(client, painter_headers, job_id, photo_id, body)
        assert response.status_code == 201, response.text
        photo = response.json()
        assert photo == {
            "id": photo_id,
            "stage": "before",
            "checklist_item_id": None,
            "caption": "Hallway wall",
            "source": "camera",
            "taken_at": body["taken_at"],
            "taken_at_source": "device_clock",
            "registered_at": iso(FIXED_NOW),
            "received_at": None,
            "clock_offset_seconds": 90,
            "thumb_url": None,
        }
        detail = client.get(f"{BASE}/{job_id}", headers=painter_headers).json()
        assert detail["status"] == "in_progress" and detail["report"]["state"] == "draft"
        assert [p["id"] for p in detail["report"]["photos"]] == [photo_id]
        with db_engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT width, height, position, content_type, upload_bytes, sha256, "
                    "original_width, original_sha256, received_at, registered_by_id "
                    "FROM report_photos WHERE id = :p"
                ),
                {"p": photo_id},
            ).one()
        assert (row.width, row.height, row.position) == (64, 48, 1)
        assert row.content_type == "image/jpeg" and row.upload_bytes == len(data)
        assert row.sha256 == body["upload"]["sha256"] and row.original_width == 128
        assert row.received_at is None and row.registered_by_id == dan


def test_repeating_the_same_registration_is_200_and_changes_nothing(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        photo_id, data = _new()
        body = registration(data)
        first = _put(client, painter_headers, job_id, photo_id, body)
        later = FIXED_NOW  # the clock is fixed: a repeat is identical, registered_at is kept
        second = _put(client, painter_headers, job_id, photo_id, body)
        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json() == second.json() and first.json()["registered_at"] == iso(later)
        detail = client.get(f"{BASE}/{job_id}", headers=painter_headers).json()
        assert len(detail["report"]["photos"]) == 1


def test_stage_item_and_caption_can_change_while_a_draft(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        item = _items(client, painter_headers, job_id)["First"]
        photo_id, data = _new()
        _put(client, painter_headers, job_id, photo_id, registration(data))
        changed = registration(
            data, stage="during", caption="Now with item", checklist_item_id=item
        )
        response = _put(client, painter_headers, job_id, photo_id, changed)
        assert response.status_code == 200
        assert response.json()["stage"] == "during"
        assert response.json()["checklist_item_id"] == item
        assert response.json()["caption"] == "Now with item"
        # the full representation: leaving the item and caption out clears them
        cleared = registration(data, stage="during")
        response = _put(client, painter_headers, job_id, photo_id, cleared)
        assert response.json()["checklist_item_id"] is None and response.json()["caption"] == ""
        photos = client.get(f"{BASE}/{job_id}", headers=painter_headers).json()["report"]["photos"]
        assert [p["stage"] for p in photos] == ["during"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(source="gallery"),
        lambda b: b.update(taken_at_source="added_time"),
        lambda b: b.update(taken_at="2026-10-14T08:00:00Z"),
        lambda b: b["original"].update(sha256="a" * 64),
        lambda b: b["original"].update(bytes=5),
        lambda b: b["upload"].update(sha256="b" * 64),
        lambda b: b["upload"].update(width=63),
        lambda b: b["upload"].update(content_type="image/png"),
        lambda b: b.update(
            location={"latitude": 1.0, "longitude": 2.0, "accuracy_m": 3.0, "source": "device"}
        ),
    ],
)
def test_an_evidence_field_that_differs_is_409_photo_content_mismatch(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    mutate: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        photo_id, data = _new()
        body = registration(data)
        assert _put(client, painter_headers, job_id, photo_id, body).status_code == 201
        other = registration(data)
        mutate(other)
        response = _put(client, painter_headers, job_id, photo_id, other)
        assert response.status_code == 409 and response.json()["code"] == "photo_content_mismatch"


def test_a_photo_id_already_used_on_another_job_is_409(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as first, temp_job(db_engine, dan) as second:
        photo_id, data = _new()
        body = registration(data)
        assert _put(client, painter_headers, first, photo_id, body).status_code == 201
        response = _put(client, painter_headers, second, photo_id, body)
        assert response.status_code == 409 and response.json()["code"] == "photo_content_mismatch"


def test_the_same_original_twice_in_one_report_is_409_duplicate_photo(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id, temp_job(db_engine, dan) as other_job:
        first_id, data = _new()
        original = make_jpeg(300, 200)
        assert (
            _put(
                client, painter_headers, job_id, first_id, registration(data, original=original)
            ).status_code
            == 201
        )
        second_id, data2 = _new(color=(1, 2, 3))
        response = _put(
            client, painter_headers, job_id, second_id, registration(data2, original=original)
        )
        assert response.status_code == 409 and response.json()["code"] == "duplicate_photo"
        assert response.json()["existing_photo_id"] == first_id
        # the same original on a different job is fine
        assert (
            _put(
                client,
                painter_headers,
                other_job,
                second_id,
                registration(data2, original=original),
            ).status_code
            == 201
        )


def test_limit_of_60_photos_per_report(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        for number in range(60):
            photo_id, data = _new(color=(number, 5, 5))
            response = _put(client, painter_headers, job_id, photo_id, registration(data))
            assert response.status_code == 201, (number, response.text)
        photo_id, data = _new(color=(100, 100, 100))
        response = _put(client, painter_headers, job_id, photo_id, registration(data))
        assert response.status_code == 409 and response.json()["code"] == "photo_limit_reached"
        # a repeat of one that exists is still fine
        again = _put(client, painter_headers, job_id, str(uuid.uuid4()), registration(data))
        assert again.status_code == 409


def test_limit_of_12_photos_per_checklist_item(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        item = _items(client, painter_headers, job_id)["First"]
        for number in range(12):
            photo_id, data = _new(color=(number, 9, 9))
            response = _put(
                client,
                painter_headers,
                job_id,
                photo_id,
                registration(data, checklist_item_id=item),
            )
            assert response.status_code == 201, (number, response.text)
        photo_id, data = _new(color=(50, 50, 50))
        response = _put(
            client, painter_headers, job_id, photo_id, registration(data, checklist_item_id=item)
        )
        assert response.status_code == 409 and response.json()["code"] == "photo_limit_reached"
        # without an item it is fine, and moving it onto the full item is refused
        assert (
            _put(client, painter_headers, job_id, photo_id, registration(data)).status_code == 201
        )
        moved = _put(
            client, painter_headers, job_id, photo_id, registration(data, checklist_item_id=item)
        )
        assert moved.status_code == 409 and moved.json()["code"] == "photo_limit_reached"


def test_a_checklist_item_of_another_job_is_422(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id, temp_job(db_engine, dan) as other:
        foreign = _items(client, painter_headers, other)["First"]
        photo_id, data = _new()
        response = _put(
            client, painter_headers, job_id, photo_id, registration(data, checklist_item_id=foreign)
        )
        assert response.status_code == 422
        assert response.json()["errors"][0]["loc"] == ["body", "checklist_item_id"]


def test_a_photo_can_prove_a_removed_item(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, removed=("Old item",)) as job_id:
        with db_engine.connect() as connection:
            removed = connection.execute(
                text("SELECT id FROM job_checklist_items WHERE job_id = :j AND label = 'Old item'"),
                {"j": job_id},
            ).scalar_one()
        photo_id, data = _new()
        response = _put(
            client,
            painter_headers,
            job_id,
            photo_id,
            registration(data, checklist_item_id=str(removed)),
        )
        assert response.status_code == 201
        detail = client.get(f"{BASE}/{job_id}", headers=painter_headers).json()
        assert [(i["label"], i["removed"]) for i in detail["checklist"]][-1] == ("Old item", True)


@pytest.mark.parametrize(
    ("change", "loc"),
    [
        ({"stage": "later"}, ["body", "stage"]),
        ({"caption": "x" * 141}, ["body", "caption"]),
        ({"caption": "two\nlines"}, ["body", "caption"]),
        ({"taken_at": "2026-10-15T09:00:00"}, ["body", "taken_at"]),  # no time zone
        ({"surprise": 1}, ["body", "surprise"]),
        ({"source": "scanner"}, ["body", "source"]),
        (
            {"location": {"latitude": 91, "longitude": 0, "accuracy_m": 1, "source": "device"}},
            ["body", "location", "latitude"],
        ),
        (
            {"location": {"latitude": 1, "longitude": 0, "accuracy_m": 1}},
            ["body", "location", "source"],
        ),
    ],
)
def test_invalid_registrations_are_422(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    change: dict[str, Any],
    loc: list[str],
) -> None:
    with temp_job(db_engine, dan) as job_id:
        _, data = _new()
        body = registration(data)
        body.update(change)
        response = _put(client, painter_headers, job_id, str(uuid.uuid4()), body)
        assert response.status_code == 422, response.text
        assert loc in [e["loc"] for e in response.json()["errors"]]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["upload"].update(width=5000),
        lambda b: b["upload"].update(bytes=10485761),
        lambda b: b["upload"].update(content_type="image/gif"),
        lambda b: b["upload"].update(sha256="ABC"),
        lambda b: b["original"].update(width=0),
        lambda b: b.pop("original"),
        lambda b: b.pop("device_sent_at"),
    ],
)
def test_invalid_file_facts_are_422(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, mutate: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        _, data = _new()
        body = registration(data)
        mutate(body)
        assert _put(client, painter_headers, job_id, str(uuid.uuid4()), body).status_code == 422


def test_a_job_that_is_not_the_callers_is_404_and_nothing_is_created(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    priya = user_id(db_engine, PRIYA_EMAIL)
    with temp_job(db_engine, priya) as job_id:
        _, data = _new()
        photo_id = str(uuid.uuid4())
        response = _put(client, painter_headers, job_id, photo_id, registration(data))
        assert response.status_code == 404
        with db_engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM job_reports WHERE job_id = :j"), {"j": job_id}
                ).scalar()
                == 0
            )
        priya_headers = bearer(make_token(priya, role="painter"))
        assert _put(client, priya_headers, job_id, photo_id, registration(data)).status_code == 201


def test_other_personas_and_anonymous_callers_are_refused(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        _, data = _new()
        body = registration(data)
        url = f"{BASE}/{job_id}/photos/{uuid.uuid4()}"
        assert client.put(url, headers=manager_headers, json=body).status_code == 403
        assert client.put(url, headers=admin_headers, json=body).status_code == 403
        assert client.put(url, json=body).status_code == 401
        assert client.delete(url, headers=manager_headers).status_code == 403
        assert client.delete(url).status_code == 401
        assert (
            client.put(
                f"{BASE}/not-a-uuid/photos/{uuid.uuid4()}", headers=painter_headers, json=body
            ).status_code
            == 422
        )


def test_cancelled_and_closed_jobs_refuse_registration(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    for status, code in (
        (JobStatus.cancelled, "job_cancelled"),
        (JobStatus.completed, "job_closed"),
    ):
        with temp_job(db_engine, dan, status=status) as job_id:
            _, data = _new()
            response = _put(client, painter_headers, job_id, str(uuid.uuid4()), registration(data))
            assert response.status_code == 409 and response.json()["code"] == code


def test_after_submission_an_identical_repeat_is_200_and_any_change_is_409(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, report=ReportState.draft) as job_id:
        photo_id, data = _new()
        body = registration(data)
        assert _put(client, painter_headers, job_id, photo_id, body).status_code == 201
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE job_reports SET state = 'submitted', submitted_at = now(), "
                    "submitted_by_id = painter_id, review_status = 'awaiting_review' "
                    "WHERE job_id = :j"
                ),
                {"j": job_id},
            )
            connection.execute(
                text(
                    "UPDATE jobs SET status = 'completed', completed_on = scheduled_start "
                    "WHERE id = :j"
                ),
                {"j": job_id},
            )
        assert _put(client, painter_headers, job_id, photo_id, body).status_code == 200
        changed = registration(data, caption="changed")
        response = _put(client, painter_headers, job_id, photo_id, changed)
        assert response.status_code == 409 and response.json()["code"] == "report_submitted"
        assert "submitted_at" in response.json()
        new_id, data2 = _new(color=(9, 9, 9))
        response = _put(client, painter_headers, job_id, new_id, registration(data2))
        assert response.status_code == 409 and response.json()["code"] == "report_submitted"


# ---- delete -----------------------------------------------------------------------------------
def _count(db_engine: Any, job_id: Any) -> int:
    with db_engine.connect() as connection:
        return int(
            connection.execute(
                text(
                    "SELECT count(*) FROM report_photos p JOIN job_reports r ON r.id = p.report_id "
                    "WHERE r.job_id = :j"
                ),
                {"j": job_id},
            ).scalar_one()
        )


def test_delete_removes_the_row_and_is_idempotent(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        photo_id, data = _new()
        _put(client, painter_headers, job_id, photo_id, registration(data))
        url = f"{BASE}/{job_id}/photos/{photo_id}"
        first = client.delete(url, headers=painter_headers)
        assert first.status_code == 204 and first.content == b""
        assert_contract(first, "deleteOperativePhoto")
        assert _count(db_engine, job_id) == 0
        assert client.delete(url, headers=painter_headers).status_code == 204
        unknown = client.delete(f"{BASE}/{job_id}/photos/{uuid.uuid4()}", headers=painter_headers)
        assert unknown.status_code == 204


def test_delete_never_touches_a_photo_of_another_job_or_operative(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    priya = user_id(db_engine, PRIYA_EMAIL)
    with (
        temp_job(db_engine, dan) as mine,
        temp_job(db_engine, dan) as other,
        temp_job(db_engine, priya) as hers,
    ):
        photo_id, data = _new()
        _put(client, painter_headers, mine, photo_id, registration(data))
        # the id on a different job of the same operative: 204, nothing deleted
        assert (
            client.delete(f"{BASE}/{other}/photos/{photo_id}", headers=painter_headers).status_code
            == 204
        )
        assert _count(db_engine, mine) == 1
        # another operative's job: 404
        assert (
            client.delete(f"{BASE}/{hers}/photos/{photo_id}", headers=painter_headers).status_code
            == 404
        )


def test_delete_after_submission_is_409_but_an_unknown_id_is_still_204(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, report=ReportState.draft) as job_id:
        photo_id, data = _new()
        _put(client, painter_headers, job_id, photo_id, registration(data))
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE job_reports SET state = 'submitted', submitted_at = now(), "
                    "submitted_by_id = painter_id, review_status = 'awaiting_review' "
                    "WHERE job_id = :j"
                ),
                {"j": job_id},
            )
        response = client.delete(f"{BASE}/{job_id}/photos/{photo_id}", headers=painter_headers)
        assert response.status_code == 409 and response.json()["code"] == "report_submitted"
        assert_contract(response, "deleteOperativePhoto")
        assert _count(db_engine, job_id) == 1
        unknown = client.delete(f"{BASE}/{job_id}/photos/{uuid.uuid4()}", headers=painter_headers)
        assert unknown.status_code == 204


def test_send_photo_helper_round_trip(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        sent = send_photo(client, painter_headers, job_id, stage="after")
        assert sent["uploaded"].json()["received_at"] == iso(FIXED_NOW)
