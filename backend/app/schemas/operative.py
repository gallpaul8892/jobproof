"""Response models for the operative (mobile) endpoints (T-003c, T-003d).

Dedicated schemas on purpose: they have no `manager_notes`, money, customer email or billing
address, so those cannot leak by reuse of a manager model (design section 8). Properties that
belong to later tickets (`photos`, `submission_id`, `device_submitted_at`, `sign_off`) are added
by those tickets.
"""

import datetime as dt
import enum
import uuid

from pydantic import BaseModel

from app.models.enums import JobType, ReportState, ReviewStatus
from app.schemas.common import Address, PersonRef, UtcDatetime


class OperativeJobStatus(enum.StrEnum):
    to_do = "to_do"
    in_progress = "in_progress"
    submitted = "submitted"
    completed_by_office = "completed_by_office"
    cancelled = "cancelled"


class ChecklistStatus(enum.StrEnum):
    open = "open"
    done = "done"
    not_done = "not_done"


class OperativeContact(BaseModel):
    name: str
    phone: str | None


class OperativeChecklistItem(BaseModel):
    id: uuid.UUID
    position: int
    label: str
    status: ChecklistStatus
    note: str | None
    removed: bool


class OperativeReport(BaseModel):
    id: uuid.UUID
    state: ReportState
    notes: str | None
    submitted_at: UtcDatetime | None
    submitted_by: PersonRef | None
    review_status: ReviewStatus | None
    reviewed_at: UtcDatetime | None
    reviewed_by: PersonRef | None


class OperativeJob(BaseModel):
    id: uuid.UUID
    reference: str
    title: str
    job_type: JobType
    status: OperativeJobStatus
    scheduled_start: dt.date
    site_address: Address
    checklist_total: int
    checklist_dealt_with: int
    notes: str | None
    contact: OperativeContact | None
    checklist: list[OperativeChecklistItem]
    report: OperativeReport | None


class OperativeJobList(BaseModel):
    as_of: UtcDatetime
    today: dt.date
    jobs_today: list[OperativeJob]
    earlier_unfinished: list[OperativeJob]
