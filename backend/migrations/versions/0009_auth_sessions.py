"""operative device sessions (T-003b)

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("device_name", sa.Text(), nullable=True),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("app_version", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_hash", sa.CHAR(64), nullable=False),
        sa.Column("previous_refresh_hash", sa.CHAR(64), nullable=True),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("generation", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "platform IN ('android', 'ios')", name=op.f("ck_auth_sessions_platform_known")
        ),
        sa.CheckConstraint(
            "revoked_reason IN ('signed_out', 'replaced', 'deactivated', 'reuse_detected')",
            name=op.f("ck_auth_sessions_revoked_reason_known"),
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)",
            name=op.f("ck_auth_sessions_revoked_fields_together"),
        ),
        sa.CheckConstraint(
            "idle_expires_at <= absolute_expires_at",
            name=op.f("ck_auth_sessions_idle_within_absolute"),
        ),
        sa.CheckConstraint("generation >= 1", name=op.f("ck_auth_sessions_generation_positive")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_sessions_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
    )
    op.create_index(op.f("ix_auth_sessions_user_id"), "auth_sessions", ["user_id"])
    op.create_index(
        "uq_auth_sessions_active_device",
        "auth_sessions",
        ["user_id", "device_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("auth_sessions")
