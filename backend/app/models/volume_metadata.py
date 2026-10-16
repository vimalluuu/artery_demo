"""
VolumeMetadata SQLAlchemy model.

Stores spatial and acquisition metadata extracted from an uploaded NIfTI
volume.  One row per uploaded volume, foreign-keyed to the case.

Column choices:
  - Integer axes stored as separate columns (not arrays) for portability.
  - Affine stored as 16 individual Float columns (4×4 row-major) rather than
    a JSON blob, so that values are individually queryable and indexed if needed.
  - No PHI stored; no filenames. The volume filename is recorded only in
    cases.volume_path as a relative path.
"""
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base

if TYPE_CHECKING:
    from app.models.case import Case


class VolumeMetadata(Base):
    __tablename__ = "volume_metadata"

    id: Mapped[int] = mapped_column(primary_key=True)

    # FK to cases — cascade delete if the case is removed
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,
    )

    # ── Volume shape (spatial axes only; t-axis recorded separately) ──────────
    dim_x: Mapped[int] = mapped_column(Integer, nullable=False)
    dim_y: Mapped[int] = mapped_column(Integer, nullable=False)
    dim_z: Mapped[int] = mapped_column(Integer, nullable=False)
    dim_t: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 4D only

    # ── Voxel spacing (mm) ────────────────────────────────────────────────────
    voxel_spacing_x: Mapped[float] = mapped_column(Float, nullable=False)
    voxel_spacing_y: Mapped[float] = mapped_column(Float, nullable=False)
    voxel_spacing_z: Mapped[float] = mapped_column(Float, nullable=False)

    # ── Affine matrix (4×4, row-major) ────────────────────────────────────────
    aff_00: Mapped[float] = mapped_column(Float, nullable=False)
    aff_01: Mapped[float] = mapped_column(Float, nullable=False)
    aff_02: Mapped[float] = mapped_column(Float, nullable=False)
    aff_03: Mapped[float] = mapped_column(Float, nullable=False)
    aff_10: Mapped[float] = mapped_column(Float, nullable=False)
    aff_11: Mapped[float] = mapped_column(Float, nullable=False)
    aff_12: Mapped[float] = mapped_column(Float, nullable=False)
    aff_13: Mapped[float] = mapped_column(Float, nullable=False)
    aff_20: Mapped[float] = mapped_column(Float, nullable=False)
    aff_21: Mapped[float] = mapped_column(Float, nullable=False)
    aff_22: Mapped[float] = mapped_column(Float, nullable=False)
    aff_23: Mapped[float] = mapped_column(Float, nullable=False)
    aff_30: Mapped[float] = mapped_column(Float, nullable=False)
    aff_31: Mapped[float] = mapped_column(Float, nullable=False)
    aff_32: Mapped[float] = mapped_column(Float, nullable=False)
    aff_33: Mapped[float] = mapped_column(Float, nullable=False)

    # ── Acquisition metadata ──────────────────────────────────────────────────
    voxel_dtype:   Mapped[str] = mapped_column(String(20), nullable=False)
    nifti_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    qform_code:    Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    sform_code:    Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    xyzt_units:    Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    # ── Audit ─────────────────────────────────────────────────────────────────
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    uploader_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationship to parent Case
    case: Mapped["Case"] = relationship(
        "Case",
        back_populates="volume_metadata",
    )
