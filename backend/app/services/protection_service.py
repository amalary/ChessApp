from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncGenerator, Awaitable, Callable
from uuid import uuid4

from fastapi import File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from app.auth0 import get_optional_current_user
from app.utils.redis_controls import (
    acquire_lock,
    cache_get_json,
    cache_set_json,
    fixed_window_limit,
    release_lock_if_owner,
    sliding_window_limit,
    utc_timestamp,
)

logger = logging.getLogger(__name__)

RATE_LIMIT_ERROR = "rate_limit_exceeded"
RATE_LIMIT_MESSAGE = "Try again later."
FAILED_SOLVE_MESSAGE = "Too many failed attempts. Try again later."
ENGINE_BUSY_MESSAGE = "Engine busy. Try again shortly."

GLOBAL_USER_LIMIT = 60
GLOBAL_IP_LIMIT = 100
GLOBAL_WINDOW_SECONDS = 60
SENSITIVE_LIMIT = 10
SENSITIVE_WINDOW_SECONDS = 60
ANALYTICS_LIMIT = 60
ANALYTICS_WINDOW_SECONDS = 60

FAILED_SOLVE_LIMIT = 5
FAILED_SOLVE_WINDOW_SECONDS = 10 * 60
FAILED_SOLVE_BLOCK_SECONDS = 15 * 60

ENGINE_LOCK_TTL_SECONDS = 8
MAX_SOLVE_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_SOLVE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

HEALTH_PATHS = ("/health",)
SENSITIVE_PATH_PREFIXES = (
    "/auth",
    "/settings",
    "/profile",
)
ANALYTICS_PATH_PREFIXES = ("/analytics", "/dashboard")


class RateLimitViolation(Exception):
    def __init__(self, message: str = RATE_LIMIT_MESSAGE, retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


@dataclass(slots=True)
class RequestActor:
    user_id: str | None
    ip: str

    @property
    def actor_id(self) -> str:
        return self.user_id or self.ip


@dataclass(slots=True)
class ValidatedSolveUpload:
    filename: str | None
    content_type: str
    data: bytes


def client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


async def populate_request_identity(request: Request) -> None:
    ip = client_ip(request)
    request.state.client_ip = ip
    request.state.user = None
    request.state.user_id = None
    request.state.is_authenticated = False

    user = get_optional_current_user(request)
    if not user:
        return

    user_id = user.get("sub")
    if isinstance(user_id, str) and user_id.strip():
        request.state.user = user
        request.state.user_id = user_id
        request.state.is_authenticated = True


def rate_limited_response(message: str = RATE_LIMIT_MESSAGE, retry_after: int | None = None) -> JSONResponse:
    headers = {}
    if retry_after is not None and retry_after > 0:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        status_code=429,
        content={"error": RATE_LIMIT_ERROR, "message": message},
        headers=headers,
    )


def request_actor(request: Request) -> RequestActor:
    user_id = getattr(request.state, "user_id", None)
    ip = getattr(request.state, "client_ip", None)
    if not ip:
        ip = "127.0.0.1"
    return RequestActor(user_id=user_id, ip=ip)


def _is_health_check(path: str) -> bool:
    return any(path == health_path or path.startswith(f"{health_path}/") for health_path in HEALTH_PATHS)


def _is_sensitive_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in SENSITIVE_PATH_PREFIXES)


def _is_analytics_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in ANALYTICS_PATH_PREFIXES)


def _log_block(
    *,
    reason: str,
    request: Request,
    actor: RequestActor,
    extra: str = "",
) -> None:
    logger.warning(
        "blocked_action reason=%s user_id=%s ip=%s endpoint=%s ts=%s %s",
        reason,
        actor.user_id or "-",
        actor.ip,
        request.url.path,
        utc_timestamp(),
        extra,
    )


async def enforce_global_limits(request: Request, redis_client: Redis) -> JSONResponse | None:
    path = request.url.path
    if _is_health_check(path):
        return None

    actor = request_actor(request)

    ip_key = f"rate_limit:ip:{actor.ip}:global"
    ip_decision = await fixed_window_limit(
        redis_client=redis_client,
        key=ip_key,
        limit=GLOBAL_IP_LIMIT,
        window_seconds=GLOBAL_WINDOW_SECONDS,
    )
    if not ip_decision.allowed:
        _log_block(
            reason="global_ip_rate_limit",
            request=request,
            actor=actor,
            extra=f"count={ip_decision.current_count} limit={ip_decision.limit}",
        )
        return rate_limited_response(retry_after=ip_decision.retry_after_seconds)

    if actor.user_id:
        user_key = f"rate_limit:user:{actor.user_id}:global"
        user_decision = await fixed_window_limit(
            redis_client=redis_client,
            key=user_key,
            limit=GLOBAL_USER_LIMIT,
            window_seconds=GLOBAL_WINDOW_SECONDS,
        )
        if not user_decision.allowed:
            _log_block(
                reason="global_user_rate_limit",
                request=request,
                actor=actor,
                extra=f"count={user_decision.current_count} limit={user_decision.limit}",
            )
            return rate_limited_response(retry_after=user_decision.retry_after_seconds)

    if _is_sensitive_path(path):
        sensitive_id = actor.user_id or actor.ip
        sensitive_kind = "user" if actor.user_id else "ip"
        sensitive_key = f"rate_limit:{sensitive_kind}:{sensitive_id}:sensitive"
        sensitive_decision = await fixed_window_limit(
            redis_client=redis_client,
            key=sensitive_key,
            limit=SENSITIVE_LIMIT,
            window_seconds=SENSITIVE_WINDOW_SECONDS,
        )
        if not sensitive_decision.allowed:
            _log_block(
                reason="sensitive_rate_limit",
                request=request,
                actor=actor,
                extra=f"count={sensitive_decision.current_count} limit={sensitive_decision.limit}",
            )
            return rate_limited_response(retry_after=sensitive_decision.retry_after_seconds)

    if _is_analytics_path(path) and actor.user_id:
        analytics_key = f"rate_limit:user:{actor.user_id}:analytics"
        analytics_decision = await fixed_window_limit(
            redis_client=redis_client,
            key=analytics_key,
            limit=ANALYTICS_LIMIT,
            window_seconds=ANALYTICS_WINDOW_SECONDS,
        )
        if not analytics_decision.allowed:
            _log_block(
                reason="analytics_rate_limit",
                request=request,
                actor=actor,
                extra=f"count={analytics_decision.current_count} limit={analytics_decision.limit}",
            )
            return rate_limited_response(retry_after=analytics_decision.retry_after_seconds)

    return None


