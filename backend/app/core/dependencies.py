from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.roles import Role
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import User
from app.services.audit import record_event

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)],
                     db: Annotated[Session, Depends(get_db)]) -> User:
    error = HTTPException(401, "Invalid or expired access token", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_access_token(token)
        subject = payload["sub"]
        # Bound parsing to PostgreSQL INTEGER, including malicious signed claims.
        if not isinstance(subject, str) or not subject.isascii() or not subject.isdigit() or len(subject) > 10:
            raise InvalidTokenError()
        user_id = int(subject)
        if not 0 < user_id <= 2147483647 or type(payload["ver"]) is not int:
            raise InvalidTokenError()
    except (InvalidTokenError, ValueError, TypeError):
        record_event(db, "auth.token_rejected")
        db.commit()
        raise error from None
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.token_version != payload["ver"] or user.role not in {role.value for role in Role}:
        record_event(db, "auth.token_rejected")
        db.commit()
        raise error
    # The database is authoritative; never authorize using the role claim.
    return user


def require_roles(*allowed_roles: str) -> Callable:
    def role_checker(current_user: Annotated[User, Depends(get_current_user)],
                     db: Annotated[Session, Depends(get_db)]) -> User:
        if current_user.role not in allowed_roles:
            record_event(db, "authorization.denied", current_user.id)
            db.commit()
            raise HTTPException(403, "You do not have permission to perform this action")
        return current_user
    return role_checker
