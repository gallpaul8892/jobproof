"""Environment-driven settings, validated at startup."""

import base64
import binascii
import re
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

# Development-only fallbacks, used when APP_ENV is local or test and nothing is configured.
# Any other environment (staging, production) must supply real secrets, or startup fails.
_DEV_JWT_SECRET = "dev-only-jwt-secret-change-me-0123456789abcdef"  # noqa: S105
_DEV_PHOTO_URL_SECRET = "dev-only-photo-secret-change-me-0123456789ab"  # noqa: S105
_DEV_SECRETS = frozenset({_DEV_JWT_SECRET.lower(), _DEV_PHOTO_URL_SECRET.lower()})
_APP_ENVS = ("local", "test", "staging", "production")
# The RDS CA bundle (a public certificate), committed so no network is needed (INFRA spec 5.2).
DEFAULT_DB_SSLROOTCERT = Path(__file__).resolve().parents[1] / "certs" / "rds-global-bundle.pem"
_SEMVER = re.compile(r"[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}")  # twin of the contract's SemVer
_PEM_CERT = re.compile(r"-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----")


def count_pem_certificates(text: str) -> int:
    """Number of well-formed PEM certificates in `text` (base64 body that decodes to DER)."""
    count = 0
    for match in _PEM_CERT.finditer(text):
        try:
            der = base64.b64decode("".join(match.group(1).split()), validate=True)
        except (binascii.Error, ValueError):
            continue
        if len(der) > 64 and der[0] == 0x30:  # an ASN.1 SEQUENCE of plausible size
            count += 1
    return count


def _check_ca_bundle(path: str) -> None:
    """Fail closed: a missing, unreadable or placeholder bundle must stop startup."""
    try:
        content = Path(path).read_text(encoding="ascii", errors="replace")
    except OSError as exc:
        raise ValueError(f"DB_SSLROOTCERT {path} cannot be read ({type(exc).__name__})") from None
    if count_pem_certificates(content) == 0:
        raise ValueError(
            f"DB_SSLROOTCERT {path} contains no valid PEM certificate "
            "(is the RDS CA bundle still the committed placeholder?)"
        )


SslMode = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]


