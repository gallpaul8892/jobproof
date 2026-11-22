"""T-003k: the manager's evidence fields, the operative's absence of location, drafts hidden."""

import datetime as dt
import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import get_settings
from app.models.enums import ReportState
from app.photos.signing import sign
from tests.conftest import FIXED_NOW
from tests.contract import assert_contract
from tests.operative_helpers import DAN_EMAIL, temp_job, user_id
from tests.photo_helpers import (
    BASE,
    iso,
    make_jpeg,
    put_content,
    put_registration,
    registration,
    send_photo,
)
from tests.test_submit_api import _body, _items, _submit, _tick_all

MANAGER = "/api/v1/manager"
LOCATION = {"latitude": 51.46512, "longitude": -2.59603, "accuracy_m": 12.5, "source": "device"}


@pytest.fixture
def dan(db_engine: Any) -> Any:
    return user_id(db_engine, DAN_EMAIL)


def _keys(node: Any) -> set[str]:
    if isinstance(node, dict):
        return set(node) | {k for v in node.values() for k in _keys(v)}
    if isinstance(node, list):
        return {k for v in node for k in _keys(v)}
    return set()


def _manager_detail(client: TestClient, headers: dict[str, str], report_id: str) -> dict[str, Any]:
    response = client.get(f"{MANAGER}/reports/{report_id}", headers=headers)
    assert response.status_code == 200, response.text
    assert_contract(response, "getManagerReport")
    body: dict[str, Any] = response.json()
    return body


def test_manager_sees_the_evidence_of_an_uploaded_photo(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("Mask",), keep=True) as job_id:
        _tick_all(client, painter_headers, job_id)
        item = _items(client, painter_headers, job_id)["Mask"]
        taken = FIXED_NOW - dt.timedelta(hours=2)
        behind = FIXED_NOW - dt.timedelta(days=3)  # the phone's clock is three days slow
        before = send_photo(
            client,
            painter_headers,
            job_id,
            stage="before",
            color=(11, 22, 33),
            taken_at=taken,
            sent_at=behind,
            checklist_item_id=item,
            caption="Wall before",
            location=LOCATION,
        )
        gallery = send_photo(
            client,
            painter_headers,
            job_id,
            stage="after",
            color=(33, 22, 11),
            source="gallery",
            taken_at_source="file_metadata",
        )
        added = send_photo(
            client,
            painter_headers,
            job_id,
            stage="during",
            color=(44, 55, 66),
            source="gallery",
            taken_at_source="added_time",
        )
        ids = [before["id"], gallery["id"], added["id"]]
        sent = FIXED_NOW - dt.timedelta(minutes=7)
        body = _body(ids, sent_at=sent)
        body["device_submitted_at"] = iso(FIXED_NOW - dt.timedelta(minutes=30))
        report_id = _submit(client, painter_headers, job_id, body).json()["report"]["id"]

        detail = _manager_detail(client, manager_headers, report_id)
        assert detail["submitted_by"]["name"] == "Dan Hughes"
        assert detail["device_submitted_at"] == body["device_submitted_at"]
        assert detail["submit_clock_offset_seconds"] == 420
        photos = {p["id"]: p for p in detail["photos"]}
        first = photos[before["id"]]
        assert first["taken_at"] == iso(taken) and first["received_at"] == iso(FIXED_NOW)
        assert first["source"] == "camera" and first["taken_at_source"] == "device_clock"
        assert first["clock_offset_seconds"] == 259200
        assert first["checklist_item_id"] == item and first["caption"] == "Wall before"
        assert first["location"] == LOCATION
        assert "full.jpg" in first["url"]
        assert "thumb.jpg" in first["thumb_url"] and "X-Amz-Signature" in first["url"]
        assert (first["width"], first["height"]) == (64, 48)
        second = photos[gallery["id"]]
        assert (second["source"], second["taken_at_source"]) == ("gallery", "file_metadata")
        assert second["location"] is None and second["clock_offset_seconds"] == 0
        third = photos[added["id"]]
        assert (third["source"], third["taken_at_source"]) == ("gallery", "added_time")
        # stage order: before, during, after
        assert [p["stage"] for p in detail["photos"]] == ["before", "during", "after"]
        # only the manager response has a location key
        assert "location" in _keys(detail)


