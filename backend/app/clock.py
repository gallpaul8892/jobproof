"""The only source of "now". Business dates use Europe/London."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.config import get_settings

LONDON = ZoneInfo("Europe/London")


def now() -> datetime:
    """Current UTC time, or FIXED_NOW (non-production only)."""
    fixed = get_settings().fixed_now
    if fixed is not None:
        return fixed if fixed.tzinfo else fixed.replace(tzinfo=UTC)
    return datetime.now(UTC)


def today_london() -> date:
    return now().astimezone(LONDON).date()
