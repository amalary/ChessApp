from app.routers import auth


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
