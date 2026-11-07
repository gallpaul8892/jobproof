"""Python enums behind the Postgres native enum types."""

from enum import StrEnum


class UserRole(StrEnum):
    manager = "manager"
    painter = "painter"


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
