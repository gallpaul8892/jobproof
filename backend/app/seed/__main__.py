"""One-shot seed command: `python -m app.seed`.

Truncates and reloads the deterministic mock dataset. Dates are relative to
SEED_ANCHOR_DATE (default: today in Europe/London). Running it twice with the same anchor
leaves the database unchanged.
"""

import logging

from app.clock import today_london
from app.config import get_settings
from app.db import make_engine
from app.logging import setup_logging
from app.seed.dataset import build_dataset
from app.seed.loader import load

logger = logging.getLogger("jobproof.seed")


def main() -> None:
    settings = get_settings()
    setup_logging(settings.log_level)
    anchor = settings.seed_anchor_date or today_london()
    dataset = build_dataset(anchor)
    engine = make_engine(settings.database_url)
    try:
        counts = load(engine, dataset)
    finally:
        engine.dispose()
    logger.info("seeded anchor=%s %s", anchor, " ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