def test_seeded_photos_have_placeholder_evidence_fields(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    page = client.get(f"{MANAGER}/reports?page_size=5", headers=manager_headers).json()
    detail = _manager_detail(client, manager_headers, page["items"][0]["id"])
    assert detail["photos"] and detail["pending_photo_count"] == 0
    assert detail["device_submitted_at"] is None and detail["submit_clock_offset_seconds"] is None
    assert detail["submitted_by"]["id"] == detail["painter"]["id"]
    for photo in detail["photos"]:
        assert photo["source"] == "camera" and photo["taken_at_source"] == "device_clock"
        assert photo["received_at"] is None and photo["clock_offset_seconds"] is None
        assert photo["location"] is None and photo["checklist_item_id"] is None
        assert "/api/v1/photos/" in photo["url"]  # the HMAC placeholder, not an object URL
    assert all({"cannot_do", "removed"} <= set(i) for i in detail["checklist"])
    assert not any(i["cannot_do"] or i["removed"] for i in detail["checklist"])


def test_checklist_shows_cannot_do_and_removed_items(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(
        db_engine,
        dan,
        labels=("Done", "Skipped"),
        removed=("Gone",),
        report=ReportState.draft,
        recorded={
            "Done": {"done": True},
            "Skipped": {"cannot_do": True, "note": "No access"},
            "Gone": {"note": "started, then the office removed it"},
        },
        keep=True,
    ) as job_id:
        before = send_photo(client, painter_headers, job_id, stage="before", color=(1, 2, 3))
        after = send_photo(client, painter_headers, job_id, stage="after", color=(3, 2, 1))
        response = _submit(client, painter_headers, job_id, _body([before["id"], after["id"]]))
        assert response.status_code == 200, response.text
        detail = _manager_detail(client, manager_headers, response.json()["report"]["id"])
        by_label = {i["label"]: i for i in detail["checklist"]}
        assert by_label["Skipped"]["cannot_do"] is True and by_label["Skipped"]["done"] is False
        assert (
            by_label["Skipped"]["note"] == "No access" and by_label["Skipped"]["removed"] is False
        )
        assert by_label["Done"]["done"] is True and by_label["Done"]["cannot_do"] is False
        assert by_label["Gone"]["removed"] is True and by_label["Gone"]["note"]


def test_re_registering_with_another_stage_changes_the_managers_view_not_the_count(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        _tick_all(client, painter_headers, job_id)
        a = send_photo(client, painter_headers, job_id, stage="before", color=(9, 8, 7))
        b = send_photo(client, painter_headers, job_id, stage="before", color=(7, 8, 9))
        c = send_photo(client, painter_headers, job_id, stage="after", color=(5, 5, 9))
        data = a["data"]
        again = registration(data, stage="during")
        again["taken_at"] = a["registered"].json()["taken_at"]
        response = put_registration(client, painter_headers, job_id, a["id"], again)
        assert response.status_code == 200, response.text
        report_id = _submit(
            client, painter_headers, job_id, _body([a["id"], b["id"], c["id"]])
        ).json()["report"]["id"]
        detail = _manager_detail(client, manager_headers, report_id)
        stages = {p["id"]: p["stage"] for p in detail["photos"]}
        assert stages == {a["id"]: "during", b["id"]: "before", c["id"]: "after"}


def test_a_deleted_draft_photo_never_reaches_the_manager(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        _tick_all(client, painter_headers, job_id)
        keep_before = send_photo(client, painter_headers, job_id, stage="before", color=(1, 1, 8))
        keep_after = send_photo(client, painter_headers, job_id, stage="after", color=(8, 1, 1))
        dropped = send_photo(client, painter_headers, job_id, stage="during", color=(4, 4, 4))
        url = f"{BASE}/{job_id}/photos/{dropped['id']}"
        assert client.delete(url, headers=painter_headers).status_code == 204
        report_id = _submit(
            client, painter_headers, job_id, _body([keep_before["id"], keep_after["id"]])
        ).json()["report"]["id"]
        detail = _manager_detail(client, manager_headers, report_id)
        assert {p["id"] for p in detail["photos"]} == {keep_before["id"], keep_after["id"]}
        history = client.get(f"{MANAGER}/reports/{report_id}/history", headers=manager_headers)
        assert dropped["id"] not in history.text
        assert [e["action"] for e in history.json()["items"]] == ["report.submitted"]


def test_drafts_and_their_uploaded_photos_are_invisible_to_managers(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
) -> None:
    with temp_job(db_engine, dan, labels=("A",)) as job_id:
        photo = send_photo(client, painter_headers, job_id, stage="before")
        report_id = client.get(f"{BASE}/{job_id}", headers=painter_headers).json()["report"]["id"]
        assert (
            client.get(f"{MANAGER}/reports/{report_id}", headers=manager_headers).status_code == 404
        )
        listing = client.get(f"{MANAGER}/reports?page_size=100", headers=manager_headers).json()
        assert report_id not in {r["id"] for r in listing["items"]}
        # the signed image route does not serve an uploaded photo either, even with a valid link
        exp = int(FIXED_NOW.timestamp()) + 300
        sig = sign(get_settings().photo_url_secret, uuid.UUID(photo["id"]), "full", exp)
        response = client.get(
            f"/api/v1/photos/{photo['id']}/image",
            params={"variant": "full", "exp": exp, "sig": sig},
        )
        assert response.status_code == 404


def test_uploaded_photos_are_not_served_by_the_placeholder_route_after_submit_either(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        _tick_all(client, painter_headers, job_id)
        before = send_photo(client, painter_headers, job_id, stage="before", color=(2, 2, 2))
        after = send_photo(client, painter_headers, job_id, stage="after", color=(3, 3, 3))
        assert (
            _submit(client, painter_headers, job_id, _body([before["id"], after["id"]])).status_code
            == 200
        )
        exp = int(FIXED_NOW.timestamp()) + 300
        sig = sign(get_settings().photo_url_secret, uuid.UUID(before["id"]), "thumb", exp)
        response = client.get(
            f"/api/v1/photos/{before['id']}/image",
            params={"variant": "thumb", "exp": exp, "sig": sig},
        )
        assert response.status_code == 404


def test_operative_responses_never_carry_a_location(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        _tick_all(client, painter_headers, job_id)
        registered = send_photo(
            client, painter_headers, job_id, stage="before", color=(6, 6, 6), location=LOCATION
        )
        after = send_photo(client, painter_headers, job_id, stage="after", color=(7, 7, 7))
        responses = [
            registered["registered"],
            registered["uploaded"],
            client.get(f"{BASE}/{job_id}", headers=painter_headers),
            client.get(BASE, headers=painter_headers),
            _submit(client, painter_headers, job_id, _body([registered["id"], after["id"]])),
        ]
        for response in responses:
            assert response.status_code in (200, 201)
            assert not {"location", "latitude", "longitude", "location_accuracy_m"} & _keys(
                response.json()
            )
            assert "51.46512" not in response.text and "2.59603" not in response.text


def test_coordinates_are_never_logged(
    client: TestClient,
    painter_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with temp_job(db_engine, dan, labels=("A",)) as job_id:
        with caplog.at_level("DEBUG"):
            data = make_jpeg(color=(12, 13, 14))
            photo_id = str(uuid.uuid4())
            body = registration(data, location=LOCATION, caption="Garden gate")
            assert (
                put_registration(client, painter_headers, job_id, photo_id, body).status_code == 201
            )
            assert put_content(client, painter_headers, job_id, photo_id, data).status_code == 200
            assert (
                client.delete(
                    f"{BASE}/{job_id}/photos/{photo_id}", headers=painter_headers
                ).status_code
                == 204
            )
        everything = (
            caplog.text
            + capsys.readouterr().out
            + json.dumps([r.getMessage() for r in caplog.records])
        )
        for secret in ("51.46512", "2.59603", "Garden gate", body["upload"]["sha256"]):
            assert secret not in everything, secret
        assert "photos/" in everything  # the access log is there; it holds paths and ids only


def test_registration_with_location_all_parts_or_none(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        data = make_jpeg(color=(20, 20, 20))
        photo_id = str(uuid.uuid4())
        body = registration(data, location={**LOCATION, "accuracy_m": None, "source": "file"})
        assert put_registration(client, painter_headers, job_id, photo_id, body).status_code == 201
        with db_engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT latitude, longitude, location_accuracy_m, location_source::text "
                    "FROM report_photos WHERE id = :p"
                ),
                {"p": photo_id},
            ).one()
        assert tuple(row) == (51.46512, -2.59603, None, "file")
        # an identical repeat is a 200; the location is immutable
        assert put_registration(client, painter_headers, job_id, photo_id, body).status_code == 200
        without = registration(data)
        assert (
            put_registration(client, painter_headers, job_id, photo_id, without).status_code == 409
        )
