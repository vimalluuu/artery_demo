from datetime import date, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Date, DateTime, ForeignKey, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base

if TYPE_CHECKING:
    from app.models.volume_metadata import VolumeMetadata


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

    # ── Metadata fields added in migration 0003_case_meta ─────────────────────
    # All nullable: existing cases created before this migration are unaffected.

    # Imaging modality: "CT Angiography" | "MRA" | "CTA" | "DSA" | "Ultrasound" | "Other"
    modality: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Anatomical region: "Coronary" | "Carotid" | "Renal" | "Peripheral" | "Cerebral" | "Aorta" | "Other"
    region: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Date the scan was acquired (not the case-record creation date)
    scan_date: Mapped[date | None] = mapped_column(Date(), nullable=True)

    # De-identified age at time of scan (whole years, 0–120)
    age_years: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)

    # De-identified biological sex: "M" | "F" | "O" (other / not stated)
    sex: Mapped[str | None] = mapped_column(String(1), nullable=True)

    # Free-text clinical notes (de-identified)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    # ── Volume field added in migration 0004_volume_ingestion ─────────────────
    # Relative path from UPLOAD_DIR to the stored NIfTI volume file.
    # Null for cases without an uploaded volume.
    volume_path: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )

    # 1-to-1 relationship with VolumeMetadata
    volume_metadata: Mapped[Optional["VolumeMetadata"]] = relationship(
        "VolumeMetadata",
        back_populates="case",
        cascade="all, delete-orphan",
        uselist=False,
    )
