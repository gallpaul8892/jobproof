"""T-002e: the contrast rule. The cases are the ticket's table, shared in spirit with Vitest."""

import pytest

from app.branding.contrast import (
    contrast_against_white,
    contrast_ratio,
    meets_aa,
    relative_luminance,
    report_ratio,
    weakest_contrast,
)
from app.branding.defaults import DEFAULT_THEME

# (colour, ratio vs white as reported, ratio vs the surface colour as reported, passes both)
CASES = [
    ("#1F5130", 9.22, 8.53, True),
    ("#2F5D3A", 7.64, 7.07, True),
    ("#1B1F1C", 16.68, None, True),
    ("#717171", 4.88, 4.52, True),  # lowest grey the rule accepts
    ("#727272", 4.81, 4.45, False),  # passes on white, fails on the surface colour
    ("#767676", 4.54, 4.20, False),
    ("#777777", 4.48, 4.14, False),
    ("#4CAF50", 2.78, 2.57, False),
    ("#FFD400", 1.43, 1.32, False),
    ("#1F3A5F", None, None, True),
    ("#2B4C7E", 8.61, None, True),
    ("#2B2B2B", 14.16, None, True),
    ("#444444", 9.74, None, True),
    ("#7A1F2B", 10.20, None, True),
    ("#8A2433", 8.82, None, True),
]


@pytest.mark.parametrize(("colour", "on_white", "on_surface", "passes"), CASES)
def test_ticket_table(
    colour: str, on_white: float | None, on_surface: float | None, passes: bool
) -> None:
    white = contrast_against_white(colour)
    surface = contrast_ratio(colour, DEFAULT_THEME.surface)
    if on_white is not None:
        assert report_ratio(white) == on_white
    if on_surface is not None:
        assert report_ratio(surface) == on_surface
    ratio, background = weakest_contrast(colour, DEFAULT_THEME.surface)
    assert meets_aa(ratio) is passes
    assert ratio == min(white, surface)
    assert background == ("white" if white <= surface else "surface")


def test_default_theme_and_presets_pass_on_both_backgrounds() -> None:
    colours = [DEFAULT_THEME.primary, DEFAULT_THEME.accent, DEFAULT_THEME.text]
    colours += ["#1F3A5F", "#2B4C7E", "#2B2B2B", "#444444", "#7A1F2B", "#8A2433"]
    for colour in colours:
        ratio, _ = weakest_contrast(colour, DEFAULT_THEME.surface)
        assert meets_aa(ratio), colour


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