class Settings(BaseSettings):
    # hide_input_in_errors: validation errors must never echo setting values (secrets) to logs.
    model_config = SettingsConfigDict(
        extra="ignore", env_ignore_empty=True, hide_input_in_errors=True
    )

    # Required, no default: a deployment that forgets it must fail, not fall back to dev behaviour.
    app_env: Literal["local", "test", "staging", "production"]
    # Either DATABASE_URL, or the DB_* parts below (ECS injects secret fields but cannot assemble
    # a URL). `_database_connection` fills `database_url` from the parts, so the rest of the app
    # only ever reads `database_url`.
    database_url: str = ""
    db_host: str | None = None
    db_port: int = Field(default=5432, ge=1, le=65535)
    db_name: str | None = None
    db_user: str | None = None
    db_password: SecretStr | None = None
    db_sslmode: SslMode | None = None
    db_sslrootcert: str | None = None
    jwt_secret: str = Field(default=_DEV_JWT_SECRET, min_length=32)
    jwt_ttl_seconds: int = Field(default=1800, ge=60)
    # Operative app device sessions (T-003b, design section 4).
    device_access_ttl_seconds: int = Field(default=900, ge=60)
    device_session_idle_days: int = Field(default=30, ge=1)
    device_session_max_days: int = Field(default=90, ge=1)
    refresh_reuse_grace_seconds: int = Field(default=60, ge=0)
    # Lowest mobile app version the server supports (T-003a reports it, T-003n enforces it).
    mobile_min_version_android: str = "0.0.0"
    photo_url_secret: str = Field(default=_DEV_PHOTO_URL_SECRET, min_length=32)
    photo_url_ttl_seconds: int = Field(default=900, ge=30)
    public_api_base_url: str = "http://localhost:8000"
    cors_allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:8080"]
    demo_accounts_enabled: bool = False
    # app.seed.demo only (dev task definition); refused in production (INFRA spec 4.5).
    demo_seed_allowed: bool = False
    demo_password: SecretStr | None = None
    log_level: str = "INFO"
    fixed_now: datetime | None = None
    seed_anchor_date: date | None = None

    @model_validator(mode="before")
    @classmethod
    def _require_app_env(cls, data: Any) -> Any:
        if isinstance(data, dict) and not data.get("app_env"):
            raise ValueError(f"APP_ENV is required; set it to one of: {', '.join(_APP_ENVS)}")
        return data

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

    @field_validator("mobile_min_version_android")
    @classmethod
    def _semver(cls, value: str) -> str:
        if not _SEMVER.fullmatch(value):
            raise ValueError("MOBILE_MIN_VERSION_ANDROID must be a version such as 1.2.3")
        return value

    @model_validator(mode="after")
    def _session_lifetimes(self) -> Self:
        if self.device_session_idle_days > self.device_session_max_days:
            raise ValueError("DEVICE_SESSION_IDLE_DAYS must not exceed DEVICE_SESSION_MAX_DAYS")
        return self

    @field_validator("log_level")
    @classmethod
    def _upper_level(cls, value: str) -> str:
        level = value.upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
        return level

    @model_validator(mode="after")
    def _database_connection(self) -> Self:
        parts = (
            self.db_host,
            self.db_name,
            self.db_user,
            self.db_password,
            self.db_sslmode,
            self.db_sslrootcert,
        )
        if self.database_url:
            if any(part is not None for part in parts):
                raise ValueError("Set DATABASE_URL or the DB_* settings, not both")
            if self.app_env in ("staging", "production"):
                try:
                    url_query = make_url(self.database_url).query
                except ArgumentError:
                    raise ValueError("DATABASE_URL is not a valid database URL") from None
                if url_query.get("sslmode") != "verify-full":
                    raise ValueError(
                        f"DATABASE_URL must include sslmode=verify-full when APP_ENV={self.app_env}"
                    )
                url_cert = url_query.get("sslrootcert")
                if not isinstance(url_cert, str) or not url_cert:
                    raise ValueError(
                        f"DATABASE_URL must include sslrootcert when APP_ENV={self.app_env}"
                    )
                _check_ca_bundle(url_cert)
            return self
        missing = [
            name
            for name, value in (
                ("DB_HOST", self.db_host),
                ("DB_NAME", self.db_name),
                ("DB_USER", self.db_user),
                ("DB_PASSWORD", self.db_password),
            )
            if value is None
        ]
        if missing:
            raise ValueError(f"Set DATABASE_URL, or all of DB_*: missing {', '.join(missing)}")
        assert self.db_password is not None  # noqa: S101 - narrowed by the check above
        query: dict[str, str] = {}
        strict = self.app_env in ("staging", "production")
        mode = self.db_sslmode or ("verify-full" if strict else "prefer")
        if strict and mode != "verify-full":
            raise ValueError(f"DB_SSLMODE must be verify-full when APP_ENV={self.app_env}")
        query["sslmode"] = mode
        if mode in ("verify-ca", "verify-full"):
            cert = self.db_sslrootcert or str(DEFAULT_DB_SSLROOTCERT)
            _check_ca_bundle(cert)
            query["sslrootcert"] = cert
        elif self.db_sslrootcert:
            query["sslrootcert"] = self.db_sslrootcert
        self.database_url = URL.create(
            "postgresql+psycopg",
            username=self.db_user,
            password=self.db_password.get_secret_value(),
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
            query=query,
        ).render_as_string(hide_password=False)
        return self

    @model_validator(mode="after")
    def _production_guards(self) -> Self:
        if self.app_env not in ("local", "test"):
            for name in ("jwt_secret", "photo_url_secret"):
                if name not in self.model_fields_set:
                    raise ValueError(f"{name.upper()} must be set when APP_ENV={self.app_env}")
                value = getattr(self, name)
                if value != value.strip():
                    raise ValueError(f"{name.upper()} must not have leading or trailing whitespace")
                if value.lower().startswith("dev-only-") or value.lower() in _DEV_SECRETS:
                    raise ValueError(
                        f"{name.upper()} must not be a development value when "
                        f"APP_ENV={self.app_env}"
                    )
            if self.jwt_secret.strip().lower() == self.photo_url_secret.strip().lower():
                raise ValueError("JWT_SECRET and PHOTO_URL_SECRET must differ")
        if self.demo_accounts_enabled and self.app_env not in ("local", "test"):
            raise ValueError(
                "DEMO_ACCOUNTS_ENABLED must be false unless APP_ENV is local or test "
                "(the list includes the admin password)"
            )
        if self.demo_seed_allowed and self.app_env == "production":
            raise ValueError("DEMO_SEED_ALLOWED must not be set when APP_ENV=production")
        if self.app_env == "production" and self.fixed_now is not None:
            raise ValueError("FIXED_NOW must not be set when APP_ENV=production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
