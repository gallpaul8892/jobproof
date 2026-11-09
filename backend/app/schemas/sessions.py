"""Device session request and response bodies (contract: DeviceSessionRequest, DeviceSession...)."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import User, UtcDatetime
from app.schemas.text import MSG_CONTROL, contains_forbidden_character

SemVerStr = Annotated[str, Field(pattern=r"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$")]


class DeviceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)
    device_id: uuid.UUID
    device_name: str | None = Field(default=None, max_length=60)
    platform: Literal["android", "ios"]
    app_version: SemVerStr

    @field_validator("email", "password")
    @classmethod
    def _no_nul(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("must not contain NUL characters")
        return value

    @field_validator("device_name")
    @classmethod
    def _clean_device_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if contains_forbidden_character(value):
            raise ValueError(MSG_CONTROL)
        return value.strip(" ") or None


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=20, max_length=200)


class DeviceSession(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - the scheme name, not a secret
    expires_in: int
    refresh_token: str
    refresh_expires_at: UtcDatetime
    session_id: uuid.UUID
    user: User
