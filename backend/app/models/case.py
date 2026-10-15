
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    case_code: Mapped[str] = mapped_column(
        String(50), unique=True, index=True, nullable=False
    )

    study_type: Mapped[str] = mapped_column(
        String(100), default="Coronary Artery Analysis", nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(30), default="pending", nullable=False
    )

    image_path: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
