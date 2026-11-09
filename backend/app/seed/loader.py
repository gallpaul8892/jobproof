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
        # audit_events is append-only; the cascade from users/job_reports truncates it, which the
        # guard trigger allows only when this transaction-local setting is on (T-002f).
        connection.execute(text("SET LOCAL jobproof.allow_audit_truncate = 'on'"))
        # auth_sessions references users, so name it explicitly (it is not part of the dataset).
        names = ", ".join(["auth_sessions", *(name for name, _ in reversed(tables))])
        connection.execute(text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))  # noqa: S608
        for name, rows in tables:
            counts[name] = len(rows)
            if rows:
                payload = [dataclasses.asdict(row) for row in rows]  # type: ignore[call-overload]
                connection.execute(insert(Base.metadata.tables[name]), payload)
    return counts
