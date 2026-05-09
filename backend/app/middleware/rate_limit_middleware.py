from __future__ import annotations

import logging

from fastapi import Request

from app.api.errors import error_response
from app.services.protection_service import (
    enforce_global_limits,
    populate_request_identity,
)

logger = logging.getLogger(__name__)


async def rate_limit_middleware(request: Request, call_next):
    await populate_request_identity(request)

    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        logger.error(
            "Redis client missing in rate_limit_middleware endpoint=%s",
            request.url.path,
        )
        return error_response(
            status_code=503,
            code="service_unavailable",
            message="Service temporarily unavailable.",
        )

    limited_response = await enforce_global_limits(
        request=request, redis_client=redis_client
    )
    if limited_response is not None:
        return limited_response

    return await call_next(request)
