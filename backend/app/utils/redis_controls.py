from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from redis.asyncio import Redis


@dataclass(slots=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int
    current_count: int
    limit: int
    window_seconds: int


def utc_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


async def fixed_window_limit(
    redis_client: Redis,
    key: str,
    limit: int,
    window_seconds: int,
) -> RateLimitDecision:
    pipe = redis_client.pipeline(transaction=True)
    pipe.incr(key)
    pipe.ttl(key)
    count, ttl = await pipe.execute()

    if count == 1 or ttl < 0:
        await redis_client.expire(key, window_seconds)
        ttl = window_seconds

    retry_after = max(1, int(ttl)) if ttl and ttl > 0 else window_seconds
    return RateLimitDecision(
        allowed=count <= limit,
        retry_after_seconds=retry_after,
        current_count=int(count),
        limit=limit,
        window_seconds=window_seconds,
    )


async def sliding_window_limit(
    redis_client: Redis,
    key: str,
    limit: int,
    window_seconds: int,
) -> RateLimitDecision:
    now = datetime.utcnow()
    now_ms = int(now.timestamp() * 1000)
    window_start_ms = int((now - timedelta(seconds=window_seconds)).timestamp() * 1000)
    member = f"{now_ms}:{uuid4().hex}"

    pipe = redis_client.pipeline(transaction=True)
    pipe.zremrangebyscore(key, 0, window_start_ms)
    pipe.zadd(key, {member: now_ms})
    pipe.zcard(key)
    pipe.expire(key, window_seconds + 60)
    _, _, count, _ = await pipe.execute()

    if count <= limit:
        return RateLimitDecision(
            allowed=True,
            retry_after_seconds=0,
            current_count=int(count),
            limit=limit,
            window_seconds=window_seconds,
        )

    oldest = await redis_client.zrange(key, 0, 0, withscores=True)
    retry_after = 1
    if oldest:
        oldest_score_ms = int(oldest[0][1])
        unblock_ms = oldest_score_ms + (window_seconds * 1000)
        retry_after = max(1, math.ceil((unblock_ms - now_ms) / 1000))

    return RateLimitDecision(
        allowed=False,
        retry_after_seconds=retry_after,
        current_count=int(count),
        limit=limit,
        window_seconds=window_seconds,
    )


async def acquire_lock(
    redis_client: Redis,
    key: str,
    value: str,
    ttl_seconds: int,
) -> bool:
    acquired = await redis_client.set(
        name=key,
        value=value,
        nx=True,
        ex=ttl_seconds,
    )
    return bool(acquired)


async def release_lock_if_owner(
    redis_client: Redis,
    key: str,
    value: str,
) -> None:
    current = await redis_client.get(key)
    if current == value:
        await redis_client.delete(key)


async def cache_get_json(redis_client: Redis, key: str) -> dict | list | None:
    payload = await redis_client.get(key)
    if not payload:
        return None
    return json.loads(payload)


async def cache_set_json(
    redis_client: Redis,
    key: str,
    payload: dict | list,
    ttl_seconds: int,
) -> None:
    await redis_client.set(
        name=key,
        value=json.dumps(payload, separators=(",", ":")),
        ex=ttl_seconds,
    )
