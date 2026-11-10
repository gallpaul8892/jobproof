"""T-003c and T-003d: the operative's job list and job detail."""

import datetime as dt
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.models.enums import JobStatus, ReportState
from tests.conftest import ANCHOR, FIXED_NOW, bearer, make_token
from tests.contract import assert_contract
from tests.operative_helpers import DAN_EMAIL, PRIYA_EMAIL, temp_job, user_id

LIST = "/api/v1/operative/jobs"
YESTERDAY = ANCHOR - dt.timedelta(days=1)


def _list(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    response = client.get(LIST, headers=headers)
    assert response.status_code == 200, response.text
    assert_contract(response, "listOperativeJobs")
    body: dict[str, Any] = response.json()
    return body


def _detail(client: TestClient, headers: dict[str, str], job_id: Any) -> dict[str, Any]:
    response = client.get(f"{LIST}/{job_id}", headers=headers)
    assert response.status_code == 200, response.text
    assert_contract(response, "getOperativeJob")
    body: dict[str, Any] = response.json()
    return body


def _priya_headers(db_engine: Any) -> dict[str, str]:
    return bearer(make_token(user_id(db_engine, PRIYA_EMAIL), role="painter"))


def _by_ref(jobs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {j["reference"]: j for j in jobs}


# ---- list (T-003c) ----------------------------------------------------------------------------
def test_dans_list_is_his_three_jobs_for_today_in_order(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    body = _list(client, painter_headers)
    assert body["today"] == ANCHOR.isoformat()
    assert dt.datetime.fromisoformat(body["as_of"]) == FIXED_NOW
    today = body["jobs_today"]
    assert [j["reference"] for j in today] == ["JP-1061", "JP-1062", "JP-1063"]
    assert [j["title"] for j in today] == [
        "Repaint lounge, hall and landing",
        "Paper bedroom feature wall",
        "Exterior repaint, front elevation",
    ]
    assert [j["site_address"]["postcode"] for j in today] == ["BS6 5QA", "BS8 2PX", "BS3 1AB"]
    assert {j["site_address"]["town"] for j in today} == {"Bristol"}
    assert [j["job_type"] for j in today] == [
        "interior_repaint",
        "wallpapering",
        "exterior_repaint",
    ]
    assert {j["status"] for j in today} == {"to_do"}
    assert {j["scheduled_start"] for j in today} == {ANCHOR.isoformat()}
    assert [j["checklist_total"] for j in today] == [9, 0, 14]
    assert {j["checklist_dealt_with"] for j in today} == {0}
    assert all(j["report"] is None for j in today)


def test_yesterdays_draft_is_in_earlier_not_finished_with_progress(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    earlier = _list(client, painter_headers)["earlier_unfinished"]
    assert [j["reference"] for j in earlier] == ["JP-1064"]
    job = earlier[0]
    assert job["scheduled_start"] == YESTERDAY.isoformat()
    assert job["status"] == "in_progress"
    assert (job["checklist_dealt_with"], job["checklist_total"]) == (6, 9)
    assert job["report"]["state"] == "draft"


def test_the_list_carries_full_jobs_so_the_app_can_store_them(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    body = _list(client, painter_headers)
    for job in [*body["jobs_today"], *body["earlier_unfinished"]]:
        assert _detail(client, painter_headers, job["id"]) == job


def test_priyas_list_has_her_open_job_first_then_the_submitted_one(
    client: TestClient, db_engine: Any
) -> None:
    body = _list(client, _priya_headers(db_engine))
    assert [(j["reference"], j["status"]) for j in body["jobs_today"]] == [
        ("JP-1066", "to_do"),
        ("JP-1065", "submitted"),
    ]
    assert body["earlier_unfinished"] == []


def test_every_other_operative_has_one_job_today(client: TestClient, db_engine: Any) -> None:
    for email, reference in (
        ("tom.bennett@jobproof.test", "JP-1067"),
        ("gareth.lewis@jobproof.test", "JP-1068"),
        ("kasia.nowak@jobproof.test", "JP-1069"),
        ("liam.oconnor@jobproof.test", "JP-1070"),
    ):
        headers = bearer(make_token(user_id(db_engine, email), role="painter"))
        body = _list(client, headers)
        assert [j["reference"] for j in body["jobs_today"]] == [reference]


def test_an_operative_with_no_jobs_gets_empty_lists(client: TestClient, temp_user: Any) -> None:
    from app.models.enums import UserRole

    user = temp_user(role=UserRole.painter)
    body = _list(client, bearer(make_token(user.id, role="painter")))
    assert body["jobs_today"] == [] and body["earlier_unfinished"] == []


def test_state_mapping_ordering_and_the_earlier_rules(client: TestClient, db_engine: Any) -> None:
    dan = user_id(db_engine, DAN_EMAIL)
    headers = bearer(make_token(dan, role="painter"))
    with (
        temp_job(db_engine, dan, status=JobStatus.cancelled, title="A cancelled") as cancelled,
        temp_job(db_engine, dan, status=JobStatus.completed, title="By the office") as office,
        temp_job(db_engine, dan, report=ReportState.submitted, title="Submitted") as submitted,
        temp_job(db_engine, dan, report=ReportState.draft, title="Draft") as draft,
        temp_job(db_engine, dan, scheduled=YESTERDAY, title="Missed, no report") as missed,
        temp_job(
            db_engine, dan, scheduled=YESTERDAY, status=JobStatus.cancelled, title="Old cancel"
        ),
        temp_job(db_engine, dan, scheduled=YESTERDAY, status=JobStatus.completed, title="Old done"),
        temp_job(
            db_engine, dan, scheduled=YESTERDAY, report=ReportState.submitted, title="Old sub"
        ),
        temp_job(db_engine, dan, scheduled=ANCHOR + dt.timedelta(days=1), title="Tomorrow"),
    ):
        body = _list(client, headers)
        today = {j["id"]: j for j in body["jobs_today"]}
        assert today[str(cancelled)]["status"] == "cancelled"
        assert today[str(office)]["status"] == "completed_by_office"
        assert today[str(submitted)]["status"] == "submitted"
        assert today[str(draft)]["status"] == "in_progress"
        statuses = [j["status"] for j in body["jobs_today"]]
        rank = {
            "in_progress": 0,
            "to_do": 0,
            "submitted": 1,
            "completed_by_office": 2,
            "cancelled": 3,
        }
        assert [rank[s] for s in statuses] == sorted(rank[s] for s in statuses)
        assert statuses[-1] == "cancelled"
        earlier = {j["id"]: j for j in body["earlier_unfinished"]}
        assert str(missed) in earlier
        titles = {j["title"] for j in body["earlier_unfinished"]}
        assert "Missed, no report" in titles and "Staircase and banister repaint" in titles
        assert not titles & {"Old cancel", "Old done", "Old sub", "Tomorrow"}
        assert "Tomorrow" not in {j["title"] for j in body["jobs_today"]}
        assert earlier[str(missed)]["status"] == "to_do"


def test_a_reassigned_job_stops_appearing_and_a_new_one_appears(
    client: TestClient, db_engine: Any
) -> None:
    dan = user_id(db_engine, DAN_EMAIL)
    priya = user_id(db_engine, PRIYA_EMAIL)
    headers = bearer(make_token(dan, role="painter"))
    before = {j["id"] for j in _list(client, headers)["jobs_today"]}
    with temp_job(db_engine, dan, title="Assigned in the meantime") as job_id:
        assert str(job_id) not in before
        assert str(job_id) in {j["id"] for j in _list(client, headers)["jobs_today"]}
        with db_engine.begin() as connection:
            connection.execute(
                text("UPDATE jobs SET painter_id = :p WHERE id = :j"), {"p": priya, "j": job_id}
            )
        assert str(job_id) not in {j["id"] for j in _list(client, headers)["jobs_today"]}
        assert client.get(f"{LIST}/{job_id}", headers=headers).status_code == 404


def test_the_list_uses_a_bounded_number_of_queries(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    from tests.test_performance_logging import count_queries

    dan = user_id(db_engine, DAN_EMAIL)
    with temp_job(db_engine, dan, labels=["a", "b", "c"], report=ReportState.draft):
        with count_queries(client) as few:
            client.get(LIST, headers=painter_headers)
        with (
            temp_job(db_engine, dan, labels=["a", "b", "c"], report=ReportState.draft),
            temp_job(db_engine, dan, labels=["a", "b", "c"], report=ReportState.draft),
            temp_job(db_engine, dan, labels=["a", "b", "c"], report=ReportState.draft),
        ):
            with count_queries(client) as many:
                response = client.get(LIST, headers=painter_headers)
            assert response.status_code == 200
    assert len(many) == len(few) <= 9


# ---- detail (T-003d) --------------------------------------------------------------------------
def _dan_job(client: TestClient, headers: dict[str, str], reference: str) -> dict[str, Any]:
    body = _list(client, headers)
    job = _by_ref([*body["jobs_today"], *body["earlier_unfinished"]])[reference]
    return _detail(client, headers, job["id"])


def test_lounge_job_detail(client: TestClient, painter_headers: dict[str, str]) -> None:
    job = _dan_job(client, painter_headers, "JP-1061")
    assert job["reference"] == "JP-1061" and job["job_type"] == "interior_repaint"
    assert job["scheduled_start"] == ANCHOR.isoformat()
    assert job["site_address"]["postcode"] == "BS6 5QA"
    assert "Key safe by the front door; code sent by text" in job["notes"]
    assert job["contact"] == {"name": "Rajesh Patel", "phone": "07700 900212"}
    assert job["report"] is None
    checklist = job["checklist"]
    assert len(checklist) == job["checklist_total"] == 9
    assert [i["position"] for i in checklist] == sorted(i["position"] for i in checklist)
    assert checklist[0]["label"] == "Furniture moved and covered with dust sheets"
    assert {(i["status"], i["note"], i["removed"]) for i in checklist} == {("open", None, False)}


def test_a_job_with_no_checklist_and_a_job_with_a_long_one(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    none = _dan_job(client, painter_headers, "JP-1062")
    assert none["checklist"] == [] and none["checklist_total"] == 0
    long = _dan_job(client, painter_headers, "JP-1063")
    assert len(long["checklist"]) == 14
    assert 1400 <= len(long["notes"]) <= 1600


def test_the_contact_is_the_contact_name_when_there_is_one(
    client: TestClient, db_engine: Any
) -> None:
    headers = bearer(make_token(user_id(db_engine, "kasia.nowak@jobproof.test"), role="painter"))
    job = _dan_job(client, headers, "JP-1069")
    assert job["contact"] == {"name": "Fiona Calloway", "phone": "07700 900202"}


def test_the_draft_shows_ticks_notes_and_no_submission(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    job = _dan_job(client, painter_headers, "JP-1064")
    statuses = [i["status"] for i in job["checklist"]]
    assert statuses == ["done"] * 6 + ["open"] * 3
    assert job["checklist"][1]["note"] == "Two hairline cracks on the third step, filled."
    report = job["report"]
    assert report["state"] == "draft" and report["notes"]
    assert report["submitted_at"] is None and report["submitted_by"] is None
    assert report["review_status"] is None and report["reviewed_by"] is None


def test_a_submitted_job_shows_who_submitted_it_and_that_it_awaits_review(
    client: TestClient, db_engine: Any
) -> None:
    headers = _priya_headers(db_engine)
    job = _dan_job(client, headers, "JP-1065")
    assert job["status"] == "submitted"
    report = job["report"]
    assert report["state"] == "submitted"
    assert report["submitted_by"]["name"] == "Priya Shah"
    assert report["review_status"] == "awaiting_review"
    assert report["reviewed_at"] is None and report["reviewed_by"] is None
    assert dt.datetime.fromisoformat(report["submitted_at"]).date() == ANCHOR
    assert (job["checklist_dealt_with"], job["checklist_total"]) == (4, 4)


def test_cannot_do_counts_only_with_a_reason_and_removed_items_come_last(
    client: TestClient, db_engine: Any
) -> None:
    dan = user_id(db_engine, DAN_EMAIL)
    headers = bearer(make_token(dan, role="painter"))
    with temp_job(
        db_engine,
        dan,
        labels=["Done", "No access", "No reason", "Untouched"],
        removed=["Gone with data", "Gone empty"],
        report=ReportState.draft,
        recorded={
            "Done": {"done": True},
            "No access": {"cannot_do": True, "note": "Loft locked"},
            "No reason": {"cannot_do": True, "note": "  "},
            "Gone with data": {"done": True, "note": "Did it before it was removed"},
            "Gone empty": {},
        },
    ) as job_id:
        job = _detail(client, headers, job_id)
    assert (job["checklist_dealt_with"], job["checklist_total"]) == (2, 4)
    rows = [(i["label"], i["status"], i["removed"]) for i in job["checklist"]]
    assert rows == [
        ("Done", "done", False),
        ("No access", "not_done", False),
        ("No reason", "not_done", False),
        ("Untouched", "open", False),
        ("Gone with data", "done", True),
    ]


def test_notes_changes_by_the_office_show_on_the_next_read(
    client: TestClient, db_engine: Any
) -> None:
    dan = user_id(db_engine, DAN_EMAIL)
    headers = bearer(make_token(dan, role="painter"))
    with temp_job(
        db_engine, dan, notes="Old", report=ReportState.draft, recorded={"First": {"done": True}}
    ) as job_id:
        assert _detail(client, headers, job_id)["notes"] == "Old"
        with db_engine.begin() as connection:
            connection.execute(text("UPDATE jobs SET notes = 'New' WHERE id = :j"), {"j": job_id})
        job = _detail(client, headers, job_id)
    assert job["notes"] == "New"
    assert job["checklist"][0]["status"] == "done"  # the draft's tick is untouched


def test_detail_of_any_date_and_status_of_my_own_job_works(
    client: TestClient, db_engine: Any
) -> None:
    dan = user_id(db_engine, DAN_EMAIL)
    headers = bearer(make_token(dan, role="painter"))
    old = ANCHOR - dt.timedelta(days=40)
    with temp_job(db_engine, dan, scheduled=old, status=JobStatus.completed) as job_id:
        job = _detail(client, headers, job_id)
    assert job["status"] == "completed_by_office"


def test_another_operatives_job_and_a_missing_job_are_the_same_404(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    priyas = _dan_job(client, _priya_headers(db_engine), "JP-1066")
    other = client.get(f"{LIST}/{priyas['id']}", headers=painter_headers)
    missing = client.get(f"{LIST}/{uuid.uuid4()}", headers=painter_headers)
    for response in (other, missing):
        assert response.status_code == 404
        assert_contract(response, "getOperativeJob")
        assert response.json()["code"] == "not_found"
    assert other.json()["detail"] == missing.json()["detail"]


def test_a_malformed_job_id_is_a_validation_error(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    response = client.get(f"{LIST}/not-a-uuid", headers=painter_headers)
    assert response.status_code == 422
    assert_contract(response, "getOperativeJob")


# ---- who may call -----------------------------------------------------------------------------
def test_only_operatives_may_call_and_a_token_is_required(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    painter_headers: dict[str, str],
) -> None:
    job_id = _list(client, painter_headers)["jobs_today"][0]["id"]
    for url, operation in ((LIST, "listOperativeJobs"), (f"{LIST}/{job_id}", "getOperativeJob")):
        for headers in (manager_headers, admin_headers):
            response = client.get(url, headers=headers)
            assert response.status_code == 403 and response.json()["code"] == "forbidden"
            assert_contract(response, operation)
        anonymous = client.get(url)
        assert anonymous.status_code == 401
        assert_contract(anonymous, operation)


def test_a_device_session_token_works_like_a_web_token(
    client: TestClient, operative_device_session: Any
) -> None:
    body = _list(client, operative_device_session.headers)
    assert len(body["jobs_today"]) == 3


# ---- bounds and ownership (review of Package B) ------------------------------------------------
def test_earlier_unfinished_reaches_30_days_back_and_no_further(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    dan = user_id(db_engine, DAN_EMAIL)
    with (
        temp_job(db_engine, dan, scheduled=ANCHOR - dt.timedelta(days=30), title="edge") as edge,
        temp_job(db_engine, dan, scheduled=ANCHOR - dt.timedelta(days=31), title="old") as old,
    ):
        ids = {j["id"] for j in _list(client, painter_headers)["earlier_unfinished"]}
        assert str(edge) in ids and str(old) not in ids


def test_earlier_unfinished_is_capped_at_50_oldest_first(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    from contextlib import ExitStack

    dan = user_id(db_engine, DAN_EMAIL)
    with ExitStack() as stack:
        made = [
            stack.enter_context(
                temp_job(db_engine, dan, scheduled=ANCHOR - dt.timedelta(days=2 + i % 20))
            )
            for i in range(52)
        ]
        earlier = _list(client, painter_headers)["earlier_unfinished"]
        assert len(earlier) == 50
        keys = [(j["scheduled_start"], j["reference"]) for j in earlier]
        assert keys == sorted(keys)
        assert all(j["scheduled_start"] <= YESTERDAY.isoformat() for j in earlier)
        assert len(made) == 52
        # Today's list is not capped by this.
        assert len(_list(client, painter_headers)["jobs_today"]) == 3


def test_a_draft_started_by_another_operative_is_409_and_hidden_from_the_list(
    client: TestClient, painter_headers: dict[str, str], db_engine: Any
) -> None:
    dan, priya = user_id(db_engine, DAN_EMAIL), user_id(db_engine, PRIYA_EMAIL)
    with temp_job(db_engine, dan, report=ReportState.draft) as job_id:
        with db_engine.begin() as connection:  # Priya started it, then the job went to Dan
            connection.execute(
                text("UPDATE job_reports SET painter_id = :p WHERE job_id = :j"),
                {"p": priya, "j": job_id},
            )
        detail = client.get(f"{LIST}/{job_id}", headers=painter_headers)
        assert detail.status_code == 409 and detail.json()["code"] == "draft_owned_by_other"
        assert_contract(detail, "getOperativeJob")
        body = _list(client, painter_headers)
        assert str(job_id) not in {j["id"] for j in body["jobs_today"]}
        write = client.patch(
            f"{LIST}/{job_id}/report", headers=painter_headers, json={"notes": "mine"}
        )
        assert write.status_code == 409 and write.json()["code"] == "draft_owned_by_other"
        assert_contract(write, "saveOperativeDraft")
        with db_engine.connect() as connection:
            notes = connection.execute(
                text("SELECT painter_notes FROM job_reports WHERE job_id = :j"), {"j": job_id}
            ).scalar_one()
        assert notes == "Temp notes"
        # Priya, the original author, is not the assignee any more: 404 as for any other job.
        priya_headers = _priya_headers(db_engine)
        assert client.get(f"{LIST}/{job_id}", headers=priya_headers).status_code == 404
