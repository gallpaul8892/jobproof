"""Unversioned health endpoint for the load balancer and compose healthchecks."""

import logging

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy import Engine, text

from app import __version__

logger = logging.getLogger(__name__)
router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    database: str
    version: str


def database_is_up(engine: Engine) -> bool:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        # Class name only: keeps the log short and free of connection details.
        logger.warning("database health check failed: %s", type(exc).__name__)
        return False
    return True


@router.get("/health", response_model=HealthResponse)
def get_health(request: Request, response: Response) -> HealthResponse:
    if database_is_up(request.app.state.engine):
        return HealthResponse(status="ok", database="ok", version=__version__)
    response.status_code = 503
    return HealthResponse(status="degraded", database="unavailable", version=__version__)
