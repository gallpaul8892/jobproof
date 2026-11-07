"""Public branding: the company name and theme, readable before sign-in."""

from fastapi import APIRouter, Response

from app.deps import SessionDep
from app.schemas.settings import Branding
from app.services import settings as settings_service

router = APIRouter(prefix="/api/v1")


@router.get("/branding", response_model=Branding)
def get_branding(response: Response, session: SessionDep) -> Branding:
    response.headers["Cache-Control"] = "no-cache"
    return settings_service.get_branding(session)
