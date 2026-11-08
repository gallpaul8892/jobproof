"""admin setting: UK-only customer contact details (T-002p)

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-08
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0008'
down_revision: str | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing rows get TRUE, the strict default. Stored customer data is not touched.
    op.add_column(
        'company_settings',
        sa.Column(
            'uk_only_contact_details', sa.Boolean(), server_default=sa.text('true'), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_column('company_settings', 'uk_only_contact_details')
