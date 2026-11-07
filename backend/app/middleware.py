"""Request id, access log and last-resort 500 handling as one pure ASGI middleware."""

import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import problem_response
from app.logging import request_id_var

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,64}$")
access_logger = logging.getLogger("jobproof.access")
error_logger = logging.getLogger("jobproof.error")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("x-request-id")
        request_id = (
            incoming if incoming and REQUEST_ID_PATTERN.match(incoming) else str(uuid.uuid4())
        )
        token = request_id_var.set(request_id)
        started_at = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            # Details go to the log only; the client gets a generic problem.
            error_logger.exception("unhandled error")
            if not response_started:
                response = problem_response(500, "internal_error", instance=scope["path"])
                await response(scope, receive, send_with_request_id)
        finally:
            extra: dict[str, object] = {
                "method": scope["method"],
                "path": scope["path"],
                "status": status_code,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 1),
            }
            user_id = scope.get("jobproof_user_id")  # set by the current_user dependency
            if user_id:
                extra["user_id"] = user_id
            access_logger.info("request", extra=extra)
            request_id_var.reset(token)
