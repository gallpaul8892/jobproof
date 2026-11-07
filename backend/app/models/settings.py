"""The single company settings record (T-002a, decision D1)."""

import datetime as dt
import uuid

from sqlalchemy import CHAR, CheckConstraint, DateTime, SmallInteger, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_HEX = "^#[0-9A-F]{6}$"
_THEME_COLUMNS = ("primary", "accent", "background", "surface", "text")


class CompanySettings(Base):
    """Exactly one row (id = 1). No FK into users on purpose: the seed truncates users with
    CASCADE, which would otherwise wipe this row. Names are snapshots, as in the audit trail."""

    __tablename__ = "company_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint(
            "char_length(company_name) BETWEEN 1 AND 60 AND company_name = btrim(company_name)",
            name="company_name_valid",
        ),
        *(
            CheckConstraint(f"theme_{name} ~ '{_HEX}'", name=f"theme_{name}_hex")
            for name in _THEME_COLUMNS
        ),
        CheckConstraint(
            "(updated_at IS NULL) = (updated_by_id IS NULL) "
            "AND (updated_by_id IS NULL) = (updated_by_name IS NULL)",
            name="updated_fields_together",
        ),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=text("1"))
    company_name: Mapped[str] = mapped_column(Text)
    theme_primary: Mapped[str] = mapped_column(CHAR(7))
    theme_accent: Mapped[str] = mapped_column(CHAR(7))
    theme_background: Mapped[str] = mapped_column(CHAR(7))
    theme_surface: Mapped[str] = mapped_column(CHAR(7))
    theme_text: Mapped[str] = mapped_column(CHAR(7))
    updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    updated_by_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
