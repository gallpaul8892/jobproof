"""Alembic environment: URL from Settings (or config.attributes["url"]), JSON logging."""

from alembic import context
from sqlalchemy import create_engine, pool

from app.config import get_settings
from app.logging import setup_logging
from app.models import Base

config = context.config
setup_logging(get_settings().log_level)
target_metadata = Base.metadata


def _url() -> str:
    override = config.attributes.get("url")
    return str(override) if override else get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
