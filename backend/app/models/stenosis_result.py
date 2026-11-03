"""Immutable result metadata and typed lesion payloads; no image bytes."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class StenosisAnalysisResult(Base):
    __tablename__ = "stenosis_analysis_results"
    __table_args__ = (
        UniqueConstraint("analysis_id", name="uq_stenosis_result_analysis"),
        CheckConstraint("schema_version = '1.0' AND status = 'completed'", name="ck_stenosis_result_state"),
        CheckConstraint("finding_count >= 0 AND finding_count <= 200", name="ck_stenosis_result_count"),
        CheckConstraint("length(source_sha256) = 64 AND length(geometry_fingerprint) = 64", name="ck_stenosis_result_hashes"),
        Index("ix_stenosis_result_case", "case_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("stenosis_analysis_jobs.id", ondelete="RESTRICT"))
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"))
    parent_segmentation_result_id: Mapped[str] = mapped_column(ForeignKey("segmentation_results.id", ondelete="RESTRICT"))
    schema_version: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20))
    source_sha256: Mapped[str] = mapped_column(String(64))
    geometry_fingerprint: Mapped[str] = mapped_column(String(64))
    provenance_json: Mapped[dict] = mapped_column(JSON)
    finding_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StenosisLesion(Base):
    __tablename__ = "stenosis_lesions"
    result_id: Mapped[str] = mapped_column(ForeignKey("stenosis_analysis_results.id", ondelete="RESTRICT"), primary_key=True)
    lesion_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Pydantic-validated LesionResult. Source/case/geometry are inherited through
    # result_id, avoiding contradictory copies on individual lesions.
    payload_json: Mapped[dict] = mapped_column(JSON)
