from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db_auth import get_db
from app.local_auth_session import verify_local_auth_session_token
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
    x_local_auth_session: str | None = Header(
        default=None, alias="X-Local-Auth-Session"
    ),
) -> LocalAuthUser | None:
    has_user_id = isinstance(x_local_auth_user_id, str) and bool(
        x_local_auth_user_id.strip()
    )
    has_session = isinstance(x_local_auth_session, str) and bool(
        x_local_auth_session.strip()
    )

    if not has_user_id and not has_session:
        return None

    if has_user_id != has_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Local-Auth-User-Id and X-Local-Auth-Session are both required.",
        )

    user_id = _parse_local_auth_user_id(x_local_auth_user_id)
    if user_id is None:
        return None
    session_token = (x_local_auth_session or "").strip()
    if not verify_local_auth_session_token(session_token, user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid local auth session.",
        )

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
