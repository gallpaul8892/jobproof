"""initial schema: the nine Phase 1 tables (T-001b)

Revision ID: 0001
Revises:
Create Date: 2026-11-07
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ENUM_TYPES = (
    "user_role",
    "customer_type",
    "job_type",
    "job_status",
    "quote_status",
    "review_status",
    "photo_stage",
    "invoice_state",
    "payment_kind",
    "payment_method",
)


def upgrade() -> None:
    op.create_table('customers',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('customer_type', sa.Enum('homeowner', 'landlord', 'business', name='customer_type'), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('contact_name', sa.Text(), nullable=True),
    sa.Column('email', sa.Text(), nullable=True),
    sa.Column('phone', sa.Text(), nullable=True),
    sa.Column('billing_line1', sa.Text(), nullable=False),
    sa.Column('billing_line2', sa.Text(), nullable=True),
    sa.Column('billing_town', sa.Text(), nullable=False),
    sa.Column('billing_county', sa.Text(), nullable=True),
    sa.Column('billing_postcode', sa.Text(), nullable=False),
    sa.Column('payment_terms_days', sa.SmallInteger(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('payment_terms_days BETWEEN 0 AND 120', name=op.f('ck_customers_payment_terms_range')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_customers'))
    )
    op.create_index('ix_customers_lower_name', 'customers', [sa.literal_column('lower(name)')], unique=False)
    op.create_table('users',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', sa.Text(), nullable=False),
    sa.Column('full_name', sa.Text(), nullable=False),
    sa.Column('role', sa.Enum('manager', 'painter', name='user_role'), nullable=False),
    sa.Column('phone', sa.Text(), nullable=True),
    sa.Column('password_hash', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('email = lower(email)', name=op.f('ck_users_email_lowercase')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    op.create_index('uq_users_email', 'users', ['email'], unique=True)
    op.create_table('jobs',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.Text(), nullable=False),
    sa.Column('customer_id', sa.Uuid(), nullable=False),
    sa.Column('painter_id', sa.Uuid(), nullable=True),
    sa.Column('job_type', sa.Enum('interior_repaint', 'exterior_repaint', 'wallpapering', 'kitchen_cabinet_spray', 'staircase_woodwork', 'commercial_unit', name='job_type'), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('status', sa.Enum('scheduled', 'in_progress', 'completed', 'cancelled', name='job_status'), nullable=False),
    sa.Column('site_line1', sa.Text(), nullable=False),
    sa.Column('site_line2', sa.Text(), nullable=True),
    sa.Column('site_town', sa.Text(), nullable=False),
    sa.Column('site_county', sa.Text(), nullable=True),
    sa.Column('site_postcode', sa.Text(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('scheduled_start', sa.Date(), nullable=False),
    sa.Column('completed_on', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'completed') = (completed_on IS NOT NULL)", name=op.f('ck_jobs_completed_on_matches_status')),
    sa.CheckConstraint('completed_on IS NULL OR completed_on >= scheduled_start', name=op.f('ck_jobs_completed_after_start')),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_jobs_customer_id_customers'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['painter_id'], ['users.id'], name=op.f('fk_jobs_painter_id_users'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_jobs')),
    sa.UniqueConstraint('reference', name=op.f('uq_jobs_reference'))
    )
    op.create_index(op.f('ix_jobs_completed_on'), 'jobs', ['completed_on'], unique=False)
    op.create_index(op.f('ix_jobs_customer_id'), 'jobs', ['customer_id'], unique=False)
    op.create_index(op.f('ix_jobs_painter_id'), 'jobs', ['painter_id'], unique=False)
    op.create_table('invoices',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('job_id', sa.Uuid(), nullable=False),
    sa.Column('customer_id', sa.Uuid(), nullable=False),
    sa.Column('number', sa.Text(), nullable=False),
    sa.Column('state', sa.Enum('draft', 'issued', 'void', name='invoice_state'), nullable=False),
    sa.Column('subtotal_pence', sa.Integer(), nullable=False),
    sa.Column('vat_pence', sa.Integer(), nullable=False),
    sa.Column('deposit_applied_pence', sa.Integer(), server_default='0', nullable=False),
    sa.Column('total_pence', sa.Integer(), nullable=False),
    sa.Column('currency', sa.CHAR(length=3), server_default='GBP', nullable=False),
    sa.Column('issue_date', sa.Date(), nullable=True),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(state = 'draft') = (issue_date IS NULL) AND (state = 'draft') = (due_date IS NULL)", name=op.f('ck_invoices_dates_match_state')),
    sa.CheckConstraint("currency = 'GBP'", name=op.f('ck_invoices_currency_gbp')),
    sa.CheckConstraint('due_date >= issue_date', name=op.f('ck_invoices_due_after_issue')),
    sa.CheckConstraint('subtotal_pence >= 0 AND vat_pence >= 0 AND deposit_applied_pence >= 0', name=op.f('ck_invoices_money_non_negative')),
    sa.CheckConstraint('total_pence = subtotal_pence + vat_pence - deposit_applied_pence', name=op.f('ck_invoices_total_matches_parts')),
    sa.CheckConstraint('total_pence > 0', name=op.f('ck_invoices_total_positive')),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_invoices_customer_id_customers'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], name=op.f('fk_invoices_job_id_jobs'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_invoices')),
    sa.UniqueConstraint('number', name=op.f('uq_invoices_number'))
    )
    op.create_index(op.f('ix_invoices_customer_id'), 'invoices', ['customer_id'], unique=False)
    op.create_index('ix_invoices_issue_date', 'invoices', ['issue_date'], unique=False)
    op.create_index('uq_invoices_job_id_not_void', 'invoices', ['job_id'], unique=True, postgresql_where=sa.text("state <> 'void'"))
    op.create_table('job_reports',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('job_id', sa.Uuid(), nullable=False),
    sa.Column('painter_id', sa.Uuid(), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('painter_notes', sa.Text(), nullable=True),
    sa.Column('review_status', sa.Enum('awaiting_review', 'reviewed', name='review_status'), nullable=False),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reviewed_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(review_status = 'reviewed') = (reviewed_at IS NOT NULL AND reviewed_by_id IS NOT NULL) AND (reviewed_at IS NULL) = (reviewed_by_id IS NULL)", name=op.f('ck_job_reports_review_fields_match_status')),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], name=op.f('fk_job_reports_job_id_jobs'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['painter_id'], ['users.id'], name=op.f('fk_job_reports_painter_id_users'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id'], name=op.f('fk_job_reports_reviewed_by_id_users'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_job_reports')),
    sa.UniqueConstraint('job_id', name=op.f('uq_job_reports_job_id'))
    )
    op.create_index(op.f('ix_job_reports_painter_id'), 'job_reports', ['painter_id'], unique=False)
    op.create_index(op.f('ix_job_reports_review_status'), 'job_reports', ['review_status'], unique=False)
    op.create_index('ix_job_reports_submitted_at', 'job_reports', [sa.literal_column('submitted_at DESC')], unique=False)
    op.create_table('quotes',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('job_id', sa.Uuid(), nullable=False),
    sa.Column('reference', sa.Text(), nullable=False),
    sa.Column('status', sa.Enum('draft', 'sent', 'accepted', 'declined', 'expired', name='quote_status'), nullable=False),
    sa.Column('subtotal_pence', sa.Integer(), nullable=False),
    sa.Column('vat_pence', sa.Integer(), nullable=False),
    sa.Column('total_pence', sa.Integer(), nullable=False),
    sa.Column('deposit_pence', sa.Integer(), server_default='0', nullable=False),
    sa.Column('currency', sa.CHAR(length=3), server_default='GBP', nullable=False),
    sa.Column('issued_on', sa.Date(), nullable=False),
    sa.Column('valid_until', sa.Date(), nullable=False),
    sa.Column('accepted_on', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("currency = 'GBP'", name=op.f('ck_quotes_currency_gbp')),
    sa.CheckConstraint('deposit_pence <= total_pence', name=op.f('ck_quotes_deposit_within_total')),
    sa.CheckConstraint('subtotal_pence >= 0 AND vat_pence >= 0 AND total_pence >= 0 AND deposit_pence >= 0', name=op.f('ck_quotes_money_non_negative')),
    sa.CheckConstraint('total_pence = subtotal_pence + vat_pence', name=op.f('ck_quotes_total_matches_parts')),
    sa.CheckConstraint('valid_until >= issued_on', name=op.f('ck_quotes_valid_until_after_issue')),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], name=op.f('fk_quotes_job_id_jobs'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_quotes')),
    sa.UniqueConstraint('reference', name=op.f('uq_quotes_reference'))
    )
    op.create_index(op.f('ix_quotes_job_id'), 'quotes', ['job_id'], unique=False)
    op.create_table('payments',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('kind', sa.Enum('deposit', 'invoice', name='payment_kind'), nullable=False),
    sa.Column('quote_id', sa.Uuid(), nullable=True),
    sa.Column('invoice_id', sa.Uuid(), nullable=True),
    sa.Column('amount_pence', sa.Integer(), nullable=False),
    sa.Column('currency', sa.CHAR(length=3), server_default='GBP', nullable=False),
    sa.Column('method', sa.Enum('card', 'bank_transfer', 'cash', name='payment_method'), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('provider_ref', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(kind = 'deposit' AND quote_id IS NOT NULL AND invoice_id IS NULL) OR (kind = 'invoice' AND invoice_id IS NOT NULL AND quote_id IS NULL)", name=op.f('ck_payments_target_matches_kind')),
    sa.CheckConstraint("currency = 'GBP'", name=op.f('ck_payments_currency_gbp')),
    sa.CheckConstraint('amount_pence > 0', name=op.f('ck_payments_amount_positive')),
    sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], name=op.f('fk_payments_invoice_id_invoices'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['quote_id'], ['quotes.id'], name=op.f('fk_payments_quote_id_quotes'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_payments'))
    )
    op.create_index(op.f('ix_payments_invoice_id'), 'payments', ['invoice_id'], unique=False)
    op.create_index(op.f('ix_payments_quote_id'), 'payments', ['quote_id'], unique=False)
    op.create_table('report_checklist_items',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('report_id', sa.Uuid(), nullable=False),
    sa.Column('position', sa.SmallInteger(), nullable=False),
    sa.Column('label', sa.Text(), nullable=False),
    sa.Column('done', sa.Boolean(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['report_id'], ['job_reports.id'], name=op.f('fk_report_checklist_items_report_id_job_reports'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_report_checklist_items')),
    sa.UniqueConstraint('report_id', 'position', name=op.f('uq_report_checklist_items_report_id'))
    )
    op.create_table('report_photos',
    sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('report_id', sa.Uuid(), nullable=False),
    sa.Column('stage', sa.Enum('before', 'during', 'after', name='photo_stage'), nullable=False),
    sa.Column('position', sa.SmallInteger(), nullable=False),
    sa.Column('caption', sa.Text(), nullable=False),
    sa.Column('taken_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('width', sa.Integer(), nullable=False),
    sa.Column('height', sa.Integer(), nullable=False),
    sa.Column('storage_key', sa.Text(), nullable=True),
    sa.Column('content_type', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('width > 0 AND height > 0', name=op.f('ck_report_photos_dimensions_positive')),
    sa.ForeignKeyConstraint(['report_id'], ['job_reports.id'], name=op.f('fk_report_photos_report_id_job_reports'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_report_photos'))
    )
    op.create_index('ix_report_photos_report_id_stage_taken_at', 'report_photos', ['report_id', 'stage', 'taken_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_report_photos_report_id_stage_taken_at', table_name='report_photos')
    op.drop_table('report_photos')
    op.drop_table('report_checklist_items')
    op.drop_index(op.f('ix_payments_quote_id'), table_name='payments')
    op.drop_index(op.f('ix_payments_invoice_id'), table_name='payments')
    op.drop_table('payments')
    op.drop_index(op.f('ix_quotes_job_id'), table_name='quotes')
    op.drop_table('quotes')
    op.drop_index('ix_job_reports_submitted_at', table_name='job_reports')
    op.drop_index(op.f('ix_job_reports_review_status'), table_name='job_reports')
    op.drop_index(op.f('ix_job_reports_painter_id'), table_name='job_reports')
    op.drop_table('job_reports')
    op.drop_index('uq_invoices_job_id_not_void', table_name='invoices', postgresql_where=sa.text("state <> 'void'"))
    op.drop_index('ix_invoices_issue_date', table_name='invoices')
    op.drop_index(op.f('ix_invoices_customer_id'), table_name='invoices')
    op.drop_table('invoices')
    op.drop_index(op.f('ix_jobs_painter_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_customer_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_completed_on'), table_name='jobs')
    op.drop_table('jobs')
    op.drop_index('uq_users_email', table_name='users')
    op.drop_table('users')
    op.drop_index('ix_customers_lower_name', table_name='customers')
    op.drop_table('customers')
    # Native enum types are created with their tables above; drop them explicitly.
    bind = op.get_bind()
    for name in ENUM_TYPES:
        sa.Enum(name=name).drop(bind, checkfirst=True)
