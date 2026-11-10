"""operative work model: job checklists and report state (T-003c)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-09

Order matters: the job checklist table is created and backfilled (same ids as the existing report
items) before the foreign key from report items is added; existing reports become `submitted`.
Downgrade refuses while a draft report or a "can't do" item exists (data it cannot represent).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

report_state = postgresql.ENUM("draft", "submitted", name="report_state", create_type=False)


def upgrade() -> None:
    # Convention for migrations that take ACCESS EXCLUSIVE locks on busy tables: fail fast
    # (5 s) instead of queueing behind a long query and blocking every request behind us.
    # SET LOCAL ends with this migration's transaction. Expected run time: well under a second
    # on pilot-sized data (a backfill of one row per report item plus a few ALTERs).
    op.execute("SET LOCAL lock_timeout = '5s'")
    # 1. the job's planned checklist
    op.create_table(
        "job_checklist_items",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_job_checklist_items_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_checklist_items")),
        sa.UniqueConstraint("job_id", "position", name=op.f("uq_job_checklist_items_job_id")),
    )
    op.create_index(op.f("ix_job_checklist_items_job_id"), "job_checklist_items", ["job_id"])

    # 2. backfill: one job item per existing report item, with the same id
    op.execute(
        "INSERT INTO job_checklist_items (id, job_id, position, label, created_at, updated_at) "
        "SELECT i.id, r.job_id, i.position, i.label, i.created_at, i.updated_at "
        "FROM report_checklist_items i JOIN job_reports r ON r.id = i.report_id"
    )

    # 3. a report item extends its job item
    op.alter_column("report_checklist_items", "id", server_default=None)
    op.create_foreign_key(
        op.f("fk_report_checklist_items_id_job_checklist_items"),
        "report_checklist_items",
        "job_checklist_items",
        ["id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column(
        "report_checklist_items",
        sa.Column("cannot_do", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_report_checklist_items_done_and_cannot_do_exclusive"),
        "report_checklist_items",
        "NOT (done AND cannot_do)",
    )

    # 4. report state; every existing report was submitted
    report_state.create(op.get_bind(), checkfirst=False)
    op.add_column(
        "job_reports",
        sa.Column("state", report_state, server_default="submitted", nullable=False),
    )
    op.alter_column("job_reports", "state", server_default=None)
    op.alter_column("job_reports", "submitted_at", nullable=True)
    op.alter_column("job_reports", "review_status", nullable=True)
    op.add_column("job_reports", sa.Column("submitted_by_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE job_reports SET submitted_by_id = painter_id")
    op.create_foreign_key(
        op.f("fk_job_reports_submitted_by_id_users"),
        "job_reports",
        "users",
        ["submitted_by_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_job_reports_state"), "job_reports", ["state"])

    # 5. consistency
    op.create_check_constraint(
        op.f("ck_job_reports_submitted_fields_match_state"),
        "job_reports",
        "(state = 'submitted') = (submitted_at IS NOT NULL AND submitted_by_id IS NOT NULL"
        " AND review_status IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_job_reports_draft_not_reviewed"),
        "job_reports",
        "state = 'submitted' OR (reviewed_at IS NULL AND reviewed_by_id IS NULL)",
    )


def downgrade() -> None:
    connection = op.get_bind()
    drafts = connection.execute(
        sa.text("SELECT count(*) FROM job_reports WHERE state = 'draft'")
    ).scalar_one()
    cannot_do = connection.execute(
        sa.text("SELECT count(*) FROM report_checklist_items WHERE cannot_do")
    ).scalar_one()
    # The older schema has no job-level checklist: job items with no matching report item, or
    # removed by the office, would be lost silently.
    unmatched = connection.execute(
        sa.text(
            "SELECT count(*) FROM job_checklist_items j "
            "WHERE j.removed_at IS NOT NULL "
            "OR NOT EXISTS (SELECT 1 FROM report_checklist_items r WHERE r.id = j.id)"
        )
    ).scalar_one()
    if drafts or cannot_do or unmatched:
        raise RuntimeError(
            f"Cannot downgrade 0010: {drafts} draft report(s), {cannot_do} 'can't do' item(s) "
            f"and {unmatched} job checklist item(s) with no report item or removed by the "
            "office exist and the older schema cannot hold them."
        )

    op.drop_constraint(op.f("ck_job_reports_draft_not_reviewed"), "job_reports", type_="check")
    op.drop_constraint(
        op.f("ck_job_reports_submitted_fields_match_state"), "job_reports", type_="check"
    )
    op.drop_index(op.f("ix_job_reports_state"), table_name="job_reports")
    op.drop_constraint(
        op.f("fk_job_reports_submitted_by_id_users"), "job_reports", type_="foreignkey"
    )
    op.drop_column("job_reports", "submitted_by_id")
    op.alter_column("job_reports", "review_status", nullable=False)
    op.alter_column("job_reports", "submitted_at", nullable=False)
    op.drop_column("job_reports", "state")
    report_state.drop(op.get_bind(), checkfirst=False)

    op.drop_constraint(
        op.f("ck_report_checklist_items_done_and_cannot_do_exclusive"),
        "report_checklist_items",
        type_="check",
    )
    op.drop_column("report_checklist_items", "cannot_do")
    op.drop_constraint(
        op.f("fk_report_checklist_items_id_job_checklist_items"),
        "report_checklist_items",
        type_="foreignkey",
    )
    op.alter_column(
        "report_checklist_items", "id", server_default=sa.text("gen_random_uuid()")
    )
    op.drop_index(op.f("ix_job_checklist_items_job_id"), table_name="job_checklist_items")
    op.drop_table("job_checklist_items")
