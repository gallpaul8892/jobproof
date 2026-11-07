"""Building blocks shared by several responses."""

import datetime as dt
import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel

from app.models.enums import UserRole


def _to_utc(value: dt.datetime) -> dt.datetime:
    return value.astimezone(dt.UTC)


# Serialises as ISO 8601 with a trailing Z whatever time zone the driver returned.
UtcDatetime = Annotated[dt.datetime, AfterValidator(_to_utc)]
Currency = Literal["GBP"]


class PersonRef(BaseModel):
    id: uuid.UUID
    name: str


class Address(BaseModel):
    line1: str
    line2: str | None
    town: str
    county: str | None
    postcode: str


class User(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
