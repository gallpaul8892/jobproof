"""report submission fields and audit actions (T-003h)

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-22

Additive: three nullable columns on job_reports (null for every existing, seeded report) and two
audit_action values. Downgrade refuses while a `report.submitted` or `report.photo_received`
event exists (the audit trail is append-only; the older enum cannot hold them).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ACTIONS = (
    "report.reviewed",
    "report.reopened",
    "report.edited",
    "settings.changed",
    "customer.edited",
)


def upgrade() -> None:
    # An enum value cannot be used in the transaction that added it; commit it first (as 0007).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'report.submitted'")
        op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'report.photo_received'")
    op.add_column("job_reports", sa.Column("submission_id", sa.Uuid(), nullable=True))
    op.add_column(
        "job_reports", sa.Column("device_submitted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "job_reports", sa.Column("submit_clock_offset_seconds", sa.Integer(), nullable=True)
    )
    op.create_unique_constraint(
        op.f("uq_job_reports_submission_id"), "job_reports", ["submission_id"]
    )


def downgrade() -> None:
    events = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM audit_events "
                "WHERE action::text IN ('report.submitted', 'report.photo_received')"
            )
        )
        .scalar_one()
    )
    if events:
        raise RuntimeError(
            f"Cannot downgrade 0012: {events} report.submitted / report.photo_received audit "
            "event(s) exist. Audit events are append-only and cannot be removed."
        )
    op.drop_constraint(op.f("uq_job_reports_submission_id"), "job_reports", type_="unique")
    op.drop_column("job_reports", "submit_clock_offset_seconds")
    op.drop_column("job_reports", "device_submitted_at")
    op.drop_column("job_reports", "submission_id")
    labels = ", ".join(f"'{label}'" for label in _OLD_ACTIONS)
    op.execute("ALTER TYPE audit_action RENAME TO audit_action_old")
    op.execute(f"CREATE TYPE audit_action AS ENUM ({labels})")
    op.execute(
        "ALTER TABLE audit_events ALTER COLUMN action TYPE audit_action "
        "USING action::text::audit_action"
    )
    op.execute("DROP TYPE audit_action_old")
