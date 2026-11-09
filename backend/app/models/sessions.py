"""Operative device sessions (T-003b): one row per signed-in phone, hashed refresh tokens."""

import datetime as dt
import uuid

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, uuid_pk


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        CheckConstraint("platform IN ('android', 'ios')", name="platform_known"),
        CheckConstraint(
            "revoked_reason IN ('signed_out', 'replaced', 'deactivated', 'reuse_detected')",
            name="revoked_reason_known",
        ),
        CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)", name="revoked_fields_together"
        ),
        CheckConstraint("idle_expires_at <= absolute_expires_at", name="idle_within_absolute"),
        CheckConstraint("generation >= 1", name="generation_positive"),
        Index(
            "uq_auth_sessions_active_device",
            "user_id",
            "device_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    device_name: Mapped[str | None] = mapped_column(Text)
    platform: Mapped[str] = mapped_column(Text)
    app_version: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_used_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    idle_expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    absolute_expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    refresh_hash: Mapped[str] = mapped_column(CHAR(64))
    previous_refresh_hash: Mapped[str | None] = mapped_column(CHAR(64))
    rotated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    generation: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(Text)