def _failure_counter_key(actor: RequestActor) -> str:
    if actor.user_id:
        return f"failures:user:{actor.user_id}"
    return f"failures:ip:{actor.ip}"


def _failure_block_key(actor: RequestActor) -> str:
    if actor.user_id:
        return f"failure_block:user:{actor.user_id}"
    return f"failure_block:ip:{actor.ip}"


async def ensure_not_failure_blocked(request: Request) -> None:
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable.")

    actor = request_actor(request)
    blocked = await redis_client.ttl(_failure_block_key(actor))
    if blocked and blocked > 0:
        _log_block(
            reason="failed_solve_block",
            request=request,
            actor=actor,
            extra=f"retry_after={blocked}",
        )
        raise RateLimitViolation(message=FAILED_SOLVE_MESSAGE, retry_after=int(blocked))


async def record_failed_solve_attempt(request: Request) -> None:
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        return

    actor = request_actor(request)
    counter_key = _failure_counter_key(actor)
    block_key = _failure_block_key(actor)

    decision = await sliding_window_limit(
        redis_client=redis_client,
        key=counter_key,
        limit=FAILED_SOLVE_LIMIT,
        window_seconds=FAILED_SOLVE_WINDOW_SECONDS,
    )
    if decision.current_count >= FAILED_SOLVE_LIMIT:
        await redis_client.set(name=block_key, value="1", ex=FAILED_SOLVE_BLOCK_SECONDS)
        _log_block(
            reason="failed_solve_threshold_reached",
            request=request,
            actor=actor,
            extra=f"count={decision.current_count}",
        )


async def clear_failed_solve_attempts(request: Request) -> None:
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        return
    actor = request_actor(request)
    await redis_client.delete(_failure_counter_key(actor))


class EngineLock:
    def __init__(self, redis_client: Redis, actor: RequestActor):
        self._redis = redis_client
        self._actor = actor
        if actor.user_id:
            self._key = f"engine_lock:user:{actor.user_id}"
        else:
            self._key = f"engine_lock:ip:{actor.ip}"
        self._value = uuid4().hex
        self._held = False

    async def acquire(self, request: Request) -> None:
        acquired = await acquire_lock(
            redis_client=self._redis,
            key=self._key,
            value=self._value,
            ttl_seconds=ENGINE_LOCK_TTL_SECONDS,
        )
        if not acquired:
            _log_block(reason="engine_lock_busy", request=request, actor=self._actor)
            raise RateLimitViolation(message=ENGINE_BUSY_MESSAGE)
        self._held = True

    async def release(self) -> None:
        if not self._held:
            return
        await release_lock_if_owner(
            redis_client=self._redis,
            key=self._key,
            value=self._value,
        )
        self._held = False


async def enforce_engine_lock(request: Request) -> AsyncGenerator[None, None]:
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable.")
    actor = request_actor(request)
    lock = EngineLock(redis_client=redis_client, actor=actor)
    await lock.acquire(request)
    try:
        yield
    finally:
        await asyncio.shield(lock.release())


async def get_cached_analytics_response(request: Request) -> dict | list | None:
    actor = request_actor(request)
    if not actor.user_id:
        return None
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        return None
    return await cache_get_json(redis_client, f"analytics:{actor.user_id}")


async def set_cached_analytics_response(
    request: Request,
    payload: dict | list,
    ttl_seconds: int = 45,
) -> None:
    actor = request_actor(request)
    if not actor.user_id:
        return
    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None:
        return
    await cache_set_json(
        redis_client=redis_client,
        key=f"analytics:{actor.user_id}",
        payload=payload,
        ttl_seconds=max(30, min(60, ttl_seconds)),
    )


async def get_or_set_analytics_cache(
    request: Request,
    loader: Callable[[], Awaitable[dict | list]],
    ttl_seconds: int = 45,
) -> dict | list:
    cached = await get_cached_analytics_response(request)
    if cached is not None:
        return cached

    payload = await loader()
    await set_cached_analytics_response(request=request, payload=payload, ttl_seconds=ttl_seconds)
    return payload


async def validate_solve_upload(
    request: Request,
    image: UploadFile = File(...),
) -> ValidatedSolveUpload:
    await ensure_not_failure_blocked(request)

    content_type = (image.content_type or "").strip().lower()
    if content_type not in ALLOWED_SOLVE_MIME_TYPES:
        await record_failed_solve_attempt(request)
        raise HTTPException(status_code=400, detail="Invalid file type or size.")

    image_bytes = await image.read(MAX_SOLVE_IMAGE_BYTES + 1)
    if not image_bytes or len(image_bytes) > MAX_SOLVE_IMAGE_BYTES:
        await record_failed_solve_attempt(request)
        raise HTTPException(status_code=400, detail="Invalid file type or size.")

    return ValidatedSolveUpload(
        filename=image.filename,
        content_type=content_type,
        data=image_bytes,
    )
