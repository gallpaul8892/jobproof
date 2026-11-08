"""customer versioning and customer audit events (T-002n)

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-08
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0007'
down_revision: str | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ACTIONS = ('report.reviewed', 'report.reopened', 'report.edited', 'settings.changed')
_OLD_ENTITIES = ('report', 'settings')


def upgrade() -> None:
    # Postgres cannot use an enum value in the transaction that added it, and the check
    # constraint below compares against 'customer', so commit the new values first.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'customer.edited'")
        op.execute("ALTER TYPE audit_entity ADD VALUE IF NOT EXISTS 'customer'")

    op.add_column(
        'customers',
        sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
    )
    op.add_column('customers', sa.Column('last_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('customers', sa.Column('last_changed_by_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f('fk_customers_last_changed_by_id_users'),
        'customers',
        'users',
        ['last_changed_by_id'],
        ['id'],
        ondelete='RESTRICT',
    )
    op.create_check_constraint(op.f('ck_customers_version_positive'), 'customers', 'version >= 1')
    op.create_check_constraint(
        op.f('ck_customers_last_changed_fields_together'),
        'customers',
        '(last_changed_at IS NULL) = (last_changed_by_id IS NULL)',
    )

    op.add_column('audit_events', sa.Column('customer_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f('fk_audit_events_customer_id_customers'),
        'audit_events',
        'customers',
        ['customer_id'],
        ['id'],
        ondelete='RESTRICT',
    )
    op.create_check_constraint(
        op.f('ck_audit_events_customer_id_matches_entity'),
        'audit_events',
        "(entity_type = 'customer') = (customer_id IS NOT NULL)",
    )
    op.create_index(
        'ix_audit_events_customer_id_seq',
        'audit_events',
        ['customer_id', sa.text('seq DESC')],
    )


def _recreate_enum(name: str, labels: tuple[str, ...], column: str) -> None:
    quoted = ", ".join(f"'{label}'" for label in labels)
    op.execute(f"ALTER TYPE {name} RENAME TO {name}_old")
    op.execute(f"CREATE TYPE {name} AS ENUM ({quoted})")
    op.execute(
        f"ALTER TABLE audit_events ALTER COLUMN {column} TYPE {name} USING {column}::text::{name}"
    )
    op.execute(f"DROP TYPE {name}_old")


def downgrade() -> None:
    bind = op.get_bind()
    events = bind.execute(
        sa.text("SELECT count(*) FROM audit_events WHERE action::text = 'customer.edited'")
    ).scalar()
    if events:
        raise RuntimeError(
            f"Cannot downgrade: {events} customer.edited audit event(s) exist. "
            "Audit events are append-only and cannot be removed; downgrading would lose them."
        )
    op.drop_index('ix_audit_events_customer_id_seq', table_name='audit_events')
    op.drop_constraint(op.f('ck_audit_events_customer_id_matches_entity'), 'audit_events', type_='check')
    op.drop_constraint(op.f('fk_audit_events_customer_id_customers'), 'audit_events', type_='foreignkey')
    op.drop_column('audit_events', 'customer_id')

    op.drop_constraint(op.f('ck_customers_last_changed_fields_together'), 'customers', type_='check')
    op.drop_constraint(op.f('ck_customers_version_positive'), 'customers', type_='check')
    op.drop_constraint(op.f('fk_customers_last_changed_by_id_users'), 'customers', type_='foreignkey')
    op.drop_column('customers', 'last_changed_by_id')
    op.drop_column('customers', 'last_changed_at')
    op.drop_column('customers', 'version')

    # Objects that mention the enum columns are dropped around the type swap and recreated.
    op.drop_constraint(op.f('ck_audit_events_report_id_matches_entity'), 'audit_events', type_='check')
    op.drop_index('ix_audit_events_settings_seq', table_name='audit_events')
    _recreate_enum('audit_action', _OLD_ACTIONS, 'action')
    _recreate_enum('audit_entity', _OLD_ENTITIES, 'entity_type')
    op.create_check_constraint(
        op.f('ck_audit_events_report_id_matches_entity'),
        'audit_events',
        "(entity_type = 'report') = (report_id IS NOT NULL)",
    )
    op.create_index(
        'ix_audit_events_settings_seq',
        'audit_events',
        [sa.text('seq DESC')],
        postgresql_where=sa.text("entity_type = 'settings'"),
    )
