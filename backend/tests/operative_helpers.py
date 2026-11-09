"""Helpers for operative API tests: throwaway jobs in the shared test database."""

import datetime as dt
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models import Customer, Job, JobChecklistItem, JobReport, ReportChecklistItem, User
from app.models.enums import JobStatus, JobType, ReportState, ReviewStatus
from tests.conftest import ANCHOR

DAN_EMAIL = "painter@jobproof.test"
PRIYA_EMAIL = "priya.shah@jobproof.test"


def user_id(engine: Engine, email: str) -> uuid.UUID:
    with Session(engine) as session:
        found = session.scalar(select(User.id).where(User.email == email))
        assert found is not None
        return found


@contextmanager
def temp_job(
    engine: Engine,
    painter_id: uuid.UUID,
    *,
    scheduled: dt.date = ANCHOR,
    status: JobStatus = JobStatus.scheduled,
    labels: Sequence[str] = ("First", "Second"),
    removed: Sequence[str] = (),
    title: str = "Temp job",
    notes: str | None = None,
    report: ReportState | None = None,
    recorded: dict[str, dict[str, Any]] | None = None,
) -> Iterator[uuid.UUID]:
    """Insert a job (committed, so the API sees it) and remove it afterwards.

    `report` adds a report in that state. `recorded` maps a label to the operative's data on that
    item (`done`, `cannot_do`, `note`); items with data get a report item.
    """
    job_id = uuid.uuid4()
    report_id = uuid.uuid4()
    with Session(engine) as session:
        customer = session.scalars(select(Customer).order_by(Customer.name)).first()
        assert customer is not None
        completed = scheduled if status == JobStatus.completed else None
        session.add(
            Job(
                id=job_id,
                reference=f"TMP-{job_id.hex[:8]}",
                customer_id=customer.id,
                painter_id=painter_id,
                job_type=JobType.interior_repaint,
                title=title,
                status=status,
                site_line1="1 Test Street",
                site_town="Bristol",
                site_postcode="BS1 1AA",
                notes=notes,
                scheduled_start=scheduled,
                completed_on=completed,
            )
        )
        session.flush()
        items: dict[str, uuid.UUID] = {}
        for position, label in enumerate([*labels, *removed], start=1):
            item = JobChecklistItem(
                id=uuid.uuid4(),
                job_id=job_id,
                position=position,
                label=label,
                removed_at=(dt.datetime(2026, 10, 1, tzinfo=dt.UTC) if label in removed else None),
            )
            session.add(item)
            items[label] = item.id
        if report is not None:
            session.flush()
            submitted = report == ReportState.submitted
            session.add(
                JobReport(
                    id=report_id,
                    job_id=job_id,
                    painter_id=painter_id,
                    state=report,
                    submitted_at=dt.datetime(2026, 10, 15, 8, tzinfo=dt.UTC) if submitted else None,
                    submitted_by_id=painter_id if submitted else None,
                    review_status=ReviewStatus.awaiting_review if submitted else None,
                    painter_notes="Temp notes",
                )
            )
            session.flush()
            for position, (label, data) in enumerate((recorded or {}).items(), start=1):
                session.add(
                    ReportChecklistItem(
                        id=items[label],
                        report_id=report_id,
                        position=position,
                        label=label,
                        done=bool(data.get("done", False)),
                        cannot_do=bool(data.get("cannot_do", False)),
                        note=data.get("note"),
                    )
                )
        session.commit()
    try:
        yield job_id
    finally:
        with engine.begin() as connection:
            params = {"j": job_id}
            connection.execute(
                text(
                    "DELETE FROM report_checklist_items WHERE report_id IN "
                    "(SELECT id FROM job_reports WHERE job_id = :j)"
                ),
                params,
            )
            connection.execute(text("DELETE FROM job_reports WHERE job_id = :j"), params)
            connection.execute(text("DELETE FROM job_checklist_items WHERE job_id = :j"), params)
            connection.execute(text("DELETE FROM jobs WHERE id = :j"), params)
