"""Append-only audit trail (T-002f). Immutability is enforced by triggers (migration 0005)."""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, pg_enum, uuid_pk
from app.models.enums import AuditAction, AuditEntity


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint(
            "(entity_type = 'report') = (report_id IS NOT NULL)", name="report_id_matches_entity"
        ),
        CheckConstraint("jsonb_typeof(changes) = 'array'", name="changes_is_array"),
        Index("ix_audit_events_report_id_seq", "report_id", text("seq DESC")),
        Index(
            "ix_audit_events_settings_seq",
            text("seq DESC"),
            postgresql_where=text("entity_type = 'settings'"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True), unique=True)
    occurred_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    actor_name: Mapped[str] = mapped_column(Text)
    action: Mapped[AuditAction] = mapped_column(pg_enum(AuditAction, "audit_action"))
    entity_type: Mapped[AuditEntity] = mapped_column(pg_enum(AuditEntity, "audit_entity"))
    report_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("job_reports.id", ondelete="RESTRICT")
    )
    request_id: Mapped[str | None] = mapped_column(Text)
    changes: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
