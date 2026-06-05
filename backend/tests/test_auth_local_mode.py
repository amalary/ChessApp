import os
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db_auth import get_db
from app.local_auth_session import issue_local_auth_session_token
from app.models_auth import LocalAuthUser
from app.routers import auth
from app.security import hash_password, verify_password


class _ScalarResult:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _FakeDb:
    def __init__(self, user: LocalAuthUser):
        self.user = user
        self.commits = 0
        self.rollbacks = 0

    def get(self, _model, user_id):
        return self.user if user_id == self.user.id else None

    def execute(self, _statement):
        return _ScalarResult(None)

    def add(self, _value):
        return None

    def commit(self):
        self.commits += 1

    def refresh(self, _value):
        return None

    def rollback(self):
        self.rollbacks += 1


def _local_auth_client(user: LocalAuthUser) -> TestClient:
    os.environ.setdefault("LOCAL_AUTH_SESSION_SECRET", "test-local-auth-session-secret")
    app = FastAPI()
    app.include_router(auth.router)
    fake_db = _FakeDb(user)

    def _override_get_db():
        yield fake_db

    app.dependency_overrides[get_db] = _override_get_db
    client = TestClient(app, raise_server_exceptions=False)
    client.fake_db = fake_db
    return client


def _local_auth_headers(user: LocalAuthUser) -> dict[str, str]:
    return {
        "X-Local-Auth-User-Id": str(user.id),
        "X-Local-Auth-Session": issue_local_auth_session_token(user.id),
    }


def test_local_auth_defaults_to_local_db_mode_in_development(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("ALLOW_LOCAL_AUTH_FALLBACK", raising=False)
    monkeypatch.delenv("SYNC_LOCAL_AUTH_WITH_AUTH0", raising=False)

    assert auth._allow_local_auth_fallback() is True
    assert auth._sync_local_auth_with_auth0() is False


def test_local_auth_defaults_to_auth0_sync_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOW_LOCAL_AUTH_FALLBACK", raising=False)
    monkeypatch.delenv("SYNC_LOCAL_AUTH_WITH_AUTH0", raising=False)

    assert auth._allow_local_auth_fallback() is False
    assert auth._sync_local_auth_with_auth0() is True


def test_local_auth_env_overrides_defaults(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_LOCAL_AUTH_FALLBACK", "true")
    monkeypatch.setenv("SYNC_LOCAL_AUTH_WITH_AUTH0", "false")

    assert auth._allow_local_auth_fallback() is True
    assert auth._sync_local_auth_with_auth0() is False


def test_update_local_profile_uses_authenticated_user(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_SESSION_SECRET", "test-local-auth-session-secret")
    user = LocalAuthUser(
        id=uuid4(),
        username="old-name",
        email="old@example.com",
        password_hash=hash_password("Oldpass123"),
    )
    client = _local_auth_client(user)

    response = client.patch(
        "/auth/me/local/profile",
        headers=_local_auth_headers(user),
        json={"username": "new-name", "email": "new@example.com"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == "new-name"
    assert response.json()["email"] == "new@example.com"
    assert user.username == "new-name"
    assert user.email == "new@example.com"


def test_change_local_password_requires_current_password(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_SESSION_SECRET", "test-local-auth-session-secret")
    user = LocalAuthUser(
        id=uuid4(),
        username="player",
        email="player@example.com",
        password_hash=hash_password("Oldpass123"),
    )
    client = _local_auth_client(user)

    response = client.post(
        "/auth/me/local/password",
        headers=_local_auth_headers(user),
        json={"current_password": "wrongpass", "new_password": "Newpass123"},
    )

    assert response.status_code == 401
    assert verify_password("Oldpass123", user.password_hash)


def test_change_local_password_updates_hash(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_SESSION_SECRET", "test-local-auth-session-secret")
    monkeypatch.setenv("SYNC_LOCAL_AUTH_WITH_AUTH0", "false")
    user = LocalAuthUser(
        id=uuid4(),
        username="player",
        email="player@example.com",
        password_hash=hash_password("Oldpass123"),
    )
    client = _local_auth_client(user)

    response = client.post(
        "/auth/me/local/password",
        headers=_local_auth_headers(user),
        json={"current_password": "Oldpass123", "new_password": "Newpass123"},
    )

    assert response.status_code == 200
    assert verify_password("Newpass123", user.password_hash)
