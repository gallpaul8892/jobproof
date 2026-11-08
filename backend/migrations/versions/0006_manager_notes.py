"""internal manager notes on reports (T-002i)

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-08
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0006'
down_revision: str | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('manager_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'manager_notes')
