"""company settings: the single branding record (T-002a)

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-07
"""
import os
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen on purpose: a migration records what it inserted and never imports app code that may
# change later (T-002a assumption A3).
_FALLBACK_NAME = "Arbour Services"
_THEME = {
    "theme_primary": "#1F5130",
    "theme_accent": "#2F5D3A",
    "theme_background": "#FFFFFF",
    "theme_surface": "#F4F7F2",
    "theme_text": "#1B1F1C",
}
_HEX = "^#[0-9A-F]{6}$"


# Control and invisible formatting characters; frozen copy of the company-name rule.
_FORBIDDEN = re.compile("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


def _company_name() -> str:
    """DEFAULT_COMPANY_NAME from the environment (the only place it is read), else the fallback."""
    name = (os.environ.get("DEFAULT_COMPANY_NAME") or "").strip(" ") or _FALLBACK_NAME
    if len(name) > 60:
        raise RuntimeError("DEFAULT_COMPANY_NAME must be 60 characters or fewer")
    if _FORBIDDEN.search(name):
        raise RuntimeError("DEFAULT_COMPANY_NAME must not contain control characters")
    return name


def upgrade() -> None:
    name = _company_name()
    op.create_table(
        'company_settings',
        sa.Column('id', sa.SmallInteger(), server_default=sa.text('1'), nullable=False),
        sa.Column('company_name', sa.Text(), nullable=False),
        sa.Column('theme_primary', sa.CHAR(length=7), nullable=False),
        sa.Column('theme_accent', sa.CHAR(length=7), nullable=False),
        sa.Column('theme_background', sa.CHAR(length=7), nullable=False),
        sa.Column('theme_surface', sa.CHAR(length=7), nullable=False),
        sa.Column('theme_text', sa.CHAR(length=7), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_by_id', sa.Uuid(), nullable=True),
        sa.Column('updated_by_name', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('id = 1', name=op.f('ck_company_settings_singleton')),
        sa.CheckConstraint(
            'char_length(company_name) BETWEEN 1 AND 60 AND company_name = btrim(company_name)',
            name=op.f('ck_company_settings_company_name_valid'),
        ),
        *(
            sa.CheckConstraint(f"{column} ~ '{_HEX}'", name=op.f(f'ck_company_settings_{column}_hex'))
            for column in _THEME
        ),
        sa.CheckConstraint(
            '(updated_at IS NULL) = (updated_by_id IS NULL) '
            'AND (updated_by_id IS NULL) = (updated_by_name IS NULL)',
            name=op.f('ck_company_settings_updated_fields_together'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_company_settings')),
    )
    table = sa.table(
        'company_settings',
        sa.column('id', sa.SmallInteger()),
        sa.column('company_name', sa.Text()),
        *(sa.column(column, sa.CHAR(length=7)) for column in _THEME),
    )
    stmt = postgresql.insert(table).values(id=1, company_name=name, **_THEME)
    op.execute(stmt.on_conflict_do_nothing(index_elements=['id']))


def downgrade() -> None:
    op.drop_table('company_settings')
