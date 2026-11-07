"""admin role for company settings (T-002b)

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-07
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Allowed inside a transaction on Postgres 12+ as long as the value is not used here.
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin'")


def downgrade() -> None:
    bind = op.get_bind()
    admins = bind.execute(sa.text("SELECT count(*) FROM users WHERE role::text = 'admin'")).scalar()
    if admins:
        raise RuntimeError(
            f"Cannot downgrade: {admins} user(s) have role 'admin'. "
            "Remove or change those users first; downgrading would lose them."
        )
    op.execute("ALTER TYPE user_role RENAME TO user_role_old")
    op.execute("CREATE TYPE user_role AS ENUM ('manager', 'painter')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role"
    )
    op.execute("DROP TYPE user_role_old")
