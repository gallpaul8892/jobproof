"""report versioning for optimistic concurrency (T-002g)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-08
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'job_reports',
        sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
    )
    op.add_column('job_reports', sa.Column('last_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('job_reports', sa.Column('last_changed_by_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f('fk_job_reports_last_changed_by_id_users'),
        'job_reports',
        'users',
        ['last_changed_by_id'],
        ['id'],
        ondelete='RESTRICT',
    )
    op.create_check_constraint(op.f('ck_job_reports_version_positive'), 'job_reports', 'version >= 1')
    op.create_check_constraint(
        op.f('ck_job_reports_last_changed_fields_together'),
        'job_reports',
        '(last_changed_at IS NULL) = (last_changed_by_id IS NULL)',
    )


def downgrade() -> None:
    op.drop_constraint(op.f('ck_job_reports_last_changed_fields_together'), 'job_reports', type_='check')
    op.drop_constraint(op.f('ck_job_reports_version_positive'), 'job_reports', type_='check')
    op.drop_constraint(op.f('fk_job_reports_last_changed_by_id_users'), 'job_reports', type_='foreignkey')
    op.drop_column('job_reports', 'last_changed_by_id')
    op.drop_column('job_reports', 'last_changed_at')
    op.drop_column('job_reports', 'version')
