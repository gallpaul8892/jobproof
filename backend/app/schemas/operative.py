"""Response models for the operative (mobile) endpoints (T-003c, T-003d).

Dedicated schemas on purpose: they have no `manager_notes`, money, customer email or billing
address, so those cannot leak by reuse of a manager model (design section 8). `sign_off` belongs
to T-003o and is added by that ticket. Photos carry no location: only managers see it (T-003k).
"""

import datetime as dt
import enum
import uuid
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from app.models.enums import (
    JobType,
    LocationSource,
    PhotoSource,
    PhotoStage,
    ReportState,
    ReviewStatus,
    TakenAtSource,
)
from app.schemas.common import Address, PersonRef, UtcDatetime
from app.schemas.report_write import reject_unstorable
from app.schemas.text import clean_text


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


class OperativePhoto(BaseModel):
    """A registered photo as its operative sees it (no location, no storage keys)."""

    id: uuid.UUID
    stage: PhotoStage
    checklist_item_id: uuid.UUID | None
    caption: str
    source: PhotoSource
    taken_at: UtcDatetime
    taken_at_source: TakenAtSource
    registered_at: UtcDatetime
    received_at: UtcDatetime | None
    clock_offset_seconds: int | None
    thumb_url: str | None


class OperativeReport(BaseModel):
    id: uuid.UUID
    state: ReportState
    notes: str | None
    submitted_at: UtcDatetime | None
    submitted_by: PersonRef | None
    review_status: ReviewStatus | None
    reviewed_at: UtcDatetime | None
    reviewed_by: PersonRef | None
    submission_id: uuid.UUID | None
    device_submitted_at: UtcDatetime | None
    photos: list[OperativePhoto]


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


# ---- photo registration (T-003g, T-003k) ------------------------------------------------------
CAPTION_MAX = 140
_SHA256 = Field(pattern=r"^[0-9a-f]{64}$")


class PhotoLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float | None = Field(ge=0, le=100000, allow_inf_nan=False)
    source: LocationSource


class PhotoFileFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    width: int = Field(ge=1, le=20000)
    height: int = Field(ge=1, le=20000)
    bytes: int = Field(ge=1)
    sha256: str = _SHA256


class UploadFileFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    width: int = Field(ge=1, le=4096)
    height: int = Field(ge=1, le=4096)
    bytes: int = Field(ge=1, le=10485760)
    sha256: str = _SHA256
    content_type: Literal["image/jpeg", "image/png"]


def _caption(value: str) -> str:
    return clean_text(value, required_message=None, max_length=CAPTION_MAX) or ""


class PhotoRegistration(BaseModel):
    """A full representation (PUT): an omitted item means none, an omitted caption means ""."""

    model_config = ConfigDict(extra="forbid")

    stage: PhotoStage
    checklist_item_id: uuid.UUID | None = None
    caption: Annotated[str, AfterValidator(_caption)] = ""
    source: PhotoSource
    taken_at: AwareDatetime
    taken_at_source: TakenAtSource
    device_sent_at: AwareDatetime
    location: PhotoLocation | None = None
    original: PhotoFileFacts
    upload: UploadFileFacts


# ---- submit (T-003h) --------------------------------------------------------------------------
class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_id: uuid.UUID
    device_submitted_at: AwareDatetime
    device_sent_at: AwareDatetime
    photo_ids: Annotated[list[uuid.UUID], Field(max_length=60)]
    draft: DraftUpdate | None = None

    @model_validator(mode="after")
    def _unique_photos(self) -> Self:
        if len(set(self.photo_ids)) != len(self.photo_ids):
            raise ValueError("Each photo may be listed once.")
        return self
