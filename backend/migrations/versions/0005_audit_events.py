"""append-only audit trail (T-002f)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-08
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0005'
down_revision: str | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACTIONS = ('report.reviewed', 'report.reopened', 'report.edited', 'settings.changed')
_ENTITIES = ('report', 'settings')


def upgrade() -> None:
    action = postgresql.ENUM(*_ACTIONS, name='audit_action', create_type=False)
    entity = postgresql.ENUM(*_ENTITIES, name='audit_entity', create_type=False)
    action.create(op.get_bind(), checkfirst=False)
    entity.create(op.get_bind(), checkfirst=False)
    op.create_table(
        'audit_events',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('seq', sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('actor_id', sa.Uuid(), nullable=False),
        sa.Column('actor_name', sa.Text(), nullable=False),
        sa.Column('action', action, nullable=False),
        sa.Column('entity_type', entity, nullable=False),
        sa.Column('report_id', sa.Uuid(), nullable=True),
        sa.Column('request_id', sa.Text(), nullable=True),
        sa.Column(
            'changes',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(entity_type = 'report') = (report_id IS NOT NULL)",
            name=op.f('ck_audit_events_report_id_matches_entity'),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(changes) = 'array'", name=op.f('ck_audit_events_changes_is_array')
        ),
        sa.ForeignKeyConstraint(
            ['actor_id'], ['users.id'], name=op.f('fk_audit_events_actor_id_users'), ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['report_id'],
            ['job_reports.id'],
            name=op.f('fk_audit_events_report_id_job_reports'),
            ondelete='RESTRICT',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_events')),
        sa.UniqueConstraint('seq', name=op.f('uq_audit_events_seq')),
    )
    op.create_index(
        'ix_audit_events_report_id_seq',
        'audit_events',
        ['report_id', sa.text('seq DESC')],
    )
    op.create_index(
        'ix_audit_events_settings_seq',
        'audit_events',
        [sa.text('seq DESC')],
        postgresql_where=sa.text("entity_type = 'settings'"),
    )
    op.execute(
        """
        CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION audit_events_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF coalesce(current_setting('jobproof.allow_audit_truncate', true), '') <> 'on' THEN
                RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER audit_events_no_update_delete BEFORE UPDATE OR DELETE ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()"
    )
    op.execute(
        "CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events "
        "FOR EACH STATEMENT EXECUTE FUNCTION audit_events_truncate_guard()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER audit_events_no_truncate ON audit_events")
    op.execute("DROP TRIGGER audit_events_no_update_delete ON audit_events")
    op.execute("DROP FUNCTION audit_events_truncate_guard()")
    op.execute("DROP FUNCTION audit_events_append_only()")
    op.drop_table('audit_events')
    op.execute("DROP TYPE audit_entity")
    op.execute("DROP TYPE audit_action")
