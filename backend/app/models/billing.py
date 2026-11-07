"""Invoices and payments (deposits against quotes, payments against invoices)."""

import datetime as dt
import uuid

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, pg_enum, uuid_pk
from app.models.enums import InvoiceState, PaymentKind, PaymentMethod
from app.models.work import Job, Quote


class Invoice(TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint(
            "total_pence = subtotal_pence + vat_pence - deposit_applied_pence",
            name="total_matches_parts",
        ),
        CheckConstraint("total_pence > 0", name="total_positive"),
        CheckConstraint(
            "subtotal_pence >= 0 AND vat_pence >= 0 AND deposit_applied_pence >= 0",
            name="money_non_negative",
        ),
        CheckConstraint("currency = 'GBP'", name="currency_gbp"),
        CheckConstraint(
            "(state = 'draft') = (issue_date IS NULL) AND (state = 'draft') = (due_date IS NULL)",
            name="dates_match_state",
        ),
        CheckConstraint("due_date >= issue_date", name="due_after_issue"),
        Index(
            "uq_invoices_job_id_not_void",
            "job_id",
            unique=True,
            postgresql_where=text("state <> 'void'"),
        ),
        Index("ix_invoices_issue_date", "issue_date"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"))
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), index=True
    )
    number: Mapped[str] = mapped_column(Text, unique=True)
    state: Mapped[InvoiceState] = mapped_column(pg_enum(InvoiceState, "invoice_state"))
    subtotal_pence: Mapped[int] = mapped_column(Integer)
    vat_pence: Mapped[int] = mapped_column(Integer)
    deposit_applied_pence: Mapped[int] = mapped_column(Integer, server_default="0")
    total_pence: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="GBP")
    issue_date: Mapped[dt.date | None] = mapped_column(Date)
    due_date: Mapped[dt.date | None] = mapped_column(Date)

    job: Mapped[Job] = relationship(back_populates="invoices")
    payments: Mapped[list["Payment"]] = relationship(back_populates="invoice")


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'deposit' AND quote_id IS NOT NULL AND invoice_id IS NULL)"
            " OR (kind = 'invoice' AND invoice_id IS NOT NULL AND quote_id IS NULL)",
            name="target_matches_kind",
        ),
        CheckConstraint("amount_pence > 0", name="amount_positive"),
        CheckConstraint("currency = 'GBP'", name="currency_gbp"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[PaymentKind] = mapped_column(pg_enum(PaymentKind, "payment_kind"))
    quote_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("quotes.id", ondelete="RESTRICT"), index=True
    )
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("invoices.id", ondelete="RESTRICT"), index=True
    )
    amount_pence: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="GBP")
    method: Mapped[PaymentMethod] = mapped_column(pg_enum(PaymentMethod, "payment_method"))
    received_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    provider_ref: Mapped[str | None] = mapped_column(Text)

    quote: Mapped[Quote | None] = relationship()
    invoice: Mapped[Invoice | None] = relationship(back_populates="payments")
