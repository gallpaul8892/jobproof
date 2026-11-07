"""WCAG 2.2 contrast maths. Twin of `shared/src/branding/contrast.ts`; both are tested against
the same table of cases."""

import math
from decimal import ROUND_HALF_UP, Decimal

REQUIRED_RATIO = 4.5
# Relative luminance of white; the contrast rule is always measured against it (D6).
WHITE_LUMINANCE = 1.0


def _channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_colour: str) -> float:
    red, green, blue = (int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(red) + 0.7152 * _channel(green) + 0.0722 * _channel(blue)


def contrast_ratio(first: str, second: str) -> float:
    a, b = relative_luminance(first), relative_luminance(second)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


def contrast_against_white(hex_colour: str) -> float:
    return (WHITE_LUMINANCE + 0.05) / (relative_luminance(hex_colour) + 0.05)


def meets_aa(ratio: float) -> bool:
    """Compared unrounded: 4.4999 fails even though it displays as 4.50."""
    return ratio >= REQUIRED_RATIO


def report_ratio(ratio: float) -> float:
    """Two decimals half-up; a failing ratio is never reported as 4.50 (it becomes 4.49)."""
    rounded = float(Decimal(repr(ratio)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if not meets_aa(ratio) and rounded >= REQUIRED_RATIO:
        return 4.49
    return rounded if math.isfinite(rounded) else 0.0
