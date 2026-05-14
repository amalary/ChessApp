from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping

from app.models_auth import LocalAuthUser

PRIVATE_FIELD_KEYWORDS = (
    "password",
    "passphrase",
    "secret",
    "token",
    "api_key",
    "apikey",
    "credential",
    "private_key",
    "access_key",
    "refresh_token",
    "session",
    "cookie",
    "hash",
    "salt",
    "database_url",
)

AUTH_PROFILE_ALLOWED_FIELDS = (
    "name",
    "nickname",
    "email",
    "email_verified",
    "picture",
    "updated_at",
    "locale",
    "zoneinfo",
)


def _is_private_field_name(field_name: str) -> bool:
    normalized = field_name.strip().lower().replace("-", "_")
    if not normalized:
        return True
    return any(keyword in normalized for keyword in PRIVATE_FIELD_KEYWORDS)


def sanitize_user_context(value: Any, *, max_depth: int = 4) -> Any:
    if max_depth <= 0:
        return None

    if value is None:
        return None

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for key, candidate in value.items():
            key_text = str(key)
            if key_text.startswith("_"):
                continue
            if _is_private_field_name(key_text):
                continue
            clean_value = sanitize_user_context(candidate, max_depth=max_depth - 1)
            if clean_value is None:
                continue
            sanitized[key_text] = clean_value
        return sanitized or None

    if isinstance(value, list):
        cleaned_items = [
            sanitize_user_context(item, max_depth=max_depth - 1) for item in value
        ]
        result = [item for item in cleaned_items if item is not None]
        return result or None

    if isinstance(value, tuple):
        cleaned_items = [
            sanitize_user_context(item, max_depth=max_depth - 1) for item in value
        ]
        result = [item for item in cleaned_items if item is not None]
        return result or None

    return None


def build_agent_user_profile_context(
    *,
    local_auth_user: LocalAuthUser | None = None,
    auth_profile: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    context: dict[str, Any] = {}

    if local_auth_user is not None:
        local_profile = sanitize_user_context(
            {
                "id": str(local_auth_user.id),
                "username": local_auth_user.username,
                "email": local_auth_user.email,
                "created_at": local_auth_user.created_at,
                # Intentional: sanitization strips this due "password"/"hash".
                "password_hash": local_auth_user.password_hash,
            }
        )
        if isinstance(local_profile, dict) and local_profile:
            context["local_profile"] = local_profile

    if isinstance(auth_profile, Mapping):
        auth_view: dict[str, Any] = {}
        for field in AUTH_PROFILE_ALLOWED_FIELDS:
            if field not in auth_profile:
                continue
            auth_view[field] = auth_profile[field]
        cleaned_auth = sanitize_user_context(auth_view)
        if isinstance(cleaned_auth, dict) and cleaned_auth:
            context["auth_profile"] = cleaned_auth

    return context or None
