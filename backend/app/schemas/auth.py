from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import UserRole
from app.schemas.common import User


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)

    @field_validator("email", "password")
    @classmethod
    def _no_nul(cls, value: str) -> str:
        # Postgres text cannot hold NUL; reject it here instead of failing in the query.
        if "\x00" in value:
            raise ValueError("must not contain NUL characters")
        return value


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - the scheme name, not a secret
    expires_in: int
    user: User


class DemoAccount(BaseModel):
    role: UserRole
    email: str
    password: str
    full_name: str
