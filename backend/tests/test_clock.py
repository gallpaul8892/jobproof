from datetime import date

from app import clock


def test_fixed_now_drives_today_in_london() -> None:
    assert clock.now().isoformat() == "2026-10-15T10:00:00+00:00"
    assert clock.today_london() == date(2026, 10, 15)
