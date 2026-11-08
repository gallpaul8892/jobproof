"""Request bodies for report writes (T-002g, T-002i). Hostile input is rejected here."""

import uuid
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

NOTES_MAX = 5000
CHECKLIST_NOTE_MAX = 500
# Well above any real checklist; keeps the 422 for a hostile body small.
CHECKLIST_MAX_ITEMS = 100

Version = Annotated[int, Field(strict=True, ge=1)]


def reject_unstorable(value: str) -> str:
    """NUL cannot be stored in Postgres text; lone surrogates cannot be encoded as UTF-8."""
    if "\x00" in value:
        raise ValueError("Remove NUL characters.")
    if any("\ud800" <= ch <= "\udfff" for ch in value):
        raise ValueError("Remove invalid characters.")
    return value


SafeText = Annotated[str, AfterValidator(reject_unstorable)]
# The length rule comes before the validator, so the message is the text one
# ("String should have at most 5000 characters"), not the generic "items after validation".
ChecklistNoteText = Annotated[
    str, Field(max_length=CHECKLIST_NOTE_MAX), AfterValidator(reject_unstorable)
]
NotesText = Annotated[str, Field(max_length=NOTES_MAX), AfterValidator(reject_unstorable)]


def empty_to_none(value: str | None) -> str | None:
    """Notes are stored exactly as sent, except that blank means no note (assumption A3)."""
    if value is None or not value.strip():
        return None
    return value


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version


class ChecklistItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    done: Annotated[bool, Field(strict=True)] | None = None
    note: ChecklistNoteText | None = None

    @field_validator("done")
    @classmethod
    def _done_not_null(cls, value: bool | None) -> bool | None:
        if value is None:
            raise ValueError("Use true or false.")
        return value

    @model_validator(mode="after")
    def _something_to_change(self) -> Self:
        if not ({"done", "note"} & self.model_fields_set):
            raise ValueError("Send done, note or both.")
        return self


class ReportUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version
    painter_notes: NotesText | None = None
    manager_notes: NotesText | None = None
    checklist: (
        Annotated[list[ChecklistItemUpdate], Field(min_length=1, max_length=CHECKLIST_MAX_ITEMS)]
        | None
    ) = None

    @field_validator("checklist")
    @classmethod
    def _checklist_not_null(
        cls, value: list[ChecklistItemUpdate] | None
    ) -> list[ChecklistItemUpdate] | None:
        if value is None:
            raise ValueError("Send a list of checklist items.")
        if len({item.id for item in value}) != len(value):
            raise ValueError("Each checklist item may be sent once.")
        return value

    @model_validator(mode="after")
    def _at_least_one_field(self) -> Self:
        if not ({"painter_notes", "manager_notes", "checklist"} & self.model_fields_set):
            raise ValueError("Send at least one field to change.")
        return self
