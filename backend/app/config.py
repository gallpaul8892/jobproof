"""Environment-driven settings, validated at startup."""

from datetime import date, datetime
from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Development-only fallbacks, used when APP_ENV is local or test and nothing is configured.
# Any other environment (staging, production) must supply real secrets, or startup fails.
_DEV_JWT_SECRET = "dev-only-jwt-secret-change-me-0123456789abcdef"  # noqa: S105
_DEV_PHOTO_URL_SECRET = "dev-only-photo-secret-change-me-0123456789ab"  # noqa: S105


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", env_ignore_empty=True)

    app_env: Literal["local", "test", "staging", "production"] = "local"
    database_url: str
    jwt_secret: str = Field(default=_DEV_JWT_SECRET, min_length=32)
    jwt_ttl_seconds: int = Field(default=1800, ge=60)
    photo_url_secret: str = Field(default=_DEV_PHOTO_URL_SECRET, min_length=32)
    photo_url_ttl_seconds: int = Field(default=900, ge=30)
    public_api_base_url: str = "http://localhost:8000"
    cors_allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:8080"]
    demo_accounts_enabled: bool = False
    log_level: str = "INFO"
    fixed_now: datetime | None = None
    seed_anchor_date: date | None = None

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def _no_wildcard(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("CORS_ALLOWED_ORIGINS must not contain a wildcard")
        return value

    @field_validator("log_level")
    @classmethod
    def _upper_level(cls, value: str) -> str:
        level = value.upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
        return level

    @model_validator(mode="after")
    def _production_guards(self) -> Self:
        if self.app_env not in ("local", "test"):
            for name in ("jwt_secret", "photo_url_secret"):
                if name not in self.model_fields_set:
                    raise ValueError(f"{name.upper()} must be set when APP_ENV={self.app_env}")
                value = getattr(self, name)
                if value.startswith("dev-only-") or value in (
                    _DEV_JWT_SECRET,
                    _DEV_PHOTO_URL_SECRET,
                ):
                    raise ValueError(
                        f"{name.upper()} must not be a development value when "
                        f"APP_ENV={self.app_env}"
                    )
            if self.jwt_secret == self.photo_url_secret:
                raise ValueError("JWT_SECRET and PHOTO_URL_SECRET must differ")
        if self.app_env == "production":
            if self.demo_accounts_enabled:
                raise ValueError("DEMO_ACCOUNTS_ENABLED must be false when APP_ENV=production")
            if self.fixed_now is not None:
                raise ValueError("FIXED_NOW must not be set when APP_ENV=production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
