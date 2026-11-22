"""T-003h: POST /operative/jobs/{id}/report/submit."""

import datetime as dt
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.models.enums import JobStatus, ReportState
from tests.conftest import ANCHOR, FIXED_NOW, bearer, make_token
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


def _submit(
    client: TestClient,
    headers: dict[str, str],
    job_id: Any,
    body: dict[str, Any],
    *,
    check: bool = True,
) -> Any:
    response = client.post(f"{BASE}/{job_id}/report/submit", headers=headers, json=body)
    if check:
        assert_contract(response, "submitOperativeReport")
    return response


def _body(
    photo_ids: list[str],
    *,
    submission_id: str | None = None,
    sent_at: dt.datetime | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "submission_id": submission_id or str(uuid.uuid4()),
        "device_submitted_at": iso(FIXED_NOW - dt.timedelta(minutes=2)),
        "device_sent_at": iso(sent_at or FIXED_NOW),
        "photo_ids": photo_ids,
        **extra,
    }


def _items(client: TestClient, headers: dict[str, str], job_id: Any) -> dict[str, str]:
    body = client.get(f"{BASE}/{job_id}", headers=headers).json()
    return {i["label"]: i["id"] for i in body["checklist"]}


def _tick_all(client: TestClient, headers: dict[str, str], job_id: Any) -> None:
    ids = _items(client, headers, job_id)
    response = client.patch(
        f"{BASE}/{job_id}/report",
        headers=headers,
        json={"checklist": [{"item_id": i, "status": "done"} for i in ids.values()]},
    )
    assert response.status_code == 200, response.text


def _ready(
    client: TestClient, headers: dict[str, str], job_id: Any, *, upload: bool = True
) -> list[str]:
    """Every item ticked, one Before and one After photo."""
    _tick_all(client, headers, job_id)
    before = send_photo(client, headers, job_id, stage="before", color=(10, 20, 30), upload=upload)
    after = send_photo(client, headers, job_id, stage="after", color=(30, 20, 10), upload=upload)
    return [before["id"], after["id"]]


@pytest.fixture
def dan(db_engine: Any) -> Any:
    return user_id(db_engine, DAN_EMAIL)


def _state(db_engine: Any, job_id: Any) -> Any:
    with db_engine.connect() as connection:
        return connection.execute(
            text(
                "SELECT j.status::text AS job_status, j.completed_on, r.state::text AS state, "
                "r.submitted_at, r.submitted_by_id, r.review_status::text AS review, "
                "r.submission_id, r.device_submitted_at, r.submit_clock_offset_seconds, r.version, "
                "(SELECT count(*) FROM audit_events WHERE report_id = r.id) AS events "
                "FROM jobs j JOIN job_reports r ON r.job_id = j.id WHERE j.id = :j"
            ),
            {"j": job_id},
        ).one()


