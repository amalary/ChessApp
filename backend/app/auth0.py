# backend/app/auth0.py
import os
from functools import lru_cache
from typing import Dict, Any

import httpx
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN")
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE")
ALGORITHMS = ["RS256"]

if not AUTH0_DOMAIN or not AUTH0_AUDIENCE:
    raise RuntimeError("AUTH0_DOMAIN and AUTH0_AUDIENCE must be set")

# Scheme: extract Bearer <token> from Authorization header
token_auth_scheme = HTTPBearer()

# JWKS client to fetch and cache signing keys
jwks_url = f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"
jwks_client = PyJWKClient(jwks_url)


def _decode_token(token: str) -> Dict[str, Any]:
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token).key

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=ALGORITHMS,
            audience=AUTH0_AUDIENCE,
            issuer=f"https://{AUTH0_DOMAIN}/",
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
        )


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> Dict[str, Any]:
    """
    FastAPI dependency that:
    - extracts the Bearer token from Authorization header
    - validates it against Auth0 (signature, audience, issuer)
    - returns the decoded payload (sub, email, etc.)
    """
    token = creds.credentials
    payload = _decode_token(token)

    # Map payload to a simple user dict for now
    return {
        "sub": payload.get("sub"),
        "email": payload.get("email"),
        "permissions": payload.get("permissions", []),
        "raw": payload,
    }
