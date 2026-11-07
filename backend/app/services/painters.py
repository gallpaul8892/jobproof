"""Painter options for the report filter."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.models.enums import UserRole
from app.schemas.common import PersonRef


def list_painters(session: Session) -> list[PersonRef]:
    rows = session.execute(
        select(User.id, User.full_name)
        .where(User.role == UserRole.painter)
        .order_by(User.full_name, User.id)
    )
    return [PersonRef(id=row.id, name=row.full_name) for row in rows]
