"""The only backend copy of the default company name and theme (T-002a, decision D1).

Must equal `shared/src/branding/defaults.ts` (checked by tests). Migration 0002 deliberately
repeats the values: a migration freezes what it inserted and cannot import a module that may
change later.
"""

from dataclasses import dataclass

DEFAULT_COMPANY_NAME = "Arbour Services"


@dataclass(frozen=True)
class Theme:
    primary: str
    accent: str
    background: str
    surface: str
    text: str


DEFAULT_THEME = Theme(
    primary="#1F5130",
    accent="#2F5D3A",
    background="#FFFFFF",
    surface="#F4F7F2",
    text="#1B1F1C",
)
