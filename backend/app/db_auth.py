from functools import lru_cache
import os
from urllib.parse import quote_plus

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def _build_database_url() -> str:
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

    direct_url = os.environ.get("DATABASE_URL")
    if direct_url:
        return direct_url

    raise RuntimeError(
        "Database config is missing. Set DB_USER/DB_PASSWORD/DB_NAME or DATABASE_URL."
    )


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
