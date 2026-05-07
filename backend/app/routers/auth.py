from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.db_auth import get_db
from app.models_auth import LocalAuthUser
from app.security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

SIGNUP_DB_UNAVAILABLE_DETAIL = (
    "Database unavailable for signup. Verify DB_USER/DB_PASSWORD/DB_NAME "
    "or DATABASE_URL and ensure Cloud SQL proxy is running."
)
LOGIN_DB_UNAVAILABLE_DETAIL = (
    "Database unavailable for login. Verify DB_USER/DB_PASSWORD/DB_NAME "
    "or DATABASE_URL and ensure Cloud SQL proxy is running."
)


class SignupRequest(BaseModel):
    username: str
    email: str
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 3 or len(normalized) > 32:
            raise ValueError("Username must be between 3 and 32 characters.")
        allowed = set(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
        )
        if any(ch not in allowed for ch in normalized):
            raise ValueError(
                "Username can only use letters, numbers, dot, underscore, and dash."
            )
        return normalized

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@", 1)[-1]:
            raise ValueError("Enter a valid email address.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if not any(ch.isalpha() for ch in value) or not any(
            ch.isdigit() for ch in value
        ):
            raise ValueError(
                "Password must include at least one letter and one number."
            )
        return value


class LoginRequest(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Username is required.")
        return normalized

    @field_validator("password")
    @classmethod
    def ensure_password(cls, value: str) -> str:
        if not value:
            raise ValueError("Password is required.")
        return value


class UserView(BaseModel):
    id: UUID
    username: str
    email: str
    created_at: datetime | None


class AuthResponse(BaseModel):
    message: str
    user: UserView


def _to_user_view(user: LocalAuthUser) -> UserView:
    return UserView(
        id=user.id,
        username=user.username,
        email=user.email,
        created_at=user.created_at,
    )


def _find_existing_user_for_signup(db: Session, payload: SignupRequest) -> LocalAuthUser | None:
    return db.execute(
        select(LocalAuthUser).where(
            or_(
                func.lower(LocalAuthUser.username) == payload.username.lower(),
                func.lower(LocalAuthUser.email) == payload.email.lower(),
            )
        )
    ).scalar_one_or_none()


def _find_user_for_login(db: Session, payload: LoginRequest) -> LocalAuthUser | None:
    return db.execute(
        select(LocalAuthUser).where(
            func.lower(LocalAuthUser.username) == payload.username.lower()
        )
    ).scalar_one_or_none()


def _raise_db_unavailable(detail: str) -> None:
    raise HTTPException(status_code=503, detail=detail)


@router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    try:
        existing_user = _find_existing_user_for_signup(db, payload)
        if existing_user is not None:
            raise HTTPException(
                status_code=409, detail="Username or email is already registered."
            )

        new_user = LocalAuthUser(
            username=payload.username,
            email=payload.email,
            password_hash=hash_password(payload.password),
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        return AuthResponse(
            message="Signup successful.",
            user=_to_user_view(new_user),
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        _raise_db_unavailable(SIGNUP_DB_UNAVAILABLE_DETAIL)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        user = _find_user_for_login(db, payload)
        if user is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid username or password.")

        return AuthResponse(
            message="Login successful.",
            user=_to_user_view(user),
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        _raise_db_unavailable(LOGIN_DB_UNAVAILABLE_DETAIL)
