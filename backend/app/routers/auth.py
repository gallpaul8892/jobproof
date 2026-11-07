"""Sign-in, current user and demo credentials."""

import logging

from fastapi import APIRouter

from app.clock import now
from app.deps import CurrentUser, SessionDep, SettingsDep
from app.errors import ProblemError
from app.schemas.auth import DemoAccount, LoginRequest, LoginResponse
from app.schemas.common import User
from app.security import create_access_token
from app.seed.catalogue import DEMO_ACCOUNTS
from app.services.auth import authenticate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth")

_BAD_CREDENTIALS = "Email or password is incorrect."


def _user_schema(user: object) -> User:
    return User.model_validate(user, from_attributes=True)


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, session: SessionDep, settings: SettingsDep) -> LoginResponse:
    user = authenticate(session, body.email, body.password)
    if user is None:
        # Nothing about the attempt (email, password) is logged.
        logger.info("login failed")
        raise ProblemError(401, "invalid_credentials", _BAD_CREDENTIALS)
    token = create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        secret=settings.jwt_secret,
        ttl_seconds=settings.jwt_ttl_seconds,
        now=now(),
    )
    logger.info("login succeeded", extra={"user_id": str(user.id)})
    return LoginResponse(
        access_token=token, expires_in=settings.jwt_ttl_seconds, user=_user_schema(user)
    )


@router.get("/me", response_model=User)
def get_me(user: CurrentUser) -> User:
    return _user_schema(user)


@router.get("/demo-accounts", response_model=list[DemoAccount])
def list_demo_accounts(settings: SettingsDep) -> list[DemoAccount]:
    if not settings.demo_accounts_enabled:
        raise ProblemError(404, "not_found")
    return [DemoAccount.model_validate(account) for account in DEMO_ACCOUNTS]
