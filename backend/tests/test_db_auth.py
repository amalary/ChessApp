from app import db_auth


def test_database_url_takes_precedence_over_cloud_sql_env(monkeypatch):
    direct_url = "postgresql+psycopg://direct:secret@localhost:5432/direct_db"
    monkeypatch.setenv("DATABASE_URL", direct_url)
    monkeypatch.setenv("DB_USER", "cloud-user")
    monkeypatch.setenv("DB_PASSWORD", "cloud-password")
    monkeypatch.setenv("DB_NAME", "cloud-db")
    monkeypatch.setenv("CLOUD_SQL_CONNECTION_NAME", "project:region:instance")

    db_auth._session_factory.cache_clear()

    assert db_auth._build_database_url() == direct_url


def test_database_url_can_be_built_from_cloud_sql_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_USER", "cloud-user")
    monkeypatch.setenv("DB_PASSWORD", "cloud password")
    monkeypatch.setenv("DB_NAME", "cloud-db")
    monkeypatch.setenv("CLOUD_SQL_CONNECTION_NAME", "project:region:instance")

    db_auth._session_factory.cache_clear()

    assert db_auth._build_database_url() == (
        "postgresql+psycopg://cloud-user:cloud+password@/cloud-db"
        "?host=/cloudsql/project:region:instance"
    )


def test_psycopg_database_url_strips_sqlalchemy_driver(monkeypatch):
    direct_url = "postgresql+psycopg://direct:secret@localhost:5432/direct_db"
    monkeypatch.setenv("DATABASE_URL", direct_url)

    db_auth._session_factory.cache_clear()

    assert (
        db_auth.build_psycopg_database_url()
        == "postgresql://direct:secret@localhost:5432/direct_db"
    )


def test_psycopg_database_url_can_be_built_from_cloud_sql_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_USER", "cloud-user")
    monkeypatch.setenv("DB_PASSWORD", "cloud password")
    monkeypatch.setenv("DB_NAME", "cloud-db")
    monkeypatch.setenv("CLOUD_SQL_CONNECTION_NAME", "project:region:instance")

    db_auth._session_factory.cache_clear()

    assert db_auth.build_psycopg_database_url() == (
        "postgresql://cloud-user:cloud+password@/cloud-db"
        "?host=/cloudsql/project:region:instance"
    )


def test_runtime_status_reports_missing_database_config(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DB_USER", raising=False)
    monkeypatch.delenv("DB_PASSWORD", raising=False)
    monkeypatch.delenv("DB_NAME", raising=False)

    db_auth._session_factory.cache_clear()

    status = db_auth.get_auth_db_runtime_status()

    assert status["connection_ok"] is False
    assert status["error_type"] == "RuntimeError"
    assert status["db_user_configured"] is False
    assert status["db_password_configured"] is False
    assert status["db_name_configured"] is False