def test_submitting_a_complete_report(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    before = client.get("/api/v1/manager/dashboard", headers=manager_headers).json()
    with temp_job(db_engine, dan, labels=("Mask", "Sand"), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        sent = FIXED_NOW - dt.timedelta(minutes=10)
        submission_id = str(uuid.uuid4())
        response = _submit(
            client,
            painter_headers,
            job_id,
            _body(photos, submission_id=submission_id, sent_at=sent),
        )
        assert response.status_code == 200, response.text
        job = response.json()
        report = job["report"]
        assert job["status"] == "submitted"
        assert report["state"] == "submitted" and report["review_status"] == "awaiting_review"
        assert report["submitted_at"] == iso(FIXED_NOW) and report["submission_id"] == submission_id
        assert report["submitted_by"]["name"] == "Dan Hughes"
        assert report["device_submitted_at"] == iso(FIXED_NOW - dt.timedelta(minutes=2))
        assert "manager_notes" not in report and report["reviewed_by"] is None
        assert {p["id"] for p in report["photos"]} == set(photos)

        row = _state(db_engine, job_id)
        assert row.job_status == "completed" and row.completed_on == ANCHOR
        assert (row.state, row.review, row.version, row.events) == (
            "submitted",
            "awaiting_review",
            1,
            1,
        )
        assert row.submitted_by_id == dan and row.submission_id == uuid.UUID(submission_id)
        assert row.submit_clock_offset_seconds == 600

        with db_engine.connect() as connection:
            event = connection.execute(
                text(
                    "SELECT action::text, actor_id, actor_name, changes, entity_type::text "
                    "FROM audit_events WHERE report_id = :r"
                ),
                {"r": report["id"]},
            ).one()
        assert tuple(event) == ("report.submitted", dan, "Dan Hughes", [], "report")

        # the manager sees it: dashboard +1, detail with submitted_by
        after = client.get("/api/v1/manager/dashboard", headers=manager_headers).json()
        assert after["reports_awaiting_review"] == before["reports_awaiting_review"] + 1
        detail = client.get(f"/api/v1/manager/reports/{report['id']}", headers=manager_headers)
        assert detail.status_code == 200
        assert_contract(detail, "getManagerReport")
        assert detail.json()["submitted_by"]["name"] == "Dan Hughes"
        assert detail.json()["pending_photo_count"] == 0
        history = client.get(
            f"/api/v1/manager/reports/{report['id']}/history", headers=manager_headers
        )
        assert_contract(history, "listManagerReportHistory")
        assert [e["action"] for e in history.json()["items"]] == ["report.submitted"]


def test_completed_on_is_the_later_of_the_scheduled_day_and_the_london_date(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    yesterday = ANCHOR - dt.timedelta(days=1)
    with temp_job(db_engine, dan, labels=("A",), scheduled=yesterday, keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        assert _submit(client, painter_headers, job_id, _body(photos)).status_code == 200
        assert (
            _state(db_engine, job_id).completed_on == ANCHOR
        )  # submitted today, scheduled earlier
    future = ANCHOR + dt.timedelta(days=2)
    with temp_job(db_engine, dan, labels=("A",), scheduled=future, keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        assert _submit(client, painter_headers, job_id, _body(photos)).status_code == 200
        assert _state(db_engine, job_id).completed_on == future  # never before its start


def test_an_incomplete_report_is_422_with_one_entry_per_problem_and_writes_nothing(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, labels=("Mask", "Sand", "Coat")) as job_id:
        ids = _items(client, painter_headers, job_id)
        client.patch(
            f"{BASE}/{job_id}/report",
            headers=painter_headers,
            json={
                "checklist": [
                    {"item_id": ids["Mask"], "status": "done"},
                    {"item_id": ids["Sand"], "status": "not_done"},  # no reason
                ]
            },
        )
        only_before = send_photo(client, painter_headers, job_id, stage="before")
        response = _submit(client, painter_headers, job_id, _body([only_before["id"]]))
        assert response.status_code == 422, response.text
        body = response.json()
        assert body["code"] == "submission_incomplete"
        assert body["errors"] == [
            {"loc": ["photos", "after"], "message": "Add at least 1 After photo."},
            {
                "loc": ["checklist", ids["Sand"]],
                "message": "Tick this item or say why it wasn't done.",
            },
            {
                "loc": ["checklist", ids["Coat"]],
                "message": "Tick this item or say why it wasn't done.",
            },
        ]
        state = _state(db_engine, job_id)
        assert (state.state, state.job_status, state.events) == ("draft", "in_progress", 0)


def test_nothing_at_all_lists_both_photo_problems(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, labels=()) as job_id:
        response = _submit(client, painter_headers, job_id, _body([]))
        assert response.status_code == 422
        assert [e["loc"] for e in response.json()["errors"]] == [
            ["photos", "before"],
            ["photos", "after"],
        ]
        assert _state_missing(db_engine, job_id)  # the failed submit rolled the new draft back


def test_items_removed_by_the_office_are_ignored(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("Only",), removed=("Gone",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        assert _submit(client, painter_headers, job_id, _body(photos)).status_code == 200


def test_photos_registered_but_not_uploaded_count_and_arrive_later(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    from tests.photo_helpers import put_content

    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        _tick_all(client, painter_headers, job_id)
        pending = [
            send_photo(
                client, painter_headers, job_id, stage="before", color=(1, 50, 1), upload=False
            ),
            send_photo(
                client, painter_headers, job_id, stage="after", color=(50, 1, 1), upload=False
            ),
        ]
        response = _submit(client, painter_headers, job_id, _body([p["id"] for p in pending]))
        assert response.status_code == 200, response.text
        report_id = response.json()["report"]["id"]
        assert [p["received_at"] for p in response.json()["report"]["photos"]] == [None, None]

        detail = client.get(f"/api/v1/manager/reports/{report_id}", headers=manager_headers).json()
        assert detail["pending_photo_count"] == 2 and detail["photos"] == []
        summary = client.get(
            "/api/v1/manager/reports?page_size=100", headers=manager_headers
        ).json()
        mine = next(r for r in summary["items"] if r["id"] == report_id)
        assert mine["photo_count"] == 0

        late = put_content(client, painter_headers, job_id, pending[0]["id"], pending[0]["data"])
        assert late.status_code == 200
        detail = client.get(f"/api/v1/manager/reports/{report_id}", headers=manager_headers).json()
        assert detail["pending_photo_count"] == 1 and len(detail["photos"]) == 1
        put_content(client, painter_headers, job_id, pending[1]["id"], pending[1]["data"])
        detail = client.get(f"/api/v1/manager/reports/{report_id}", headers=manager_headers).json()
        assert detail["pending_photo_count"] == 0 and len(detail["photos"]) == 2
        history = client.get(
            f"/api/v1/manager/reports/{report_id}/history", headers=manager_headers
        )
        assert [e["action"] for e in history.json()["items"]] == [
            "report.photo_received",
            "report.photo_received",
            "report.submitted",
        ]


def test_a_repeat_with_the_same_submission_id_is_200_and_writes_nothing(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        body = _body(photos)
        first = _submit(client, painter_headers, job_id, body)
        before = _state(db_engine, job_id)
        later = {**body, "device_sent_at": iso(FIXED_NOW + dt.timedelta(minutes=5))}
        second = _submit(client, painter_headers, job_id, later)
        assert (first.status_code, second.status_code) == (200, 200)
        assert first.json() == second.json()
        assert _state(db_engine, job_id) == before  # the offset is the first request's
        assert before.events == 1


def test_a_different_submission_id_is_409_already_submitted(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        _submit(client, painter_headers, job_id, _body(photos))
        response = _submit(client, painter_headers, job_id, _body(photos))
        assert response.status_code == 409 and response.json()["code"] == "already_submitted"
        assert response.json()["submitted_at"] == iso(FIXED_NOW)


def test_unregistered_photo_ids_are_listed_in_409(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, labels=("A",)) as job_id:
        photos = _ready(client, painter_headers, job_id)
        missing = [str(uuid.uuid4()), str(uuid.uuid4())]
        response = _submit(client, painter_headers, job_id, _body([*photos, *missing]))
        assert response.status_code == 409 and response.json()["code"] == "photos_not_registered"
        assert response.json()["missing_photo_ids"] == missing
        assert _state(db_engine, job_id).state == "draft"
        # register them and the submit goes through on the retry
        for photo_id, color in zip(missing, ((5, 5, 5), (6, 6, 6)), strict=True):
            put_registration(
                client,
                painter_headers,
                job_id,
                photo_id,
                registration(make_jpeg(color=color), stage="during"),
            )


def test_a_photo_of_another_job_is_not_registered_here(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, labels=("A",)) as job_id, temp_job(db_engine, dan) as other:
        photos = _ready(client, painter_headers, job_id)
        elsewhere = send_photo(client, painter_headers, other, color=(77, 77, 77))
        response = _submit(client, painter_headers, job_id, _body([*photos, elsewhere["id"]]))
        assert response.status_code == 409
        assert response.json()["missing_photo_ids"] == [elsewhere["id"]]


def test_the_draft_sent_with_the_submit_is_applied_first(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("Mask", "Sand"), keep=True) as job_id:
        ids = _items(client, painter_headers, job_id)
        before = send_photo(client, painter_headers, job_id, stage="before", color=(10, 20, 30))
        after = send_photo(client, painter_headers, job_id, stage="after", color=(30, 20, 10))
        draft = {
            "notes": "All finished",
            "checklist": [
                {"item_id": ids["Mask"], "status": "done"},
                {"item_id": ids["Sand"], "status": "not_done", "note": "Customer said no"},
            ],
        }
        response = _submit(
            client, painter_headers, job_id, _body([before["id"], after["id"]], draft=draft)
        )
        assert response.status_code == 200, response.text
        report = response.json()["report"]
        assert report["notes"] == "All finished"
        assert [(i["status"], i["note"]) for i in response.json()["checklist"]] == [
            ("done", None),
            ("not_done", "Customer said no"),
        ]


def test_an_invalid_draft_in_a_submit_is_422_validation_error(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, labels=("A",)) as job_id:
        draft = {"checklist": [{"item_id": str(uuid.uuid4()), "status": "done"}]}
        response = _submit(client, painter_headers, job_id, _body([], draft=draft))
        assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_items_added_by_the_office_since_the_draft_get_report_rows(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        new_item = uuid.uuid4()
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO job_checklist_items (id, job_id, position, label) "
                    "VALUES (:i, :j, 9, 'Added later')"
                ),
                {"i": new_item, "j": job_id},
            )
        incomplete = _submit(client, painter_headers, job_id, _body(photos))
        assert incomplete.status_code == 422
        assert incomplete.json()["errors"][0]["loc"] == ["checklist", str(new_item)]
        draft = {"checklist": [{"item_id": str(new_item), "status": "done"}]}
        assert (
            _submit(client, painter_headers, job_id, _body(photos, draft=draft)).status_code == 200
        )
        with db_engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT count(*) FROM report_checklist_items i JOIN job_reports r "
                    "ON r.id = i.report_id WHERE r.job_id = :j"
                ),
                {"j": job_id},
            ).scalar()
        assert rows == 2


def test_cancelled_and_closed_jobs_are_409(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    for status, code in (
        (JobStatus.cancelled, "job_cancelled"),
        (JobStatus.completed, "job_closed"),
    ):
        with temp_job(db_engine, dan, status=status, labels=(), report=ReportState.draft) as job_id:
            response = _submit(client, painter_headers, job_id, _body([]))
            assert response.status_code == 409 and response.json()["code"] == code


def test_a_submission_id_cannot_be_reused_for_another_job(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with (
        temp_job(db_engine, dan, labels=("A",), keep=True) as first,
        temp_job(db_engine, dan, labels=("A",), keep=True) as second,
    ):
        one = _ready(client, painter_headers, first)
        two = _ready(client, painter_headers, second)
        shared = str(uuid.uuid4())
        assert (
            _submit(client, painter_headers, first, _body(one, submission_id=shared)).status_code
            == 200
        )
        response = _submit(client, painter_headers, second, _body(two, submission_id=shared))
        assert response.status_code == 422 and response.json()["code"] == "validation_error"
        assert _state(db_engine, second).state == "draft"


def test_concurrent_submits_produce_one_report_and_one_event(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        bodies = [_body(photos) for _ in range(4)]
        results: list[Any] = [None] * 4

        def send(index: int) -> None:
            results[index] = _submit(client, painter_headers, job_id, bodies[index], check=False)

        threads = [threading.Thread(target=send, args=(i,)) for i in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 409, 409, 409]
        losers = [r for r in results if r.status_code == 409]
        assert {r.json()["code"] for r in losers} == {"already_submitted"}
        row = _state(db_engine, job_id)
        assert row.events == 1 and row.state == "submitted"
        winner = next(r for r in results if r.status_code == 200)
        assert str(row.submission_id) == winner.json()["report"]["submission_id"]


def test_the_same_submission_id_sent_concurrently_is_two_successes_and_one_event(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, reseed: None
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        body = _body(photos)
        results: list[Any] = [None] * 3

        def send(index: int) -> None:
            results[index] = _submit(client, painter_headers, job_id, body, check=False)

        threads = [threading.Thread(target=send, args=(i,)) for i in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        assert [r.status_code for r in results] == [200, 200, 200]
        assert _state(db_engine, job_id).events == 1


def test_the_operative_sees_reviewed_by_after_review_and_never_manager_notes(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
    reseed: None,
) -> None:
    with temp_job(db_engine, dan, labels=("A",), keep=True) as job_id:
        photos = _ready(client, painter_headers, job_id)
        report_id = _submit(client, painter_headers, job_id, _body(photos)).json()["report"]["id"]
        detail = client.get(f"/api/v1/manager/reports/{report_id}", headers=manager_headers).json()
        edited = client.patch(
            f"/api/v1/manager/reports/{report_id}",
            headers=manager_headers,
            json={"version": detail["version"], "manager_notes": "private to the office"},
        )
        assert edited.status_code == 200, edited.text
        reviewed = client.post(
            f"/api/v1/manager/reports/{report_id}/review",
            headers=manager_headers,
            json={"version": edited.json()["version"]},
        )
        assert reviewed.status_code == 200, reviewed.text
        job = client.get(f"{BASE}/{job_id}", headers=painter_headers)
        assert job.status_code == 200
        report = job.json()["report"]
        assert report["review_status"] == "reviewed" and report["reviewed_by"]["name"]
        assert "manager_notes" not in job.text and "private to the office" not in job.text


def test_submit_scoping_personas_and_validation(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
) -> None:
    priya = user_id(db_engine, PRIYA_EMAIL)
    with temp_job(db_engine, priya, labels=()) as hers, temp_job(db_engine, dan, labels=()) as mine:
        body = _body([])
        assert _submit(client, painter_headers, hers, body).status_code == 404
        assert _state_missing(db_engine, hers)
        assert _submit(client, manager_headers, mine, body, check=False).status_code == 403
        assert _submit(client, admin_headers, mine, body, check=False).status_code == 403
        assert _submit(client, {}, mine, body, check=False).status_code == 401
        assert (
            client.post(
                f"{BASE}/{mine}/report/submit", headers=painter_headers, json={}
            ).status_code
            == 422
        )
        for bad in (
            {**body, "submission_id": "nope"},
            {**body, "photo_ids": [str(uuid.uuid4())] * 2},
            {**body, "photo_ids": [str(uuid.uuid4()) for _ in range(61)]},
            {**body, "device_sent_at": "2026-10-15T10:00:00"},
            {**body, "extra": 1},
        ):
            assert _submit(client, painter_headers, mine, bad).status_code == 422
        priya_headers = bearer(make_token(priya, role="painter"))
        assert _submit(client, priya_headers, hers, body).status_code == 422  # reaches the rule


def _state_missing(db_engine: Any, job_id: Any) -> bool:
    with db_engine.connect() as connection:
        return (
            connection.execute(
                text("SELECT count(*) FROM job_reports WHERE job_id = :j"), {"j": job_id}
            ).scalar()
            == 0
        )
