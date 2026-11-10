"""T-003f: PATCH /operative/jobs/{id}/report (save the draft, creating it on first use)."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.models.enums import JobStatus, ReportState
from tests.contract import assert_contract
from tests.operative_helpers import DAN_EMAIL, PRIYA_EMAIL, temp_job, user_id

BASE = "/api/v1/operative/jobs"


def _patch(
    client: TestClient, headers: dict[str, str], job_id: Any, body: Any, *, check: bool = True
) -> Any:
    response = client.patch(f"{BASE}/{job_id}/report", headers=headers, json=body)
    if check:
        assert_contract(response, "saveOperativeDraft")
    return response


def _item_ids(client: TestClient, headers: dict[str, str], job_id: Any) -> dict[str, str]:
    body = client.get(f"{BASE}/{job_id}", headers=headers).json()
    return {i["label"]: i["id"] for i in body["checklist"]}


def _state(db_engine: Any, job_id: Any) -> tuple[Any, ...]:
    with db_engine.connect() as connection:
        return tuple(
            connection.execute(
                text(
                    "SELECT j.status::text, r.state::text, r.version, r.painter_notes, "
                    "(SELECT count(*) FROM report_checklist_items WHERE report_id = r.id), "
                    "(SELECT count(*) FROM audit_events WHERE report_id = r.id) "
                    "FROM jobs j LEFT JOIN job_reports r ON r.job_id = j.id WHERE j.id = :j"
                ),
                {"j": job_id},
            ).one()
        )


@pytest.fixture
def dan(db_engine: Any) -> Any:
    return user_id(db_engine, DAN_EMAIL)


def test_first_save_creates_the_draft_and_starts_the_job(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, labels=("Mask", "Sand", "Coat")) as job_id:
        ids = _item_ids(client, painter_headers, job_id)
        response = _patch(
            client,
            painter_headers,
            job_id,
            {"notes": "Started", "checklist": [{"item_id": ids["Mask"], "status": "done"}]},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "in_progress"
        assert body["report"]["state"] == "draft" and body["report"]["notes"] == "Started"
        assert body["report"]["submitted_at"] is None
        assert (body["checklist_dealt_with"], body["checklist_total"]) == (1, 3)
        assert [i["status"] for i in body["checklist"]] == ["done", "open", "open"]
        assert _state(db_engine, job_id) == ("in_progress", "draft", 1, "Started", 3, 0)


def test_repeating_a_save_is_idempotent(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        ids = _item_ids(client, painter_headers, job_id)
        payload = {"notes": "n", "checklist": [{"item_id": ids["First"], "status": "done"}]}
        first = _patch(client, painter_headers, job_id, payload).json()
        second = _patch(client, painter_headers, job_id, payload).json()
        assert first == second
        assert _state(db_engine, job_id) == ("in_progress", "draft", 1, "n", 2, 0)


def test_only_sent_fields_change_and_last_write_wins(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        a = _item_ids(client, painter_headers, job_id)["First"]
        _patch(
            client,
            painter_headers,
            job_id,
            {
                "notes": "keep",
                "checklist": [{"item_id": a, "status": "not_done", "note": "No access"}],
            },
        )
        body = _patch(
            client, painter_headers, job_id, {"checklist": [{"item_id": a, "note": "Key"}]}
        ).json()
        assert body["report"]["notes"] == "keep"
        first = body["checklist"][0]
        assert (first["status"], first["note"]) == ("not_done", "Key")
        assert body["checklist_dealt_with"] == 1
        body = _patch(
            client, painter_headers, job_id, {"checklist": [{"item_id": a, "status": "open"}]}
        ).json()
        assert body["checklist"][0]["status"] == "open" and body["checklist"][0]["note"] == "Key"
        assert body["checklist_dealt_with"] == 0


def test_not_done_without_a_note_is_saved_but_does_not_count(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        a = _item_ids(client, painter_headers, job_id)["First"]
        body = _patch(
            client, painter_headers, job_id, {"checklist": [{"item_id": a, "status": "not_done"}]}
        ).json()
        assert body["checklist"][0]["status"] == "not_done"
        assert body["checklist_dealt_with"] == 0
        with db_engine.connect() as connection:
            row = connection.execute(
                text("SELECT done, cannot_do FROM report_checklist_items WHERE id = :i"), {"i": a}
            ).one()
        assert tuple(row) == (False, True)


def test_blank_notes_become_null_and_null_clears(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        a = _item_ids(client, painter_headers, job_id)["First"]
        _patch(
            client,
            painter_headers,
            job_id,
            {"notes": "x", "checklist": [{"item_id": a, "note": "y"}]},
        )
        body = _patch(
            client,
            painter_headers,
            job_id,
            {"notes": "   \n", "checklist": [{"item_id": a, "note": None}]},
        ).json()
        assert body["report"]["notes"] is None and body["checklist"][0]["note"] is None
        body = _patch(client, painter_headers, job_id, {"notes": "Line 1\nLine 2"}).json()
        assert body["report"]["notes"] == "Line 1\nLine 2"
        body = _patch(client, painter_headers, job_id, {"notes": None}).json()
        assert body["report"]["notes"] is None


def test_text_limits(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        a = _item_ids(client, painter_headers, job_id)["First"]
        ok = _patch(
            client,
            painter_headers,
            job_id,
            {"notes": "n" * 2000, "checklist": [{"item_id": a, "note": "i" * 500}]},
        )
        assert ok.status_code == 200
        too_long = _patch(client, painter_headers, job_id, {"notes": "n" * 2001})
        assert too_long.status_code == 422 and too_long.json()["code"] == "validation_error"
        locs = [e["loc"] for e in too_long.json()["errors"]]
        assert ["body", "notes"] in locs
        long_item = _patch(
            client, painter_headers, job_id, {"checklist": [{"item_id": a, "note": "i" * 501}]}
        )
        assert long_item.status_code == 422
        assert ["body", "checklist", 0, "note"] in [e["loc"] for e in long_item.json()["errors"]]
        # Code points, not UTF-16 units.
        emoji = _patch(client, painter_headers, job_id, {"notes": "\U0001f600" * 2000})
        assert emoji.status_code == 200


@pytest.mark.parametrize("escape", ["\\u0000", "\\ud800"])
def test_unstorable_characters_are_refused(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, escape: str
) -> None:
    with temp_job(db_engine, dan) as job_id:
        a = _item_ids(client, painter_headers, job_id)["First"]
        headers = {**painter_headers, "content-type": "application/json"}
        bodies = [
            f'{{"notes": "a{escape}"}}',
            f'{{"checklist": [{{"item_id": "{a}", "note": "a{escape}"}}]}}',
        ]
        for content in bodies:
            response = client.patch(f"{BASE}/{job_id}/report", headers=headers, content=content)
            assert response.status_code == 422, response.text
            assert_contract(response, "saveOperativeDraft")
        assert _state(db_engine, job_id)[:2] == ("scheduled", None)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"checklist": []},
        {"checklist": None},
        {"checklist": [{"item_id": str(uuid.uuid4())}]},
        {"checklist": [{"item_id": "nope", "status": "done"}]},
        {"checklist": [{"item_id": str(uuid.uuid4()), "status": "finished"}]},
        {"checklist": [{"item_id": str(uuid.uuid4()), "status": None}]},
        {"notes": 5},
        {"surprise": 1},
        {"sign_off": None},
        {"checklist": [{"item_id": str(uuid.uuid4()), "status": "done", "label": "x"}]},
    ],
)
def test_malformed_bodies_are_422_and_create_nothing(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any, body: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        response = _patch(client, painter_headers, job_id, body)
        assert response.status_code == 422, response.text
        assert _state(db_engine, job_id)[:2] == ("scheduled", None)


def test_duplicate_and_unknown_item_ids_are_422(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id, temp_job(db_engine, dan) as other:
        a = _item_ids(client, painter_headers, job_id)["First"]
        foreign = _item_ids(client, painter_headers, other)["First"]
        dup = _patch(
            client,
            painter_headers,
            job_id,
            {"checklist": [{"item_id": a, "status": "done"}, {"item_id": a, "note": "x"}]},
        )
        assert dup.status_code == 422
        unknown = _patch(
            client,
            painter_headers,
            job_id,
            {
                "notes": "n",
                "checklist": [
                    {"item_id": a, "status": "done"},
                    {"item_id": foreign, "status": "done"},
                ],
            },
        )
        assert unknown.status_code == 422
        assert unknown.json()["errors"][0]["loc"] == ["body", "checklist", 1, "item_id"]
        assert _state(db_engine, job_id)[:2] == ("scheduled", None)  # all or nothing


def test_a_failed_request_does_not_start_the_job(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan) as job_id:
        _patch(
            client,
            painter_headers,
            job_id,
            {"checklist": [{"item_id": str(uuid.uuid4()), "status": "done"}]},
        )
        assert _state(db_engine, job_id)[:2] == ("scheduled", None)


def test_another_operatives_job_and_unknown_job_are_404(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    priya = user_id(db_engine, PRIYA_EMAIL)
    with temp_job(db_engine, priya) as job_id:
        response = _patch(client, painter_headers, job_id, {"notes": "mine now"})
        assert response.status_code == 404 and response.json()["code"] == "not_found"
        assert _state(db_engine, job_id)[:2] == ("scheduled", None)
    missing = _patch(client, painter_headers, uuid.uuid4(), {"notes": "x"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == response.json()["detail"]


def test_managers_admins_and_anonymous_are_refused(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        for headers in (manager_headers, admin_headers):
            response = _patch(client, headers, job_id, {"notes": "x"})
            assert response.status_code == 403 and response.json()["code"] == "forbidden"
        anonymous = client.patch(f"{BASE}/{job_id}/report", json={"notes": "x"})
        assert anonymous.status_code == 401
        assert_contract(anonymous, "saveOperativeDraft")
        assert _state(db_engine, job_id)[:2] == ("scheduled", None)


def test_cancelled_and_closed_jobs_are_409(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    for status, code in (
        (JobStatus.cancelled, "job_cancelled"),
        (JobStatus.completed, "job_closed"),
    ):
        with temp_job(db_engine, dan, status=status) as job_id:
            response = _patch(client, painter_headers, job_id, {"notes": "x"})
            assert response.status_code == 409 and response.json()["code"] == code
            assert _state(db_engine, job_id)[1] is None


def test_cancelled_job_with_a_draft_stays_unchanged(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(db_engine, dan, status=JobStatus.cancelled, report=ReportState.draft) as job_id:
        response = _patch(client, painter_headers, job_id, {"notes": "x"})
        assert response.status_code == 409 and response.json()["code"] == "job_cancelled"
        assert _state(db_engine, job_id)[3] == "Temp notes"


def test_a_submitted_report_is_never_changed(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(
        db_engine,
        dan,
        status=JobStatus.completed,
        report=ReportState.submitted,
        recorded={"First": {"done": True}},
    ) as job_id:
        a = _item_ids(client, painter_headers, job_id)["First"]
        response = _patch(client, painter_headers, job_id, {"notes": "late"})
        assert response.status_code == 409 and response.json()["code"] == "report_submitted"
        assert response.json()["submitted_at"].endswith("Z")
        # An unknown item is still the submitted conflict first (contract order of checks).
        bad = _patch(
            client,
            painter_headers,
            job_id,
            {"checklist": [{"item_id": str(uuid.uuid4()), "status": "done"}]},
        )
        assert bad.json()["code"] == "report_submitted"
        _patch(client, painter_headers, job_id, {"checklist": [{"item_id": a, "status": "open"}]})
        state = _state(db_engine, job_id)
        assert state[:4] == ("completed", "submitted", 1, "Temp notes")


def test_an_item_added_later_is_created_and_a_removed_item_can_be_noted(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any, dan: Any
) -> None:
    with temp_job(
        db_engine,
        dan,
        labels=("Old",),
        removed=("Gone",),
        report=ReportState.draft,
        recorded={"Old": {"done": True}},
    ) as job_id:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO job_checklist_items (id, job_id, position, label) "
                    "VALUES (gen_random_uuid(), :j, 10, 'Added later')"
                ),
                {"j": job_id},
            )
        ids = _item_ids(client, painter_headers, job_id)
        gone = {
            i["label"]: i
            for i in client.get(f"{BASE}/{job_id}", headers=painter_headers).json()["checklist"]
        }
        assert ids["Added later"] and "Gone" not in gone  # removed, no data: hidden
        with db_engine.connect() as connection:
            gone_id = connection.execute(
                text("SELECT id FROM job_checklist_items WHERE job_id = :j AND label = 'Gone'"),
                {"j": job_id},
            ).scalar_one()
        body = _patch(
            client,
            painter_headers,
            job_id,
            {
                "checklist": [
                    {"item_id": ids["Added later"], "status": "done"},
                    {"item_id": str(gone_id), "note": "Did it anyway"},
                ]
            },
        ).json()
        by_label = {i["label"]: i for i in body["checklist"]}
        assert by_label["Added later"]["status"] == "done"
        assert by_label["Gone"]["removed"] is True and by_label["Gone"]["note"] == "Did it anyway"
        assert body["checklist_total"] == 2 and body["checklist_dealt_with"] == 2


def test_saving_leaves_other_jobs_and_the_managers_view_alone(
    client: TestClient,
    painter_headers: dict[str, str],
    manager_headers: dict[str, str],
    db_engine: Any,
    dan: Any,
) -> None:
    with temp_job(db_engine, dan) as job_id:
        _patch(client, painter_headers, job_id, {"notes": "draft only"})
        with db_engine.connect() as connection:
            report_id = connection.execute(
                text("SELECT id FROM job_reports WHERE job_id = :j"), {"j": job_id}
            ).scalar_one()
        response = client.get(f"/api/v1/manager/reports/{report_id}", headers=manager_headers)
        assert response.status_code == 404
        listing = client.get(
            "/api/v1/manager/reports?page_size=100&q=TMP-", headers=manager_headers
        )
        assert str(report_id) not in listing.text


def test_a_seeded_draft_can_be_continued(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    jobs = client.get(BASE, headers=painter_headers).json()["earlier_unfinished"]
    job = jobs[0]
    open_item = next(i for i in job["checklist"] if i["status"] == "open")
    body = _patch(
        client,
        painter_headers,
        job["id"],
        {"checklist": [{"item_id": open_item["id"], "status": "done"}]},
    ).json()
    try:
        assert body["checklist_dealt_with"] == job["checklist_dealt_with"] + 1
    finally:
        _patch(
            client,
            painter_headers,
            job["id"],
            {"checklist": [{"item_id": open_item["id"], "status": "open"}]},
        )
