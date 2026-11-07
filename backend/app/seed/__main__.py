"""One-shot seed command: `python -m app.seed`."""

import logging

from app.config import get_settings
from app.logging import setup_logging

logger = logging.getLogger("jobproof.seed")


def main() -> None:
    setup_logging(get_settings().log_level)
    logger.info("nothing to seed")


if __name__ == "__main__":
    main()
