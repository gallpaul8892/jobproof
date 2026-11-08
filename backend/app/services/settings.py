"""The one accessor for the company settings record (decision D1).

No caching: one primary-key read per request is cheap, and a cache would break "a change takes
effect on the next page load" across several ECS tasks.
"""

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.branding.contrast import REQUIRED_RATIO, meets_aa, report_ratio, weakest_contrast
from app.branding.defaults import DEFAULT_THEME
from app.errors import ProblemError
from app.models import CompanySettings, User
from app.schemas import settings as schemas
from app.schemas.common import PersonRef

SETTINGS_ID = 1
_THEME_FIELDS = ("primary", "accent")
_BACKGROUND_NAMES = {"white": "white", "surface": "the surface colour"}

Change = tuple[str, Any, Any]  # (field, old value, new value), for the audit trail (T-002f)


def get_company_settings(session: Session) -> CompanySettings:
    row = session.get(CompanySettings, SETTINGS_ID)
    if row is None:
        # A deployment without migration 0002 is broken, not empty.
        raise RuntimeError("company_settings row is missing: run `alembic upgrade head`")
    return row


def _theme(row: CompanySettings) -> schemas.Theme:
    return schemas.Theme(
        primary=row.theme_primary,
        accent=row.theme_accent,
        background=row.theme_background,
        surface=row.theme_surface,
        text=row.theme_text,
    )


def get_branding(session: Session) -> schemas.Branding:
    row = get_company_settings(session)
    return schemas.Branding(company_name=row.company_name, theme=_theme(row))


def _admin_settings(row: CompanySettings) -> schemas.AdminSettings:
    updated_by = (
        PersonRef(id=row.updated_by_id, name=row.updated_by_name or "")
        if row.updated_by_id is not None
        else None
    )
    return schemas.AdminSettings(
        company_name=row.company_name,
        theme=_theme(row),
        updated_at=row.updated_at,
        updated_by=updated_by,
    )


def get_admin_settings(session: Session) -> schemas.AdminSettings:
    return _admin_settings(get_company_settings(session))


def _check_contrast(theme: schemas.ThemeUpdate) -> None:
    failures: list[dict[str, Any]] = []
    for field in _THEME_FIELDS:
        # Surface is fixed (not editable), so the default is the stored value.
        ratio, background = weakest_contrast(getattr(theme, field), DEFAULT_THEME.surface)
        if not meets_aa(ratio):
            shown = report_ratio(ratio)
            failures.append(
                {
                    "loc": ["body", "theme", field],
                    "message": (
                        f"Contrast {shown:.2f}:1 against {_BACKGROUND_NAMES[background]} "
                        f"is below the required {REQUIRED_RATIO}:1."
                    ),
                    "measured_ratio": shown,
                    "required_ratio": REQUIRED_RATIO,
                }
            )
    if failures:
        raise ProblemError(
            422,
            "contrast_too_low",
            f"Colours must have at least {REQUIRED_RATIO}:1 contrast against both white and "
            "the surface colour.",
            errors=failures,
        )


def update_settings(
    session: Session, user: User, update: schemas.AdminSettingsUpdate, now: dt.datetime
) -> tuple[schemas.AdminSettings, list[Change]]:
    """Apply a partial update atomically. Returns the settings and the fields that changed.

    A request that changes nothing writes nothing (no `updated_*`, no change list).
    """
    if update.theme is not None:
        _check_contrast(update.theme)  # format was already validated by Pydantic
    row = session.scalar(
        select(CompanySettings).where(CompanySettings.id == SETTINGS_ID).with_for_update()
    )
    if row is None:
        raise RuntimeError("company_settings row is missing: run `alembic upgrade head`")

    wanted: dict[str, Any] = {}
    if update.company_name is not None:
        wanted["company_name"] = update.company_name
    if update.theme is not None:
        wanted["theme_primary"] = update.theme.primary
        wanted["theme_accent"] = update.theme.accent
    changes: list[Change] = [
        (field, getattr(row, field), value)
        for field, value in wanted.items()
        if getattr(row, field) != value
    ]
    if not changes:
        current = _admin_settings(row)
        session.rollback()  # release the row lock
        return current, []
    for field, _, value in changes:
        setattr(row, field, value)
    row.updated_at = now
    row.updated_by_id = user.id
    row.updated_by_name = user.full_name
    session.commit()
    return _admin_settings(row), changes
