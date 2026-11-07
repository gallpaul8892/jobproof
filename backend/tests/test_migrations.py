from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy.engine import make_url

from tests.conftest import TEST_DATABASE_URL, alembic_config, ensure_database


def test_upgrade_downgrade_upgrade_and_no_drift() -> None:
    scratch = make_url(TEST_DATABASE_URL).set(database="jobproof_migrations_scratch")
    url = scratch.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    command.check(config)


def test_history_is_empty_until_t001b() -> None:
    script = ScriptDirectory.from_config(alembic_config(TEST_DATABASE_URL))
    assert script.get_heads() == []
