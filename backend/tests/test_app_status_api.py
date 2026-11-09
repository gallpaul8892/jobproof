"""T-003a: GET /api/v1/app/status, the contract version constant and the version setting."""

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.main import create_app
from app.versioning import API_VERSION, is_older, parse_semver
from tests.contract import OPENAPI_PATH, assert_contract

URL = "/api/v1/app/status"


def test_status_is_public_and_matches_the_contract(client: TestClient) -> None:
    response = client.get(URL)
    assert response.status_code == 200
    assert_contract(response, "getAppStatus")
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"server_time", "api_version", "min_supported_versions"}
    assert body["min_supported_versions"] == {"android": "0.0.0"}


def test_server_time_comes_from_the_app_clock(client: TestClient) -> None:
    # FIXED_NOW is pinned by conftest: millisecond precision and a Z suffix.
    assert client.get(URL).json()["server_time"] == "2026-10-15T10:00:00.000Z"


def test_server_time_follows_the_clock(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import datetime as dt

    monkeypatch.setattr(
        get_settings(), "fixed_now", dt.datetime(2026, 10, 15, 12, 30, 5, 250000, tzinfo=dt.UTC)
    )
    assert client.get(URL).json()["server_time"] == "2026-10-15T12:30:05.250Z"


def test_api_version_equals_the_contract_version() -> None:
    with OPENAPI_PATH.open() as handle:
        assert yaml.safe_load(handle)["info"]["version"] == API_VERSION


def test_status_reports_the_configured_minimum_version() -> None:
    settings = get_settings().model_copy(update={"mobile_min_version_android": "1.4.2"})
    with TestClient(create_app(settings)) as other:
        assert other.get(URL).json()["min_supported_versions"] == {"android": "1.4.2"}


def test_status_needs_no_database() -> None:
    unreachable = get_settings().model_copy(
        update={"database_url": "postgresql+psycopg://nobody:none@127.0.0.1:1/none"}
    )
    with TestClient(create_app(unreachable)) as other:
        response = other.get(URL)
    assert response.status_code == 200
    assert_contract(response, "getAppStatus")


@pytest.mark.parametrize("value", ["1.2", "v1.2.3", "1.2.3-beta", "1.2.3.4", "", " 1.2.3", "a.b.c"])
def test_a_bad_minimum_version_refuses_startup(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOBILE_MIN_VERSION_ANDROID", value)
    if value == "":
        # An empty variable counts as unset (env_ignore_empty): the default applies.
        assert Settings().mobile_min_version_android == "0.0.0"  # type: ignore[call-arg]
        return
    with pytest.raises(ValidationError) as excinfo:
        Settings()  # type: ignore[call-arg]
    assert "MOBILE_MIN_VERSION_ANDROID" in str(excinfo.value)


def test_idle_days_may_not_exceed_max_days(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEVICE_SESSION_IDLE_DAYS", "91")
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


def test_access_token_ttl_has_a_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEVICE_ACCESS_TTL_SECONDS", "59")
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


def test_session_settings_defaults() -> None:
    settings = get_settings()
    assert settings.device_access_ttl_seconds == 900
    assert settings.device_session_idle_days == 30
    assert settings.device_session_max_days == 90
    assert settings.refresh_reuse_grace_seconds == 60


def test_semver_parsing_and_comparison() -> None:
    assert parse_semver("1.20.3") == (1, 20, 3)
    for bad in ("1.2", "1.2.3.4", "1.2.x", "01234.1.1", "1.2.3-rc1"):
        with pytest.raises(ValueError, match="semantic"):
            parse_semver(bad)
    assert is_older("1.2.3", "1.10.0")  # numeric, not text, comparison
    assert is_older("0.9.9", "1.0.0")
    assert not is_older("1.0.0", "1.0.0")
    assert not is_older("2.0.0", "1.99.99")
