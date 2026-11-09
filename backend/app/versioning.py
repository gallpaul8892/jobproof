"""Contract version and mobile app version comparison (semver `major.minor.patch` only).

The 426 enforcement for old app builds is T-003n; T-003a only reports the minimum.
"""

import re

# Keep equal to `info.version` in api/openapi.yaml (a test compares them).
API_VERSION = "0.6.0"

_SEMVER = re.compile(r"([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})")


def parse_semver(value: str) -> tuple[int, int, int]:
    """(major, minor, patch) of `value`; ValueError when it is not exactly three numbers."""
    match = _SEMVER.fullmatch(value)
    if match is None:
        raise ValueError("not a semantic version")
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch)


def is_older(version: str, minimum: str) -> bool:
    """True when `version` is below `minimum`."""
    return parse_semver(version) < parse_semver(minimum)
