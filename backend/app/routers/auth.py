from json import JSONDecodeError
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models import User
from app.schemas.auth import LoginRequest, PasswordChange, ProfileUpdate, TokenResponse, UserRegister, UserResponse
from app.services.audit import record_event

router = APIRouter(prefix="/auth", tags=["Authentication"])
Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
DUMMY_HASH = hash_password("not-a-real-user-password")


def token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role, user.token_version),
        user=UserResponse.model_validate(user),
    )


@router.post("/register", response_model=UserResponse, status_code=201)
def register_user(user_data: UserRegister, db: Database):
    email = str(user_data.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Email is already registered")
    user = User(**user_data.model_dump(exclude={"password", "email"}),
                email=email, password_hash=hash_password(user_data.password), is_active=True)
    db.add(user)
    try:
        db.flush()
        record_event(db, "auth.register", user.id)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email is already registered") from None
    return user


async def login_payload(request: Request) -> LoginRequest:
    media_type = request.headers.get("content-type", "").split(";")[0].lower()
    try:
        if media_type == "application/json":
            data = await request.json()
        elif media_type in {"application/x-www-form-urlencoded", "multipart/form-data"}:
            form = await request.form()
            data = {"email": form.get("username"), "password": form.get("password")}
        else:
            raise HTTPException(415, "Use JSON or form-encoded credentials")
        return LoginRequest.model_validate(data)
    except (JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(422, "Invalid request body") from None
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from None


@router.post("/login", response_model=TokenResponse, openapi_extra={
    "requestBody": {"required": True, "content": {
        "application/json": {"schema": LoginRequest.model_json_schema()},
        "application/x-www-form-urlencoded": {"schema": {
            "type": "object", "required": ["username", "password"],
            "properties": {"username": {"type": "string"}, "password": {"type": "string", "format": "password"}},
        }},
    }},
})
def login_user(credentials: Annotated[LoginRequest, Depends(login_payload)], db: Database):
    user = db.scalar(select(User).where(User.email == str(credentials.email).lower()))
    valid = verify_password(credentials.password, user.password_hash if user else DUMMY_HASH)
    if not valid or user is None or not user.is_active:
        record_event(db, "auth.login_failed")
        db.commit()
        raise HTTPException(401, "Invalid email or password", headers={"WWW-Authenticate": "Bearer"})
    record_event(db, "auth.login", user.id)
    db.commit()
    return token_response(user)


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserResponse)
def update_profile(profile: ProfileUpdate, user: CurrentUser, db: Database):
    for key, value in profile.model_dump().items():
        setattr(user, key, value)
    record_event(db, "auth.profile_updated", user.id)
    db.commit()
    db.refresh(user)
    return user


def revoke_sessions(db: Session, user: User) -> None:
    db.execute(update(User).where(User.id == user.id).values(token_version=User.token_version + 1))


@router.post("/logout", status_code=204)
def logout(user: CurrentUser, db: Database):
    revoke_sessions(db, user)
    record_event(db, "auth.logout_all", user.id)
    db.commit()
    return Response(status_code=204)


@router.post("/password", response_model=TokenResponse)
def change_password(data: PasswordChange, user: CurrentUser, db: Database):
    if not verify_password(data.current_password, user.password_hash):
        record_event(db, "auth.password_change_failed", user.id)
        db.commit()
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    revoke_sessions(db, user)
    record_event(db, "auth.password_changed", user.id)
    db.commit()
    db.refresh(user)
    return token_response(user)
