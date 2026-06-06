from functools import lru_cache
import os
from pathlib import Path
from urllib.parse import quote_plus

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker


def _build_database_url() -> str:
    direct_url = os.environ.get("DATABASE_URL")
    if direct_url:
        return direct_url

    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD")
    db_name = os.environ.get("DB_NAME")
    if db_user and db_password and db_name:
        driver = os.environ.get("DB_DRIVER", "postgresql+psycopg")
        password = quote_plus(db_password)

        cloud_sql_connection_name = os.environ.get("CLOUD_SQL_CONNECTION_NAME")
        if cloud_sql_connection_name:
            socket_dir = os.environ.get("CLOUD_SQL_SOCKET_DIR", "/cloudsql")
            socket_path = f"{socket_dir}/{cloud_sql_connection_name}"
            return f"{driver}://{db_user}:{password}@/{db_name}?host={socket_path}"

        host = os.environ.get("DB_HOST", "127.0.0.1")
        port = os.environ.get("DB_PORT", "5432")
        return f"{driver}://{db_user}:{password}@{host}:{port}/{db_name}"

    raise RuntimeError(
        "Database config is missing. Set DB_USER/DB_PASSWORD/DB_NAME or DATABASE_URL."
    )


def build_psycopg_database_url() -> str:
    database_url = _build_database_url()
    if database_url.startswith("postgresql+psycopg://"):
        return "postgresql://" + database_url[len("postgresql+psycopg://") :]
    if database_url.startswith("postgresql+psycopg2://"):
        return "postgresql://" + database_url[len("postgresql+psycopg2://") :]
    return database_url


def get_auth_db_config_status() -> dict[str, object]:
    direct_url = os.environ.get("DATABASE_URL")
    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD")
    db_name = os.environ.get("DB_NAME")
    cloud_sql_connection_name = os.environ.get("CLOUD_SQL_CONNECTION_NAME")
    socket_dir = os.environ.get("CLOUD_SQL_SOCKET_DIR", "/cloudsql")
    socket_path = (
        f"{socket_dir}/{cloud_sql_connection_name}"
        if cloud_sql_connection_name
        else None
    )

    return {
        "database_url_configured": bool(direct_url),
        "db_user_configured": bool(db_user),
        "db_password_configured": bool(db_password),
        "db_name_configured": bool(db_name),
        "db_host_configured": bool(os.environ.get("DB_HOST")),
        "db_port_configured": bool(os.environ.get("DB_PORT")),
        "db_driver": os.environ.get("DB_DRIVER", "postgresql+psycopg"),
        "cloud_sql_connection_name_configured": bool(cloud_sql_connection_name),
        "cloud_sql_connection_name": cloud_sql_connection_name,
        "cloud_sql_socket_dir": socket_dir,
        "cloud_sql_socket_path": socket_path,
        "cloud_sql_socket_path_exists": (
            Path(socket_path).exists() if socket_path else None
        ),
    }


def get_auth_db_runtime_status() -> dict[str, object]:
    status = get_auth_db_config_status()
    try:
        engine = create_engine(
            _build_database_url(),
            connect_args={"connect_timeout": 5},
            pool_pre_ping=True,
        )
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            inspector = inspect(connection)
            status.update(
                {
                    "connection_ok": True,
                    "local_auth_users_table_exists": inspector.has_table(
                        "local_auth_users"
                    ),
                }
            )
    except RuntimeError as exc:
        status.update(
            {
                "connection_ok": False,
                "error_type": type(exc).__name__,
                "error": str(exc),
            }
        )
    except SQLAlchemyError as exc:
        status.update(
            {
                "connection_ok": False,
                "error_type": type(exc).__name__,
                "error": str(exc)[:1000],
            }
        )
    except Exception as exc:
        status.update(
            {
                "connection_ok": False,
                "error_type": type(exc).__name__,
                "error": str(exc),
            }
        )
    return status


@lru_cache(maxsize=1)
def _session_factory() -> sessionmaker[Session]:
    engine = create_engine(_build_database_url(), pool_pre_ping=True)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    try:
        factory = _session_factory()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    db = factory()
    try:
        yield db
    finally:
        db.close()
