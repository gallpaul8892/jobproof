"""RFC 9457 problem details: exceptions, response builder and handlers."""

import logging
from http import HTTPStatus
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging import request_id_var

logger = logging.getLogger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"
PROBLEM_TYPE_BASE = "https://jobproof.dev/problems/"

_CODE_FOR_STATUS = {401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "not_found"}


class ProblemError(Exception):
    """Raised by application code to return a problem response."""

    def __init__(
        self,
        status: int,
        code: str,
        detail: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail or code)
        self.status = status
        self.code = code
        self.detail = detail
        self.headers = headers


def problem_response(
    status: int,
    code: str,
    *,
    instance: str,
    detail: str | None = None,
    errors: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"{PROBLEM_TYPE_BASE}{code}",
        "title": HTTPStatus(status).phrase,
        "status": status,
        "code": code,
        "request_id": request_id_var.get() or "",
        "instance": instance,
    }
    if detail:
        body["detail"] = detail
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=PROBLEM_MEDIA_TYPE, headers=headers)


async def _problem_error_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(ProblemError, exc)
    return problem_response(
        exc.status, exc.code, instance=request.url.path, detail=exc.detail, headers=exc.headers
    )


async def _http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(StarletteHTTPException, exc)
    code = _CODE_FOR_STATUS.get(exc.status_code)
    if code is None:
        code = "internal_error" if exc.status_code >= 500 else "validation_error"
    # Only expose the detail of auth errors; framework 404/405 text adds nothing.
    detail = exc.detail if exc.status_code in (401, 403) else None
    return problem_response(
        exc.status_code,
        code,
        instance=request.url.path,
        detail=detail,
        headers=dict(exc.headers) if exc.headers else None,
    )


async def _validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(RequestValidationError, exc)
    errors = [
        {"loc": [p if isinstance(p, int) else str(p) for p in err["loc"]], "message": err["msg"]}
        for err in exc.errors()
    ]
    return problem_response(
        422,
        "validation_error",
        instance=request.url.path,
        detail="Request validation failed.",
        errors=errors,
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ProblemError, _problem_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
