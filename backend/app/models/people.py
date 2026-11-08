"""Users (manager and painters) and customers."""

import datetime as dt
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, pg_enum, uuid_pk
from app.models.enums import CustomerType, UserRole


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        Index("uq_users_email", "email", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(Text)
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"))
    phone: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint("payment_terms_days BETWEEN 0 AND 120", name="payment_terms_range"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            "(last_changed_at IS NULL) = (last_changed_by_id IS NULL)",
            name="last_changed_fields_together",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    customer_type: Mapped[CustomerType] = mapped_column(pg_enum(CustomerType, "customer_type"))
    name: Mapped[str] = mapped_column(Text)
    contact_name: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    billing_line1: Mapped[str] = mapped_column(Text)
    billing_line2: Mapped[str | None] = mapped_column(Text)
    billing_town: Mapped[str] = mapped_column(Text)
    billing_county: Mapped[str | None] = mapped_column(Text)
    billing_postcode: Mapped[str] = mapped_column(Text)
    payment_terms_days: Mapped[int] = mapped_column(SmallInteger)
    notes: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    last_changed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_changed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )


Index("ix_customers_lower_name", func.lower(Customer.name))
