from __future__ import annotations

import os
import warnings
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from jwt import InvalidTokenError

LOCAL_AUTH_SESSION_TYPE = "local_auth_session_v1"
LOCAL_AUTH_SESSION_TTL_SECONDS = 12 * 60 * 60
LOCAL_AUTH_MIN_SECRET_LENGTH = 32
_HAS_EMITTED_SECRET_WARNING = False


def _get_local_auth_session_secret() -> str:
    global _HAS_EMITTED_SECRET_WARNING
    for key in ("LOCAL_AUTH_SESSION_SECRET", "AUTH0_SECRET", "AUTH0_CLIENT_SECRET"):
        value = os.getenv(key, "").strip()
        if value:
            if key != "LOCAL_AUTH_SESSION_SECRET" and not _HAS_EMITTED_SECRET_WARNING:
                warnings.warn(
                    "LOCAL_AUTH_SESSION_SECRET is not set; falling back to "
                    f"{key}. Set LOCAL_AUTH_SESSION_SECRET explicitly in production.",
                    RuntimeWarning,
                    stacklevel=2,
                )
                _HAS_EMITTED_SECRET_WARNING = True
            if (
                len(value) < LOCAL_AUTH_MIN_SECRET_LENGTH
                and not _HAS_EMITTED_SECRET_WARNING
            ):
                warnings.warn(
                    "Local auth session secret is shorter than 32 characters. "
                    "Use a 32+ character LOCAL_AUTH_SESSION_SECRET in production.",
                    RuntimeWarning,
                    stacklevel=2,
                )
                _HAS_EMITTED_SECRET_WARNING = True
            return value
    raise RuntimeError(
        "Set LOCAL_AUTH_SESSION_SECRET (or AUTH0_SECRET/AUTH0_CLIENT_SECRET) for local auth sessions."
    )


def _get_local_auth_session_ttl_seconds() -> int:
    raw = os.getenv("LOCAL_AUTH_SESSION_TTL_SECONDS", "").strip()
    if not raw:
        return LOCAL_AUTH_SESSION_TTL_SECONDS
    try:
        parsed = int(raw)
        return parsed if parsed > 0 else LOCAL_AUTH_SESSION_TTL_SECONDS
    except ValueError:
        return LOCAL_AUTH_SESSION_TTL_SECONDS


def issue_local_auth_session_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "typ": LOCAL_AUTH_SESSION_TYPE,
        "iat": now,
        "exp": now + timedelta(seconds=_get_local_auth_session_ttl_seconds()),
    }
    secret = _get_local_auth_session_secret()
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_local_auth_session_token(token: str, expected_user_id: UUID) -> bool:
    secret = _get_local_auth_session_secret()
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"require": ["sub", "typ", "exp"]},
        )
    except InvalidTokenError:
        return False

    if not isinstance(payload, dict):
        return False
    if payload.get("typ") != LOCAL_AUTH_SESSION_TYPE:
        return False

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        return False

    try:
        return UUID(subject.strip()) == expected_user_id
    except ValueError:
        return False
