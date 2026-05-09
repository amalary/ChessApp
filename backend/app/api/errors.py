from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


def error_payload(
    *,
    code: str,
    message: str,
    details: Any | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if details is not None:
        payload["error"]["details"] = details
    return payload


def error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: Any | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=error_payload(code=code, message=message, details=details),
        headers=headers or {},
    )


def install_api_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            code = str(detail.get("code") or "http_error")
            message = str(detail.get("message") or "Request failed.")
            details = detail.get("details")
        else:
            code = "http_error"
            message = str(detail or "Request failed.")
            details = None
        return error_response(
            status_code=exc.status_code,
            code=code,
            message=message,
            details=details,
            headers=dict(exc.headers or {}),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            status_code=422,
            code="request_validation_failed",
            message="Request validation failed.",
            details=exc.errors(),
        )

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled server exception: %s", exc)
        return error_response(
            status_code=500,
            code="internal_server_error",
            message="Internal server error.",
        )
