"""The committed RDS CA bundle: fails closed while it is still the placeholder."""

import ssl
from pathlib import Path

import pytest

from app.config import DEFAULT_DB_SSLROOTCERT, Settings, count_pem_certificates

BUNDLE = DEFAULT_DB_SSLROOTCERT


def test_the_bundle_file_is_committed_where_the_config_expects_it() -> None:
    assert Path(__file__).resolve().parents[1] / "certs" / "rds-global-bundle.pem" == BUNDLE
    assert BUNDLE.is_file()


def test_staging_refuses_to_start_unless_the_default_bundle_is_real() -> None:
    """Fail closed: with the placeholder, the AWS settings are refused; with the real bundle,
    they are accepted. Either way the app never connects without a verifiable CA."""
    kwargs = {
        "app_env": "staging",
        "database_url": "",
        "demo_accounts_enabled": False,
        "fixed_now": None,
        "jwt_secret": "j" * 32,
        "photo_url_secret": "p" * 32,
        "db_host": "x.rds.internal",
        "db_name": "jobproof",
        "db_user": "jobproof_app",
        "db_password": "secret-value",
    }
    real = count_pem_certificates(BUNDLE.read_text(encoding="ascii", errors="replace")) > 0
    if real:
        assert "sslmode=verify-full" in Settings(**kwargs).database_url
    else:
        with pytest.raises(ValueError, match="no valid PEM certificate"):
            Settings(**kwargs)


def test_the_committed_bundle_is_the_real_aws_bundle() -> None:
    """XFAIL while the placeholder is committed (visible in the -ra summary), a hard check after."""
    content = BUNDLE.read_text(encoding="ascii", errors="replace")
    if count_pem_certificates(content) == 0:
        pytest.xfail(
            "backend/certs/rds-global-bundle.pem is still the placeholder: replace it with "
            "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem (certs/README.md)"
        )
    context = ssl.create_default_context(cafile=str(BUNDLE))
    assert context.cert_store_stats()["x509_ca"] >= 50
    assert "-----BEGIN PRIVATE KEY-----" not in content
