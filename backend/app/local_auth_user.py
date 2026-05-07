from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db_auth import get_db
from app.models_auth import LocalAuthUser


def _parse_local_auth_user_id(raw_user_id: str | None) -> UUID | None:
    if raw_user_id is None:
        return None

    candidate = raw_user_id.strip()
    if not candidate:
        return None

    try:
        return UUID(candidate)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid X-Local-Auth-User-Id header.",
        ) from exc


def get_optional_local_auth_user(
    db: Session = Depends(get_db),
    x_local_auth_user_id: str | None = Header(
        default=None, alias="X-Local-Auth-User-Id"
    ),
) -> LocalAuthUser | None:
    user_id = _parse_local_auth_user_id(x_local_auth_user_id)
    if user_id is None:
        return None

    user = db.get(LocalAuthUser, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown local auth user.",
        )
    return user


def get_required_local_auth_user(
    user: LocalAuthUser | None = Depends(get_optional_local_auth_user),
) -> LocalAuthUser:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Local-Auth-User-Id header is required.",
        )
    return user
