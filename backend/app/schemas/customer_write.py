"""Request body for customer edits (T-002n). Hostile input is rejected here.

The validators are plain functions, so the case table `shared/src/customer/validationCases.json`
can drive them directly. Twin: `shared/src/customer/validation.ts`. Every function takes the raw
value and returns the value to store (normalised) or raises ValueError with the message shown to
the person.
"""

import re
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.text import clean_required, clean_text, contains_forbidden_character, trim

NAME_MAX = 120
CONTACT_NAME_MAX = 120
EMAIL_MAX = 254
PHONE_MAX = 30
LINE_MAX = 100
TOWN_MAX = 60
COUNTY_MAX = 60
POSTCODE_RAW_MAX = 10

MSG_NAME = "Enter a name."
MSG_EMAIL = "Enter an email address such as name@example.co.uk."
MSG_PHONE = (
    "Enter a UK phone number such as 07700 900123, or an international number starting with +."
)
MSG_LINE1 = "Enter the first line of the address."
MSG_TOWN = "Enter a town or city."
MSG_POSTCODE = "Enter a UK postcode such as BS6 5QA."

Version = Annotated[int, Field(strict=True, ge=1)]

_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+")
_PHONE_CHARS = re.compile(r"\+?[0-9 ()\-]+")
_UK_LOCAL = re.compile(r"0[0-9]{9,10}")
_UK_INTL = re.compile(r"\+44[0-9]{9,10}")
_INTL = re.compile(r"\+[1-9][0-9]{7,14}")
# ASCII only: `str.upper()` would turn a dotless i or a sharp s into ASCII letters.
_POSTCODE = re.compile(r"[A-Za-z]{1,2}[0-9][A-Za-z0-9]?[0-9][A-Za-z]{2}")


def validate_name(raw: str | None) -> str:
    return clean_required(raw, message=MSG_NAME, max_length=NAME_MAX)


def validate_contact_name(raw: str | None) -> str | None:
    return clean_text(raw, required_message=None, max_length=CONTACT_NAME_MAX)


def validate_email(raw: str | None) -> str | None:
    value = clean_text(raw, required_message=None, max_length=EMAIL_MAX)
    if value is not None and not _EMAIL.fullmatch(value):
        raise ValueError(MSG_EMAIL)
    return value


def phone_digits(value: str) -> str:
    """The number without spaces, hyphens, brackets and a `(0)` right after `+44`."""
    squashed = value.replace(" ", "").replace("-", "")
    if squashed.startswith("+44(0)"):
        squashed = "+44" + squashed[len("+44(0)") :]
    return squashed.replace("(", "").replace(")", "")


def normalise_phone(value: str) -> str:
    """Runs of spaces collapse to one space (the value is already trimmed)."""
    return re.sub(" {2,}", " ", value)


def validate_phone(raw: str | None) -> str | None:
    value = clean_text(raw, required_message=None, max_length=PHONE_MAX)
    if value is None:
        return None
    if not _PHONE_CHARS.fullmatch(value):
        raise ValueError(MSG_PHONE)
    digits = phone_digits(value)
    if not (_UK_LOCAL.fullmatch(digits) or _UK_INTL.fullmatch(digits) or _INTL.fullmatch(digits)):
        raise ValueError(MSG_PHONE)
    return normalise_phone(value)


def validate_line1(raw: str | None) -> str:
    return clean_required(raw, message=MSG_LINE1, max_length=LINE_MAX)


def validate_line2(raw: str | None) -> str | None:
    return clean_text(raw, required_message=None, max_length=LINE_MAX)


def validate_town(raw: str | None) -> str:
    return clean_required(raw, message=MSG_TOWN, max_length=TOWN_MAX)


def validate_county(raw: str | None) -> str | None:
    return clean_text(raw, required_message=None, max_length=COUNTY_MAX)


def normalise_postcode(compact: str) -> str:
    """`bs65qa` -> `BS6 5QA`: upper case, inward code (the last three characters) after a space."""
    upper = compact.upper()
    return f"{upper[:-3]} {upper[-3:]}"


def validate_postcode(raw: str | None) -> str:
    value = trim(raw) if raw is not None else ""
    if not value or len(value) > POSTCODE_RAW_MAX or contains_forbidden_character(value):
        raise ValueError(MSG_POSTCODE)
    compact = value.replace(" ", "")
    if not _POSTCODE.fullmatch(compact):
        raise ValueError(MSG_POSTCODE)
    return normalise_postcode(compact)


class AddressUpdate(BaseModel):
    """Partial billing address: only the parts sent change."""

    model_config = ConfigDict(extra="forbid")

    line1: str | None = None
    line2: str | None = None
    town: str | None = None
    county: str | None = None
    postcode: str | None = None

    @field_validator("line1")
    @classmethod
    def _line1(cls, value: str | None) -> str:
        return validate_line1(value)

    @field_validator("line2")
    @classmethod
    def _line2(cls, value: str | None) -> str | None:
        return validate_line2(value)

    @field_validator("town")
    @classmethod
    def _town(cls, value: str | None) -> str:
        return validate_town(value)

    @field_validator("county")
    @classmethod
    def _county(cls, value: str | None) -> str | None:
        return validate_county(value)

    @field_validator("postcode")
    @classmethod
    def _postcode(cls, value: str | None) -> str:
        return validate_postcode(value)

    @model_validator(mode="after")
    def _at_least_one(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Send at least one address field to change.")
        return self


class CustomerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version
    name: str | None = None
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    billing_address: AddressUpdate | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str:
        return validate_name(value)

    @field_validator("contact_name")
    @classmethod
    def _contact_name(cls, value: str | None) -> str | None:
        return validate_contact_name(value)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return validate_email(value)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return validate_phone(value)

    @field_validator("billing_address")
    @classmethod
    def _address_not_null(cls, value: AddressUpdate | None) -> AddressUpdate | None:
        if value is None:
            raise ValueError("Send the address parts to change.")
        return value

    @model_validator(mode="after")
    def _at_least_one_field(self) -> Self:
        if not (self.model_fields_set - {"version"}):
            raise ValueError("Send at least one field to change.")
        return self
