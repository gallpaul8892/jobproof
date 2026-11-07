"""Sign-in: credential check with uniform behaviour for every failure."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.security import verify_password


def normalise_email(email: str) -> str:
    return email.strip().lower()


def authenticate(session: Session, email: str, password: str) -> User | None:
    """The user for these credentials, or None.

    Unknown email, wrong password, no password set and inactive account are indistinguishable to
    the caller, and each costs exactly one argon2id verification.
    """
    user = session.scalar(select(User).where(User.email == normalise_email(email)))
    password_ok = verify_password(user.password_hash if user else None, password)
    if user is None or not password_ok or not user.is_active:
        return None
    return user
