"""Jobs, quotes, completion reports, checklist items and photos."""

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, pg_enum, uuid_pk
from app.models.enums import (
    JobStatus,
    JobType,
    PhotoStage,
    QuoteStatus,
    ReviewStatus,
)
from app.models.people import Customer, User

if TYPE_CHECKING:
    from app.models.billing import Invoice


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "(status = 'completed') = (completed_on IS NOT NULL)",
            name="completed_on_matches_status",
        ),
        CheckConstraint(
            "completed_on IS NULL OR completed_on >= scheduled_start", name="completed_after_start"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(Text, unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), index=True
    )
    painter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    job_type: Mapped[JobType] = mapped_column(pg_enum(JobType, "job_type"))
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[JobStatus] = mapped_column(pg_enum(JobStatus, "job_status"))
    site_line1: Mapped[str] = mapped_column(Text)
    site_line2: Mapped[str | None] = mapped_column(Text)
    site_town: Mapped[str] = mapped_column(Text)
    site_county: Mapped[str | None] = mapped_column(Text)
    site_postcode: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    scheduled_start: Mapped[dt.date] = mapped_column(Date)
    completed_on: Mapped[dt.date | None] = mapped_column(Date, index=True)

    customer: Mapped[Customer] = relationship()
    painter: Mapped[User | None] = relationship()
    report: Mapped["JobReport | None"] = relationship(back_populates="job")
    quotes: Mapped[list["Quote"]] = relationship(back_populates="job")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="job")


class Quote(TimestampMixin, Base):
    __tablename__ = "quotes"
    __table_args__ = (
        CheckConstraint("total_pence = subtotal_pence + vat_pence", name="total_matches_parts"),
        CheckConstraint(
            "subtotal_pence >= 0 AND vat_pence >= 0 AND total_pence >= 0 AND deposit_pence >= 0",
            name="money_non_negative",
        ),
        CheckConstraint("deposit_pence <= total_pence", name="deposit_within_total"),
        CheckConstraint("currency = 'GBP'", name="currency_gbp"),
        CheckConstraint("valid_until >= issued_on", name="valid_until_after_issue"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jobs.id", ondelete="RESTRICT"), index=True
    )
    reference: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[QuoteStatus] = mapped_column(pg_enum(QuoteStatus, "quote_status"))
    subtotal_pence: Mapped[int] = mapped_column(Integer)
    vat_pence: Mapped[int] = mapped_column(Integer)
    total_pence: Mapped[int] = mapped_column(Integer)
    deposit_pence: Mapped[int] = mapped_column(Integer, server_default="0")
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="GBP")
    issued_on: Mapped[dt.date] = mapped_column(Date)
    valid_until: Mapped[dt.date] = mapped_column(Date)
    accepted_on: Mapped[dt.date | None] = mapped_column(Date)

    job: Mapped[Job] = relationship(back_populates="quotes")


class JobReport(TimestampMixin, Base):
    __tablename__ = "job_reports"
    __table_args__ = (
        CheckConstraint(
            "(review_status = 'reviewed') = "
            "(reviewed_at IS NOT NULL AND reviewed_by_id IS NOT NULL)"
            " AND (reviewed_at IS NULL) = (reviewed_by_id IS NULL)",
            name="review_fields_match_status",
        ),
        Index("ix_job_reports_submitted_at", text("submitted_at DESC")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True
    )
    painter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    painter_notes: Mapped[str | None] = mapped_column(Text)
    review_status: Mapped[ReviewStatus] = mapped_column(
        pg_enum(ReviewStatus, "review_status"), index=True
    )
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )

    job: Mapped[Job] = relationship(back_populates="report")
    painter: Mapped[User] = relationship(foreign_keys=[painter_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])
    checklist_items: Mapped[list["ReportChecklistItem"]] = relationship(
        back_populates="report", order_by="ReportChecklistItem.position"
    )
    photos: Mapped[list["ReportPhoto"]] = relationship(
        back_populates="report", order_by="ReportPhoto.position"
    )


class ReportChecklistItem(TimestampMixin, Base):
    __tablename__ = "report_checklist_items"
    __table_args__ = (UniqueConstraint("report_id", "position"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_reports.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(SmallInteger)
    label: Mapped[str] = mapped_column(Text)
    done: Mapped[bool] = mapped_column(Boolean)
    note: Mapped[str | None] = mapped_column(Text)

    report: Mapped[JobReport] = relationship(back_populates="checklist_items")


class ReportPhoto(TimestampMixin, Base):
    __tablename__ = "report_photos"
    __table_args__ = (
        CheckConstraint("width > 0 AND height > 0", name="dimensions_positive"),
        Index("ix_report_photos_report_id_stage_taken_at", "report_id", "stage", "taken_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_reports.id", ondelete="CASCADE"))
    stage: Mapped[PhotoStage] = mapped_column(pg_enum(PhotoStage, "photo_stage"))
    position: Mapped[int] = mapped_column(SmallInteger)
    caption: Mapped[str] = mapped_column(Text)
    taken_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str | None] = mapped_column(Text)

    report: Mapped[JobReport] = relationship(back_populates="photos")
