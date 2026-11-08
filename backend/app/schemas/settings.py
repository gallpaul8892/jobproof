"""Branding and admin settings schemas."""

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, field_validator, model_validator

from app.schemas.common import PersonRef, UtcDatetime
from app.schemas.text import MSG_CONTROL, contains_forbidden_character

COMPANY_NAME_MAX = 60
_HEX_INPUT = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MSG_EMPTY = "Enter a company name."
_MSG_LONG = f"Use {COMPANY_NAME_MAX} characters or fewer."
_MSG_CONTROL = MSG_CONTROL


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
    uk_only_contact_details: bool


class AdminSettings(BaseModel):
    company_name: str
    theme: Theme
    uk_only_contact_details: bool
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
    uk_only_contact_details: bool | None = None

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

    @field_validator("uk_only_contact_details", mode="before")
    @classmethod
    def _flag_is_a_real_boolean(cls, value: object) -> bool:
        if not isinstance(value, bool):
            raise ValueError("Send true or false.")
        return value

    @model_validator(mode="after")
    def _at_least_one(self) -> "AdminSettingsUpdate":
        if not self.model_fields_set:
            raise ValueError("Send company_name, theme, uk_only_contact_details or a combination.")
        return self
