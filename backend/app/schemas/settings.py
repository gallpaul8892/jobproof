"""Branding and admin settings schemas."""

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, field_validator, model_validator

from app.schemas.common import PersonRef, UtcDatetime

COMPANY_NAME_MAX = 60
_HEX_INPUT = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MSG_EMPTY = "Enter a company name."
_MSG_LONG = f"Use {COMPANY_NAME_MAX} characters or fewer."
_MSG_CONTROL = "Remove control characters."


# Rejected anywhere in a name: U+0000-001F, U+007F-009F, and the invisible formatting characters
# U+200B-200F (zero width, direction marks), U+202A-202E (bidi embeddings and overrides),
# U+2066-2069 (bidi isolates), U+FEFF (byte order mark) and lone UTF-16 surrogates U+D800-U+DFFF
# (not valid text; a JSON "\ud800" escape produces one in Python and PostgreSQL then refuses to
# store it). A surrogate pair is a normal astral character in JavaScript and never reaches Python
# as two code points. Twin of `companyName.ts`.
_FORBIDDEN = re.compile(
    "[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ud800-\udfff]"
)


def contains_forbidden_character(value: str) -> bool:
    return _FORBIDDEN.search(value) is not None


def validate_company_name(raw: str) -> str:
    """Trim, then apply the three rules in order (first failure wins). Returns the trimmed name.

    Only the ordinary space (U+0020) is trimmed, so Python and JavaScript agree exactly; tabs,
    line breaks and invisible characters at either end are rejected, not stripped. Length counts
    code points after trimming.
    """
    value = raw.strip(" ")
    if not value:
        raise ValueError(_MSG_EMPTY)
    if len(value) > COMPANY_NAME_MAX:
        raise ValueError(_MSG_LONG)
    if contains_forbidden_character(value):
        raise ValueError(_MSG_CONTROL)
    return value


def _upper_hex(value: str) -> str:
    if not _HEX_INPUT.fullmatch(value):
        raise ValueError("Use a colour in the form #RRGGBB.")
    return value.upper()


HexInput = Annotated[str, AfterValidator(_upper_hex)]


class Theme(BaseModel):
    primary: str
    accent: str
    background: str
    surface: str
    text: str


class Branding(BaseModel):
    company_name: str
    theme: Theme


class AdminSettings(BaseModel):
    company_name: str
    theme: Theme
    updated_at: UtcDatetime | None
    updated_by: PersonRef | None


class ThemeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    primary: HexInput
    accent: HexInput


class AdminSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company_name: str | None = None
    theme: ThemeUpdate | None = None

    @field_validator("company_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError(_MSG_EMPTY)
        return validate_company_name(value)

    @field_validator("theme")
    @classmethod
    def _theme_not_null(cls, value: ThemeUpdate | None) -> ThemeUpdate | None:
        if value is None:
            raise ValueError("Send both colours, primary and accent.")
        return value

    @model_validator(mode="after")
    def _at_least_one(self) -> "AdminSettingsUpdate":
        if not self.model_fields_set:
            raise ValueError("Send company_name, theme or both.")
        return self
