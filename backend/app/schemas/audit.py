"""Audit history responses (T-002f)."""

import uuid

from pydantic import BaseModel, Field

from app.models.enums import AuditAction
from app.schemas.common import PersonRef, UtcDatetime


class AuditChange(BaseModel):
    field: str
    item_id: uuid.UUID | None
    item_label: str | None
    old_value: str | bool | None
    new_value: str | bool | None


class AuditEvent(BaseModel):
    id: uuid.UUID
    occurred_at: UtcDatetime
    actor: PersonRef
    action: AuditAction
    changes: list[AuditChange]


class AuditHistory(BaseModel):
    items: list[AuditEvent] = Field(max_length=100)
    total: int
