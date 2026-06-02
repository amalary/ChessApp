from datetime import datetime
import json
import os
import re
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
import jwt
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.db_auth import get_db
from app.local_auth_session import issue_local_auth_session_token
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
AUTH0_UPSTREAM_UNAVAILABLE_DETAIL = (
    "Auth0 authentication service is unavailable. Please try again shortly."
)
AUTH0_REQUEST_TIMEOUT_SECONDS = 10
USERNAME_ALLOWED_CHARS_PATTERN = re.compile(r"[^a-zA-Z0-9._-]")
AUTH0_PASSWORD_REALM_GRANT = "http://auth0.com/oauth/grant-type/password-realm"
EMAIL_LIKE_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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
    identifier: str | None = None
    username: str | None = None
    password: str

    @model_validator(mode="after")
    def normalize_identifier(self) -> "LoginRequest":
        candidate = (self.identifier or self.username or "").strip()
        if not candidate:
            raise ValueError("Username or email is required.")
        self.identifier = candidate
        return self

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
    local_session_token: str


def _normalize_auth0_domain(domain: str) -> str:
    normalized = domain.strip().rstrip("/")
    if not normalized:
        return normalized
    if not normalized.startswith(("http://", "https://")):
        normalized = f"https://{normalized}"
    return normalized


def _auth0_config() -> dict[str, str] | None:
    domain = _normalize_auth0_domain(
        os.environ.get("AUTH0_DOMAIN", "") or os.environ.get("AUTH0_ISSUER_BASE_URL", "")
    )
    client_id = os.environ.get("AUTH0_CLIENT_ID", "").strip()
    client_secret = os.environ.get("AUTH0_CLIENT_SECRET", "").strip()
    if not domain or not client_id or not client_secret:
        return None

    connection = os.environ.get(
        "AUTH0_DB_CONNECTION", "Username-Password-Authentication"
    ).strip()
    if not connection:
        connection = "Username-Password-Authentication"

    return {
        "domain": domain,
        "client_id": client_id,
        "client_secret": client_secret,
        "connection": connection,
    }


def _mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}...{text[-4:]}"


def _is_grant_allowed_by_env(grant_name: str) -> bool | None:
    configured = os.environ.get("AUTH0_GRANT_TYPES", "").strip()
    if not configured:
        return None
    grants = {item.strip() for item in configured.split(",") if item.strip()}
    return grant_name in grants


@router.get("/debug-config")
def auth_debug_config():
    config = _auth0_config()
    if config is None:
        return {
            "ok": False,
            "auth0_configured": False,
            "missing_env": [
                key
                for key in (
                    "AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL",
                    "AUTH0_CLIENT_ID",
                    "AUTH0_CLIENT_SECRET",
                )
            ],
        }

    audience = os.environ.get("AUTH0_AUDIENCE", "").strip() or None
    grant_env = os.environ.get("AUTH0_GRANT_TYPES", "").strip() or None
    return {
        "ok": True,
        "auth0_configured": True,
        "domain": config["domain"],
        "client_id_masked": _mask_secret(config["client_id"]),
        "client_secret_masked": _mask_secret(config["client_secret"]),
        "connection": config["connection"],
        "audience": audience,
        "expected_grants": {
            AUTH0_PASSWORD_REALM_GRANT: _is_grant_allowed_by_env(
                AUTH0_PASSWORD_REALM_GRANT
            ),
            "password": _is_grant_allowed_by_env("password"),
        },
        "auth0_grant_types_env": grant_env,
    }


def _json_from_bytes(raw: bytes) -> dict:
    try:
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _auth0_decode_id_token(id_token: str | None) -> dict:
    if not id_token:
        return {}
    try:
        payload = jwt.decode(
            id_token,
            options={
                "verify_signature": False,
                "verify_aud": False,
                "verify_iss": False,
                "verify_exp": False,
            },
        )
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _auth0_token_exchange(form_payload: dict[str, str], domain: str) -> dict:
    body = urllib_parse.urlencode(form_payload).encode("utf-8")
    auth_request = urllib_request.Request(
        url=f"{domain}/oauth/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib_request.urlopen(
        auth_request, timeout=AUTH0_REQUEST_TIMEOUT_SECONDS
    ) as response:
        return _json_from_bytes(response.read())


