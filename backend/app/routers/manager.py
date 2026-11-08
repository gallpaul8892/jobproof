"""Manager-only read endpoints. The router-level dependency guards every route added here."""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.exceptions import RequestValidationError

from app.clock import now, today_london
from app.deps import CurrentUser, PhotoStoreDep, SessionDep, require_roles
from app.models.enums import ReportSort, ReviewStatus, UserRole
from app.schemas import audit as audit_schemas
from app.schemas import manager as schemas
from app.schemas import report_write
from app.schemas.common import PersonRef
from app.services import audit, dashboard, invoices, painters, report_edit, reports, review
from app.services.billing import BillingStatus, InvoiceStatus

router = APIRouter(
    prefix="/api/v1/manager", dependencies=[Depends(require_roles(UserRole.manager))]
)


@dataclass(frozen=True)
class PageParams:
    page: int
    page_size: int


def pagination(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PageParams:
    return PageParams(page, page_size)


PageDep = Annotated[PageParams, Depends(pagination)]


def report_filters(
    review_status: ReviewStatus | None = None,
    billing_status: BillingStatus | None = None,
    painter_id: uuid.UUID | None = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    q: Annotated[str | None, Query(min_length=1, max_length=100, pattern=r"^[^\x00]*$")] = None,
    sort: ReportSort = ReportSort.default,
) -> reports.ReportFilters:
    if date_from is not None and date_to is not None and date_to < date_from:
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("query", "date_to"),
                    "msg": "date_to must not be before date_from",
                    "input": date_to.isoformat(),
                }
            ]
        )
    return reports.ReportFilters(
        review_status=review_status,
        billing_status=billing_status,
        painter_id=painter_id,
        date_from=date_from,
        date_to=date_to,
        q=(q.strip() or None) if q else None,  # blank after trimming means "no search"
        sort=sort,
    )


@router.get("/dashboard", response_model=schemas.Dashboard)
def get_dashboard(session: SessionDep) -> schemas.Dashboard:
    return dashboard.get_dashboard(session, now=now(), today=today_london())


@router.get("/painters", response_model=list[PersonRef])
def list_painters(session: SessionDep) -> list[PersonRef]:
    return painters.list_painters(session)


@router.get("/reports", response_model=schemas.ReportPage)
def list_reports(
    session: SessionDep,
    paging: PageDep,
    filters: Annotated[reports.ReportFilters, Depends(report_filters)],
) -> schemas.ReportPage:
    return reports.list_reports(
        session, filters, page=paging.page, page_size=paging.page_size, today=today_london()
    )


@router.get("/reports/{report_id}", response_model=schemas.ReportDetail)
def get_report(
    report_id: uuid.UUID, session: SessionDep, photo_store: PhotoStoreDep
) -> schemas.ReportDetail:
    return reports.get_report_detail(
        session, report_id, today=today_london(), photo_store=photo_store
    )


@router.patch("/reports/{report_id}", response_model=schemas.ReportDetail)
def update_report(
    report_id: uuid.UUID,
    body: report_write.ReportUpdate,
    session: SessionDep,
    photo_store: PhotoStoreDep,
    user: CurrentUser,
) -> schemas.ReportDetail:
    report_edit.update_report(session, report_id, user, body, now())
    return reports.get_report_detail(
        session, report_id, today=today_london(), photo_store=photo_store
    )


@router.post("/reports/{report_id}/review", response_model=schemas.ReportDetail)
def review_report(
    report_id: uuid.UUID,
    body: report_write.ReviewRequest,
    session: SessionDep,
    photo_store: PhotoStoreDep,
    user: CurrentUser,
) -> schemas.ReportDetail:
    review.review_report(session, report_id, user, body.version, now())
    return reports.get_report_detail(
        session, report_id, today=today_london(), photo_store=photo_store
    )


@router.get("/reports/{report_id}/history", response_model=audit_schemas.AuditHistory)
def get_report_history(report_id: uuid.UUID, session: SessionDep) -> audit_schemas.AuditHistory:
    return audit.report_history(session, report_id)


@router.get("/invoices", response_model=schemas.InvoicePage)
def list_invoices(
    session: SessionDep, paging: PageDep, status: InvoiceStatus | None = None
) -> schemas.InvoicePage:
    return invoices.list_invoices(
        session, status, page=paging.page, page_size=paging.page_size, today=today_london()
    )
