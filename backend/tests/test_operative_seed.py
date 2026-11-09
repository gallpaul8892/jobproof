"""T-003c and T-003d seed: the operative's "today" (pure dataset checks plus one database check)."""

import datetime as dt
from collections import Counter
from typing import Any

import pytest
from sqlalchemy import text

from app.models.enums import JobStatus, PhotoStage, ReportState, ReviewStatus
from app.seed.dataset import Dataset, build_dataset
from tests.conftest import ANCHOR

DAN = "painter@jobproof.test"


@pytest.fixture(scope="module")
def full() -> Dataset:
    return build_dataset(ANCHOR)


def _job(ds: Dataset, ref: str) -> Any:
    return next(j for j in ds.jobs if j.reference == ref)


def _items(ds: Dataset, ref: str) -> list[Any]:
    job = _job(ds, ref)
    return sorted(
        (i for i in ds.job_checklist_items if i.job_id == job.id), key=lambda i: i.position
    )


def test_dan_has_the_three_jobs_for_today_and_a_draft_from_yesterday(full: Dataset) -> None:
    dan = next(u for u in full.users if u.email == DAN)
    mine = sorted(
        (j for j in full.jobs if j.painter_id == dan.id and j.reference >= "JP-1061"),
        key=lambda j: j.reference,
    )
    assert [(j.title, j.site_postcode, j.scheduled_start) for j in mine] == [
        ("Repaint lounge, hall and landing", "BS6 5QA", ANCHOR),
        ("Paper bedroom feature wall", "BS8 2PX", ANCHOR),
        ("Exterior repaint, front elevation", "BS3 1AB", ANCHOR),
        ("Staircase and banister repaint", "BS6 6JR", ANCHOR - dt.timedelta(days=1)),
    ]
    assert "Key safe by the front door; code sent by text" in (mine[0].notes or "")
    assert 1400 <= len(mine[2].notes or "") <= 1600
    assert [len(_items(full, j.reference)) for j in mine] == [9, 0, 14, 9]


def test_the_draft_has_six_of_nine_done_and_is_invisible_in_the_manager_rows(
    full: Dataset,
) -> None:
    (draft,) = full.draft_reports
    assert draft.state is ReportState.draft
    assert draft.submitted_at is None and draft.submitted_by_id is None
    assert draft.review_status is None and draft.reviewed_at is None
    items = [i for i in full.draft_checklist_items if i.report_id == draft.id]
    assert len(items) == 9 and sum(i.done for i in items) == 6
    assert not any(i.cannot_do for i in items)
    assert draft.id not in {r.id for r in full.reports}
    assert {p.report_id for p in full.draft_photos} == {draft.id}
    assert not {p.id for p in full.draft_photos} & {p.id for p in full.photos}
    assert _job(full, "JP-1064").status is JobStatus.in_progress


def test_priyas_submitted_job_is_awaiting_review_with_two_before_and_two_after(
    full: Dataset,
) -> None:
    job = _job(full, "JP-1065")
    report = next(r for r in full.reports if r.job_id == job.id)
    assert job.scheduled_start == ANCHOR and job.completed_on == ANCHOR
    assert job.status is JobStatus.completed
    assert report.state is ReportState.submitted
    assert report.review_status is ReviewStatus.awaiting_review
    assert report.submitted_by_id == report.painter_id
    stages = Counter(p.stage for p in full.photos if p.report_id == report.id)
    assert stages == {PhotoStage.before: 2, PhotoStage.after: 2}
    assert all(p.taken_at < report.submitted_at for p in full.photos if p.report_id == report.id)  # type: ignore[operator]
    priya = [
        j for j in full.jobs if j.painter_id == report.painter_id and j.scheduled_start == ANCHOR
    ]
    assert sorted(j.reference for j in priya) == ["JP-1065", "JP-1066"]


def test_every_other_operative_has_one_job_today(full: Dataset) -> None:
    today = Counter(j.painter_id for j in full.jobs if j.scheduled_start == ANCHOR)
    others = [u for u in full.users if u.role.value == "painter" and u.email != DAN]
    assert len(others) == 5
    # Priya has two; Tom, Gareth, Kasia and Liam one each
    assert sorted(today[u.id] for u in others) == [1, 1, 1, 1, 2]


def test_every_original_job_has_job_items_equal_to_its_report_items(full: Dataset) -> None:
    job_items = {i.id: i for i in full.job_checklist_items}
    originals = full.without_operative_day()
    reports = {r.id: r for r in originals.reports}
    assert originals.checklist_items
    for item in originals.checklist_items:
        twin = job_items[item.id]
        assert twin.job_id == reports[item.report_id].job_id
        assert (twin.position, twin.label) == (item.position, item.label)
        assert twin.removed_at is None
    for job in originals.jobs:
        assert any(i.job_id == job.id for i in full.job_checklist_items), job.reference
    # positions are unique per job
    assert len({(i.job_id, i.position) for i in full.job_checklist_items}) == len(job_items)


def test_the_operative_rows_are_marked_and_the_original_dataset_is_unchanged(
    full: Dataset,
) -> None:
    originals = full.without_operative_day()
    assert len(originals.jobs) == 60 and len(originals.reports) == 60
    assert len(full.jobs) == 70
    assert len(full.reports) == 61 and len(full.draft_reports) == 1
    assert full.operative_row_ids
    assert not full.operative_row_ids & {j.id for j in originals.jobs}


@pytest.mark.parametrize(
    "anchor",
    [dt.date(2026, 11, 7), dt.date(2026, 11, 9), dt.date(2027, 1, 1), dt.date(2028, 2, 29)],
)
def test_the_operative_day_follows_the_anchor(anchor: dt.date) -> None:
    ds = build_dataset(anchor)
    assert build_dataset(anchor) == ds
    today = [j for j in ds.jobs if j.scheduled_start == anchor]
    assert len(today) == 9
    assert {j.scheduled_start for j in ds.jobs if j.reference >= "JP-1061"} == {
        anchor,
        anchor - dt.timedelta(days=1),
    }


def test_the_database_holds_the_operative_day(db_engine: Any, full: Dataset) -> None:
    with db_engine.connect() as connection:
        drafts = connection.execute(
            text("SELECT count(*) FROM job_reports WHERE state = 'draft'")
        ).scalar_one()
        jobs_today = connection.execute(
            text("SELECT count(*) FROM jobs WHERE scheduled_start = :d"), {"d": ANCHOR}
        ).scalar_one()
        orphans = connection.execute(
            text(
                "SELECT count(*) FROM report_checklist_items i "
                "LEFT JOIN job_checklist_items j ON j.id = i.id WHERE j.id IS NULL"
            )
        ).scalar_one()
    assert drafts == 1 and jobs_today == 9 and orphans == 0
