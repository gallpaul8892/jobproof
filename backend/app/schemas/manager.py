"""Response models for the manager endpoints."""

import datetime as dt
import uuid

from pydantic import BaseModel, Field

from app.models.enums import (
    CustomerType,
    JobStatus,
    JobType,
    PaymentKind,
    PaymentMethod,
    PhotoStage,
    QuoteStatus,
    ReviewStatus,
)
from app.schemas.common import Address, Currency, PersonRef, UtcDatetime
from app.services.billing import BillingStatus, InvoiceStatus


class ReportSummary(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    job_reference: str
    job_type: JobType
    customer: PersonRef
    site_address: Address
    painter: PersonRef
    completed_on: dt.date
    submitted_at: UtcDatetime
    photo_count: int
    review_status: ReviewStatus
    billing_status: BillingStatus


class ReportPage(BaseModel):
    items: list[ReportSummary]
    total: int
    page: int
    page_size: int


class Dashboard(BaseModel):
    as_of: UtcDatetime
    period_start: dt.date
    period_end: dt.date
    reports_awaiting_review: int
    jobs_completed_this_month: int
    invoiced_this_month_pence: int
    outstanding_pence: int
    overdue_invoice_count: int
    currency: Currency = "GBP"
    review_queue: list[ReportSummary] = Field(max_length=5)
    recent_reports: list[ReportSummary] = Field(max_length=5)


class ChecklistItem(BaseModel):
    id: uuid.UUID
    label: str
    done: bool
    note: str | None


class ReportPhoto(BaseModel):
    id: uuid.UUID
    stage: PhotoStage
    caption: str
    taken_at: UtcDatetime
    width: int
    height: int
    url: str
    thumb_url: str


class JobDetail(BaseModel):
    id: uuid.UUID
    reference: str
    job_type: JobType
    title: str
    status: JobStatus
    site_address: Address
    notes: str | None
    scheduled_start: dt.date
    completed_on: dt.date | None


class CustomerDetail(BaseModel):
    id: uuid.UUID
    name: str
    customer_type: CustomerType
    contact_name: str | None
    email: str | None
    phone: str | None
    billing_address: Address
    job_count: int


class QuoteSummary(BaseModel):
    id: uuid.UUID
    reference: str
    status: QuoteStatus
    total_pence: int
    deposit_pence: int
    deposit_paid_pence: int
    currency: Currency = "GBP"
    issued_on: dt.date
    accepted_on: dt.date | None


class InvoiceSummary(BaseModel):
    id: uuid.UUID
    number: str
    status: InvoiceStatus
    subtotal_pence: int
    vat_pence: int
    deposit_applied_pence: int
    total_pence: int
    paid_pence: int
    balance_pence: int
    currency: Currency = "GBP"
    issue_date: dt.date | None
    due_date: dt.date | None


class Payment(BaseModel):
    id: uuid.UUID
    kind: PaymentKind
    amount_pence: int
    currency: Currency = "GBP"
    received_at: UtcDatetime
    method: PaymentMethod


class ReportDetail(BaseModel):
    id: uuid.UUID
    review_status: ReviewStatus
    submitted_at: UtcDatetime
    reviewed_at: UtcDatetime | None
    reviewed_by: PersonRef | None
    version: int
    last_changed_at: UtcDatetime | None
    last_changed_by: PersonRef | None
    painter_notes: str | None
    manager_notes: str | None
    billing_status: BillingStatus
    job: JobDetail
    customer: CustomerDetail
    painter: PersonRef
    checklist: list[ChecklistItem]
    photos: list[ReportPhoto]
    quote: QuoteSummary | None
    invoice: InvoiceSummary | None
    payments: list[Payment]


class InvoiceRow(BaseModel):
    id: uuid.UUID
    number: str
    status: InvoiceStatus
    customer: PersonRef
    job_id: uuid.UUID
    job_reference: str
    report_id: uuid.UUID | None
    total_pence: int
    paid_pence: int
    balance_pence: int
    currency: Currency = "GBP"
    issue_date: dt.date | None
    due_date: dt.date | None


class InvoicePage(BaseModel):
    items: list[InvoiceRow]
    total: int
    page: int
    page_size: int
