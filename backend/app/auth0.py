import os
from fastapi import Depends, HTTPException, status

# Only validate env vars when auth is actually used
def _require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"{name} must be set")
    return v

def get_current_user():
    try:
        domain = _require_env("AUTH0_DOMAIN")
        audience = _require_env("AUTH0_AUDIENCE")
    except RuntimeError as e:
        # Don't crash the whole app; fail only protected endpoints
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    # ...rest of your verification logic...
    return {"sub": "placeholder"}  # replace with real user after verification
