"""Response models for the operative (mobile) endpoints (T-003c, T-003d).

Dedicated schemas on purpose: they have no `manager_notes`, money, customer email or billing
address, so those cannot leak by reuse of a manager model (design section 8). Properties that
belong to later tickets (`photos`, `submission_id`, `device_submitted_at`, `sign_off`) are added
by those tickets.
"""

import datetime as dt
import enum
import uuid
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.models.enums import JobType, ReportState, ReviewStatus
from app.schemas.common import Address, PersonRef, UtcDatetime
from app.schemas.report_write import reject_unstorable


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


# ---- draft save (T-003f) ----------------------------------------------------------------------
DRAFT_NOTES_MAX = 2000
ITEM_NOTE_MAX = 500
DRAFT_CHECKLIST_MAX = 200

# Multi-line text rule shared with the manager's report edit: NUL and lone surrogates refused.
DraftNotesText = Annotated[
    str, Field(max_length=DRAFT_NOTES_MAX), AfterValidator(reject_unstorable)
]
DraftItemNoteText = Annotated[
    str, Field(max_length=ITEM_NOTE_MAX), AfterValidator(reject_unstorable)
]


class DraftChecklistUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: uuid.UUID
    status: ChecklistStatus | None = None
    note: DraftItemNoteText | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> Self:
        sent = self.model_fields_set
        if "status" in sent and self.status is None:
            raise ValueError("Use open, done or not_done.")
        if not ({"status", "note"} & sent):
            raise ValueError("Send status, note or both.")
        return self


class DraftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: DraftNotesText | None = None
    checklist: (
        Annotated[list[DraftChecklistUpdate], Field(min_length=1, max_length=DRAFT_CHECKLIST_MAX)]
        | None
    ) = None

    @model_validator(mode="after")
    def _valid(self) -> Self:
        sent = self.model_fields_set
        if "checklist" in sent and self.checklist is None:
            raise ValueError("Send a list of checklist items.")
        if not ({"notes", "checklist"} & sent):
            raise ValueError("Send at least one field to change.")
        if self.checklist is not None:
            ids = [i.item_id for i in self.checklist]
            if len(set(ids)) != len(ids):
                raise ValueError("Each checklist item may be sent once.")
        return self
