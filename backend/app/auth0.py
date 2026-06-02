import os
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import HTTPException, Request, status
from jwt import InvalidTokenError, PyJWKClient

from app.local_auth_session import verify_local_auth_session_token


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    domain = _require_env("AUTH0_DOMAIN").strip().rstrip("/")
    if not domain.startswith("http://") and not domain.startswith("https://"):
        domain = f"https://{domain}"
    jwks_url = f"{domain}/.well-known/jwks.json"
    return PyJWKClient(jwks_url)


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _extract_local_auth_user(request: Request) -> dict | None:
    raw_user_id = request.headers.get("X-Local-Auth-User-Id", "").strip()
    session_token = request.headers.get("X-Local-Auth-Session", "").strip()
    if not raw_user_id and not session_token:
        return None
    if not raw_user_id or not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Local-Auth-User-Id and X-Local-Auth-Session are both required.",
        )
    try:
        user_id = UUID(raw_user_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid X-Local-Auth-User-Id header.",
        ) from exc
    if not verify_local_auth_session_token(session_token, user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid local auth session.",
        )
    return {
        "sub": f"local|{user_id}",
        "local_auth_user_id": str(user_id),
    }


def _decode_token(token: str) -> dict:
    audience = _require_env("AUTH0_AUDIENCE")
    issuer_domain = _require_env("AUTH0_DOMAIN").strip().rstrip("/")
    if not issuer_domain.startswith("http://") and not issuer_domain.startswith(
        "https://"
    ):
        issuer_domain = f"https://{issuer_domain}"
    issuer = f"{issuer_domain}/"

    signing_key = _jwks_client().get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
    )
    if not isinstance(payload, dict):
        raise InvalidTokenError("Invalid token payload")
    return payload


def get_current_user(request: Request) -> dict:
    try:
        local_user = _extract_local_auth_user(request)
        if local_user is not None:
            return local_user
        token = _extract_bearer_token(request)
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing bearer token.",
            )
        payload = _decode_token(token)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
    except InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token.",
        )

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token.",
        )
    return payload


def get_optional_current_user(request: Request) -> dict | None:
    try:
        local_user = _extract_local_auth_user(request)
    except HTTPException:
        return None
    if local_user is not None:
        return local_user
    token = _extract_bearer_token(request)
    if not token:
        return None
    try:
        payload = _decode_token(token)
    except Exception:
        return None
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        return None
    return payload
