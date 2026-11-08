"""Python enums behind the Postgres native enum types."""

from enum import StrEnum


class UserRole(StrEnum):
    manager = "manager"
    painter = "painter"
    admin = "admin"


class CustomerType(StrEnum):
    homeowner = "homeowner"
    landlord = "landlord"
    business = "business"


class JobType(StrEnum):
    interior_repaint = "interior_repaint"
    exterior_repaint = "exterior_repaint"
    wallpapering = "wallpapering"
    kitchen_cabinet_spray = "kitchen_cabinet_spray"
    staircase_woodwork = "staircase_woodwork"
    commercial_unit = "commercial_unit"


class JobStatus(StrEnum):
    scheduled = "scheduled"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class QuoteStatus(StrEnum):
    draft = "draft"
    sent = "sent"
    accepted = "accepted"
    declined = "declined"
    expired = "expired"


class ReviewStatus(StrEnum):
    awaiting_review = "awaiting_review"
    reviewed = "reviewed"


class PhotoStage(StrEnum):
    before = "before"
    during = "during"
    after = "after"


class InvoiceState(StrEnum):
    draft = "draft"
    issued = "issued"
    void = "void"


class PaymentKind(StrEnum):
    deposit = "deposit"
    invoice = "invoice"


class PaymentMethod(StrEnum):
    card = "card"
    bank_transfer = "bank_transfer"
    cash = "cash"


class ReportSort(StrEnum):
    default = "default"
    submitted_asc = "submitted_asc"


class AuditAction(StrEnum):
    report_reviewed = "report.reviewed"
    report_reopened = "report.reopened"
    report_edited = "report.edited"
    settings_changed = "settings.changed"
    customer_edited = "customer.edited"


class AuditEntity(StrEnum):
    report = "report"
    settings = "settings"
    customer = "customer"
