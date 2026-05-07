import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Ensure backend package paths are importable when running Alembic from backend/.
backend_root = Path(__file__).resolve().parents[1]
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(1, str(project_root))

from app.models_auth import Base  # noqa: E402
from app import models_puzzle  # noqa: F401,E402

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD")
    db_name = os.environ.get("DB_NAME")
    if not db_user or not db_password or not db_name:
        raise RuntimeError(
            "Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_NAME with "
            "DB_HOST/DB_PORT (Cloud SQL Auth Proxy) or CLOUD_SQL_CONNECTION_NAME "
            "(Cloud Run unix socket)."
        )

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


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = _get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    url = _get_database_url()
    config.set_main_option("sqlalchemy.url", url)

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
