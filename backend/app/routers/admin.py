from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.core.roles import Role
from app.database.session import get_db
from app.models import AuditEvent, User
from app.routers.auth import revoke_sessions
from app.schemas.auth import UserAccessUpdate, UserResponse
from app.services.audit import record_event

router = APIRouter(prefix="/admin", tags=["Administration"])
Admin = Annotated[User, Depends(require_roles(Role.ADMIN))]
Database = Annotated[Session, Depends(get_db)]


@router.get("/users", response_model=list[UserResponse])
def list_users(admin: Admin, db: Database, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    record_event(db, "admin.users_read", admin.id)
    db.commit()
    return db.scalars(select(User).order_by(User.id).limit(limit).offset(offset)).all()


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_access(user_id: int, data: UserAccessUpdate, admin: Admin, db: Database):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    if user.id == admin.id and (data.role != Role.ADMIN or not data.is_active):
        raise HTTPException(409, "Administrators cannot remove their own access")
    user.role = data.role.value
    user.is_active = data.is_active
    revoke_sessions(db, user)
    record_event(db, "admin.access_updated", admin.id, user.id)
    db.commit()
    db.refresh(user)
    return user


class AuditResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    actor_id: int | None
    action: str
    resource_id: int | None
    created_at: datetime


@router.get("/audit", response_model=list[AuditResponse])
def audit_events(admin: Admin, db: Database, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    record_event(db, "admin.audit_read", admin.id)
    db.commit()
    return db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit).offset(offset)).all()
