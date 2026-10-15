
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base
from app.core.roles import Role


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('Clinician', 'Researcher', 'DataScientist', 'Admin')", name="ck_users_role"),
        CheckConstraint("token_version >= 0", name="ck_users_token_version"),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True,
    )

    full_name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    role: Mapped[str] = mapped_column(
        String(30),
        default=Role.CLINICIAN.value,
        nullable=False,
    )

    token_version: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)
    institution: Mapped[str] = mapped_column(String(200), default="", server_default="", nullable=False)
    department: Mapped[str] = mapped_column(String(200), default="", server_default="", nullable=False)

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