def _auth0_verify_login(identifier: str, password: str) -> dict:
    config = _auth0_config()
    if config is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Auth0 is not configured for credential verification. "
                "Set AUTH0_DOMAIN (or AUTH0_ISSUER_BASE_URL), AUTH0_CLIENT_ID, "
                "and AUTH0_CLIENT_SECRET."
            ),
        )

    base_payload = {
        "username": identifier,
        "password": password,
        "scope": "openid profile email",
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
    }

    audience = os.environ.get("AUTH0_AUDIENCE", "").strip()
    if audience:
        base_payload["audience"] = audience

    realm_payload = dict(base_payload)
    realm_payload["grant_type"] = AUTH0_PASSWORD_REALM_GRANT
    realm_payload["realm"] = config["connection"]

    try:
        payload = _auth0_token_exchange(realm_payload, config["domain"])
    except urllib_error.HTTPError as exc:
        error_payload = _json_from_bytes(exc.read())
        error_code = str(error_payload.get("error", "")).strip().lower()
        error_description = str(
            error_payload.get("error_description", "") or error_payload.get("message", "")
        ).strip()
        description_lower = error_description.lower()

        # Some Auth0 apps allow only `password`, not `password-realm`.
        if (
            error_code == "unauthorized_client"
            and "grant type" in description_lower
            and "password-realm" in description_lower
        ):
            try:
                password_payload = dict(base_payload)
                password_payload["grant_type"] = "password"
                payload = _auth0_token_exchange(password_payload, config["domain"])
            except urllib_error.HTTPError as fallback_exc:
                fallback_error_payload = _json_from_bytes(fallback_exc.read())
                fallback_error_code = str(
                    fallback_error_payload.get("error", "")
                ).strip().lower()
                fallback_error_description = str(
                    fallback_error_payload.get("error_description", "")
                    or fallback_error_payload.get("message", "")
                ).strip()
                if fallback_exc.code in {400, 401} and fallback_error_code in {
                    "invalid_grant",
                    "access_denied",
                }:
                    raise HTTPException(
                        status_code=401, detail="Invalid username or password."
                    ) from fallback_exc
                if (
                    fallback_error_code == "unauthorized_client"
                    and "grant type" in fallback_error_description.lower()
                ):
                    raise HTTPException(
                        status_code=500,
                        detail=(
                            "Auth0 grant types are not enabled for this client. "
                            "Enable at least one of: "
                            f"`{AUTH0_PASSWORD_REALM_GRANT}` or `password`."
                        ),
                    ) from fallback_exc
                raise HTTPException(
                    status_code=502,
                    detail=fallback_error_description or AUTH0_UPSTREAM_UNAVAILABLE_DETAIL,
                ) from fallback_exc
            except urllib_error.URLError as fallback_exc:
                raise HTTPException(
                    status_code=502,
                    detail=AUTH0_UPSTREAM_UNAVAILABLE_DETAIL,
                ) from fallback_exc

        if exc.code in {400, 401} and error_code in {"invalid_grant", "access_denied"}:
            raise HTTPException(
                status_code=401, detail="Invalid username or password."
            ) from exc

        raise HTTPException(
            status_code=502,
            detail=error_description or AUTH0_UPSTREAM_UNAVAILABLE_DETAIL,
        ) from exc
    except urllib_error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=AUTH0_UPSTREAM_UNAVAILABLE_DETAIL,
        ) from exc

    claims = _auth0_decode_id_token(payload.get("id_token"))
    if not claims:
        claims = {}
    return claims


def _auth0_signup(payload: SignupRequest) -> None:
    config = _auth0_config()
    if config is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Auth0 is not configured for signup. "
                "Set AUTH0_DOMAIN (or AUTH0_ISSUER_BASE_URL), AUTH0_CLIENT_ID, "
                "and AUTH0_CLIENT_SECRET."
            ),
        )

    request_body = json.dumps(
        {
            "client_id": config["client_id"],
            "email": payload.email,
            "password": payload.password,
            "connection": config["connection"],
            "username": payload.username,
        }
    ).encode("utf-8")

    request = urllib_request.Request(
        url=f"{config['domain']}/dbconnections/signup",
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib_request.urlopen(
            request, timeout=AUTH0_REQUEST_TIMEOUT_SECONDS
        ) as _response:
            return
    except urllib_error.HTTPError as exc:
        error_payload = _json_from_bytes(exc.read())
        error_text = " ".join(
            [
                str(error_payload.get("error", "")),
                str(error_payload.get("name", "")),
                str(error_payload.get("code", "")),
                str(error_payload.get("description", "")),
            ]
        ).lower()
        if "user_exists" in error_text or "already exists" in error_text:
            raise HTTPException(
                status_code=409, detail="Username or email is already registered."
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=AUTH0_UPSTREAM_UNAVAILABLE_DETAIL,
        ) from exc
    except urllib_error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=AUTH0_UPSTREAM_UNAVAILABLE_DETAIL,
        ) from exc


def _to_user_view(user: LocalAuthUser) -> UserView:
    return UserView(
        id=user.id,
        username=user.username,
        email=user.email,
        created_at=user.created_at,
    )


def _issue_local_session_token_or_raise(user: LocalAuthUser) -> str:
    try:
        return issue_local_auth_session_token(user.id)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


def _find_existing_user_for_signup(
    db: Session, payload: SignupRequest
) -> LocalAuthUser | None:
    return db.execute(
        select(LocalAuthUser).where(
            or_(
                func.lower(LocalAuthUser.username) == payload.username.lower(),
                func.lower(LocalAuthUser.email) == payload.email.lower(),
            )
        )
    ).scalar_one_or_none()


def _find_user_for_login(db: Session, payload: LoginRequest) -> LocalAuthUser | None:
    identifier = (payload.identifier or "").strip().lower()
    return db.execute(
        select(LocalAuthUser).where(
            or_(
                func.lower(LocalAuthUser.username) == identifier,
                func.lower(LocalAuthUser.email) == identifier,
            )
        )
    ).scalar_one_or_none()


