"""T-002e: the contrast rule. The cases are the ticket's table, shared in spirit with Vitest."""

import pytest

from app.branding.contrast import (
    contrast_against_white,
    contrast_ratio,
    meets_aa,
    relative_luminance,
    report_ratio,
)

# (colour, ratio against white as reported, passes)
CASES = [
    ("#1F5130", 9.22, True),
    ("#2F5D3A", 7.64, True),
    ("#1B1F1C", 16.68, True),
    ("#767676", 4.54, True),
    ("#777777", 4.48, False),
    ("#4CAF50", 2.78, False),
    ("#FFD400", 1.43, False),
    ("#1F3A5F", None, True),
    ("#2B2B2B", 14.16, True),
    ("#444444", 9.74, True),
    ("#7A1F2B", 10.20, True),
]


@pytest.mark.parametrize(("colour", "reported", "passes"), CASES)
def test_ticket_table(colour: str, reported: float | None, passes: bool) -> None:
    ratio = contrast_against_white(colour)
    assert meets_aa(ratio) is passes
    if reported is not None:
        assert report_ratio(ratio) == reported


def test_white_against_white_is_one_and_black_is_twenty_one() -> None:
    assert contrast_against_white("#FFFFFF") == pytest.approx(1.0)
    assert contrast_against_white("#000000") == pytest.approx(21.0)
    assert contrast_ratio("#000000", "#FFFFFF") == pytest.approx(21.0)
    assert relative_luminance("#FFFFFF") == pytest.approx(1.0)


def test_ratio_is_symmetric() -> None:
    assert contrast_ratio("#1F5130", "#F4F7F2") == pytest.approx(
        contrast_ratio("#F4F7F2", "#1F5130")
    )


def test_compared_unrounded_and_never_reported_as_4_50_when_failing() -> None:
    assert meets_aa(4.5)
    assert not meets_aa(4.499999)
    assert report_ratio(4.499999) == 4.49
    assert report_ratio(4.5) == 4.5
    assert report_ratio(4.504) == 4.5
    assert report_ratio(2.775) == 2.78  # half-up, not banker's rounding
