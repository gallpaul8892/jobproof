"""Write a Dataset to the database: truncate everything, then insert, in one transaction."""

import dataclasses

from sqlalchemy import Engine, insert, text

from app.models import Base
from app.seed.dataset import Dataset

# Never truncated or inserted by the seed: created by migration 0002 and owned by the Admin.
SEED_PRESERVED_TABLES = frozenset({"company_settings"})


def load(engine: Engine, dataset: Dataset) -> dict[str, int]:
    """Replace all Phase 1 data with `dataset`. Returns the row count per table."""
    tables = [(name, rows) for name, rows in dataset.tables() if name not in SEED_PRESERVED_TABLES]
    counts: dict[str, int] = {}
    with engine.begin() as connection:
        names = ", ".join(name for name, _ in reversed(tables))
        connection.execute(text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))  # noqa: S608
        for name, rows in tables:
            counts[name] = len(rows)
            if rows:
                payload = [dataclasses.asdict(row) for row in rows]  # type: ignore[call-overload]
                connection.execute(insert(Base.metadata.tables[name]), payload)
    return counts