def _normalize_username_candidate(candidate: str) -> str:
    sanitized = USERNAME_ALLOWED_CHARS_PATTERN.sub("_", candidate.strip())
    sanitized = sanitized.strip("._-")
    if not sanitized:
        sanitized = "player"
    if len(sanitized) < 3:
        sanitized = f"{sanitized}_user"
    return sanitized[:32]


def _build_local_username_from_auth0(
    db: Session, *, identifier: str, auth0_claims: dict
) -> str:
    candidates: list[str] = []
    for key in ("preferred_username", "nickname", "name"):
        value = auth0_claims.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value)
    if "@" in identifier:
        candidates.append(identifier.split("@", 1)[0])
    else:
        candidates.append(identifier)

    base = _normalize_username_candidate(candidates[0] if candidates else "player")
    probe = base
    suffix = 1
    while True:
        exists = db.execute(
            select(LocalAuthUser).where(func.lower(LocalAuthUser.username) == probe.lower())
        ).scalar_one_or_none()
        if exists is None:
            return probe
        suffix += 1
        trimmed_base = base[: max(1, 32 - len(str(suffix)) - 1)]
        probe = f"{trimmed_base}_{suffix}"


def _looks_like_email(value: str) -> bool:
    return bool(EMAIL_LIKE_PATTERN.fullmatch(value.strip()))


def _sync_local_user_after_auth0_login(
    db: Session, payload: LoginRequest, auth0_claims: dict
) -> LocalAuthUser:
    user = _find_user_for_login(db, payload)
    if user is not None:
        # Keep local password hash aligned so DB-backed flows remain consistent.
        user.password_hash = hash_password(payload.password)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    identifier = (payload.identifier or "").strip()
    email_from_claims = auth0_claims.get("email")
    resolved_email: str | None = None
    if isinstance(email_from_claims, str) and email_from_claims.strip():
        resolved_email = email_from_claims.strip().lower()
    elif "@" in identifier:
        resolved_email = identifier.lower()

    if not resolved_email:
        raise HTTPException(
            status_code=400,
            detail=(
                "Auth0 login succeeded but no email was available to create a local profile."
            ),
        )

    username = _build_local_username_from_auth0(
        db, identifier=identifier, auth0_claims=auth0_claims
    )

    new_user = LocalAuthUser(
        username=username,
        email=resolved_email,
        password_hash=hash_password(payload.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


def _finalize_existing_local_login(
    db: Session, user: LocalAuthUser, password: str
) -> LocalAuthUser:
    user.password_hash = hash_password(password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


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

        _auth0_signup(payload)

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
            local_session_token=_issue_local_session_token_or_raise(new_user),
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        _raise_db_unavailable(SIGNUP_DB_UNAVAILABLE_DETAIL)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        identifier = (payload.identifier or "").strip()
        local_user = _find_user_for_login(db, payload)
        auth0_claims: dict
        try:
            auth0_claims = _auth0_verify_login(
                identifier=identifier,
                password=payload.password,
            )
        except HTTPException as exc:
            # If a user types username instead of email, retry Auth0 against
            # local user's email to support a regular username/email login UX.
            if exc.status_code == 401 and not _looks_like_email(identifier):
                retry_email = (
                    local_user.email.strip()
                    if local_user is not None and isinstance(local_user.email, str)
                    else ""
                )
                if retry_email and retry_email.lower() != identifier.lower():
                    auth0_claims = _auth0_verify_login(
                        identifier=retry_email,
                        password=payload.password,
                    )
                else:
                    # Local fallback path: existing DB user with valid password
                    # can be synced into Auth0 so legacy users are not locked out.
                    if local_user is None or not verify_password(
                        payload.password, local_user.password_hash
                    ):
                        raise

                    try:
                        _auth0_signup(
                            SignupRequest(
                                username=local_user.username,
                                email=local_user.email,
                                password=payload.password,
                            )
                        )
                    except HTTPException as sync_exc:
                        # "already exists" means account is present in Auth0.
                        # Any other Auth0 sync error should not block a known-good
                        # local login credential.
                        if sync_exc.status_code == 409:
                            pass

                    try:
                        auth0_claims = _auth0_verify_login(
                            identifier=local_user.email,
                            password=payload.password,
                        )
                    except HTTPException:
                        auth0_claims = {}
            else:
                if local_user is None or not verify_password(
                    payload.password, local_user.password_hash
                ):
                    raise
                auth0_claims = {}

        if auth0_claims:
            user = _sync_local_user_after_auth0_login(db, payload, auth0_claims)
        else:
            # Local credentials verified; keep UX moving while Auth0 account
            # converges in background retries.
            if local_user is None:
                raise HTTPException(status_code=401, detail="Invalid username or password.")
            user = _finalize_existing_local_login(db, local_user, payload.password)

        return AuthResponse(
            message="Login successful.",
            user=_to_user_view(user),
            local_session_token=_issue_local_session_token_or_raise(user),
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        _raise_db_unavailable(LOGIN_DB_UNAVAILABLE_DETAIL)
