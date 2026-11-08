"""Admin-only endpoints. The router-level dependency guards every route added here."""

from fastapi import APIRouter, Depends

from app.clock import now
from app.deps import CurrentUser, SessionDep, require_roles
from app.models.enums import UserRole
from app.schemas import audit as audit_schemas
from app.schemas import settings as schemas
from app.services import audit
from app.services import settings as settings_service

router = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(require_roles(UserRole.admin))])


@router.get("/settings", response_model=schemas.AdminSettings)
def get_settings(session: SessionDep) -> schemas.AdminSettings:
    return settings_service.get_admin_settings(session)


@router.patch("/settings", response_model=schemas.AdminSettings)
def update_settings(
    body: schemas.AdminSettingsUpdate, session: SessionDep, user: CurrentUser
) -> schemas.AdminSettings:
    result, _changes = settings_service.update_settings(session, user, body, now())
    return result


@router.get("/settings/history", response_model=audit_schemas.AuditHistory)
def get_settings_history(session: SessionDep) -> audit_schemas.AuditHistory:
    return audit.settings_history(session)
