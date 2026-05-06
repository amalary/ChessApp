import os
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request, status
from jwt import InvalidTokenError, PyJWKClient


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


def _decode_token(token: str) -> dict:
    audience = _require_env("AUTH0_AUDIENCE")
    issuer_domain = _require_env("AUTH0_DOMAIN").strip().rstrip("/")
    if not issuer_domain.startswith("http://") and not issuer_domain.startswith("https://"):
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
