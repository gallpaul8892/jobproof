"""Public app status for the mobile app: server time and the minimum supported version."""

from datetime import UTC

from fastapi import APIRouter, Response
from pydantic import BaseModel

from app.clock import now
from app.deps import SettingsDep
from app.versioning import API_VERSION

router = APIRouter(prefix="/api/v1/app")


class MinSupportedVersions(BaseModel):
    android: str


class AppStatus(BaseModel):
    server_time: str
    api_version: str
    min_supported_versions: MinSupportedVersions


@router.get("/status", response_model=AppStatus)
def get_app_status(response: Response, settings: SettingsDep) -> AppStatus:
    """No database access: cheap enough to call at the start of every sync run."""
    response.headers["Cache-Control"] = "no-store"
    server_time = now().astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return AppStatus(
        server_time=server_time,
        api_version=API_VERSION,
        min_supported_versions=MinSupportedVersions(android=settings.mobile_min_version_android),
    )
