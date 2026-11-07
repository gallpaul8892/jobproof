"""T-002a scenario 5: company-specific values live in one defaults module per runtime."""

import re
from pathlib import Path

import pytest

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME

ROOT = Path(__file__).resolve().parents[2]
SCANNED = [ROOT / "backend" / "app", ROOT / "shared" / "src", ROOT / "web" / "src"]
SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json"}
DEFAULTS_MODULES = {
    ROOT / "backend" / "app" / "branding" / "defaults.py",
    ROOT / "shared" / "src" / "branding" / "defaults.ts",
}
TS_DEFAULTS = ROOT / "shared" / "src" / "branding" / "defaults.ts"
THEME = vars(DEFAULT_THEME)


def _excluded(path: Path) -> bool:
    parts = path.relative_to(ROOT).parts
    name = path.name
    return (
        path in DEFAULTS_MODULES
        or parts[:3] == ("backend", "app", "seed")
        or parts[:3] == ("shared", "src", "generated")
        or "__pycache__" in parts
        or ".test." in name
        or name.startswith("test_")
        or "tests" in parts
        or "node_modules" in parts
    )


def _sources() -> list[Path]:
    return [
        path
        for base in SCANNED
        if base.exists()
        for path in sorted(base.rglob("*"))
        if path.is_file() and path.suffix in SUFFIXES and not _excluded(path)
    ]


def test_the_scan_covers_source_files() -> None:
    assert len(_sources()) > 30


def test_company_name_and_default_colours_appear_only_in_the_defaults_modules() -> None:
    needles = [re.compile("arbour", re.IGNORECASE)] + [
        re.compile(re.escape(colour), re.IGNORECASE) for colour in THEME.values()
    ]
    offences = [
        f"{path.relative_to(ROOT)}: {needle.pattern}"
        for path in _sources()
        for needle in needles
        if needle.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert not offences, offences


def test_python_and_typescript_default_themes_agree() -> None:
    if not TS_DEFAULTS.exists():
        pytest.skip("shared/src/branding/defaults.ts is created by the shared/web work of T-002a")
    text = TS_DEFAULTS.read_text()
    for key, value in THEME.items():
        match = re.search(rf"\b{key}\s*:\s*[\"'](#[0-9A-Fa-f]{{6}})[\"']", text)
        assert match, key
        assert match.group(1).upper() == value, key


def test_the_default_name_is_not_part_of_the_typescript_defaults() -> None:
    if not TS_DEFAULTS.exists():
        pytest.skip("shared/src/branding/defaults.ts is created by the shared/web work of T-002a")
    assert DEFAULT_COMPANY_NAME not in TS_DEFAULTS.read_text()  # A2: the UI never shows it


def test_the_migration_freezes_the_same_defaults_today() -> None:
    """Migrations are exempt from the scan; this guards against drift going unnoticed."""
    migration = (
        ROOT / "backend" / "migrations" / "versions" / "0002_company_settings.py"
    ).read_text()
    for value in (DEFAULT_COMPANY_NAME, *THEME.values()):
        assert value in migration
