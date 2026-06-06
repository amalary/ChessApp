from __future__ import annotations

import logging

from fastapi import Request

from app.services.protection_service import (
    enforce_global_limits,
    populate_request_identity,
)

logger = logging.getLogger(__name__)


async def rate_limit_middleware(request: Request, call_next):
    await populate_request_identity(request)

    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        logger.warning(
            "Redis client missing; skipping global rate limits endpoint=%s",
            request.url.path,
        )
        return await call_next(request)

    limited_response = await enforce_global_limits(
        request=request, redis_client=redis_client
    )
    if limited_response is not None:
        return limited_response

    return await call_next(request)
