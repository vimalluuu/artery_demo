"""Immutable attribution metadata; source/grid identity inherited from result."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Index, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class StenosisExplanationArtifact(Base):
    __tablename__ = "stenosis_explanation_artifacts"
    __table_args__ = (
        ForeignKeyConstraint(["result_id", "lesion_id"], ["stenosis_lesions.result_id", "stenosis_lesions.lesion_id"], ondelete="RESTRICT"),
        UniqueConstraint("artifact_id", name="uq_stenosis_explanation_artifact"),
        Index("ix_stenosis_explanation_result", "result_id", "id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    result_id: Mapped[str] = mapped_column(ForeignKey("stenosis_analysis_results.id", ondelete="RESTRICT"))
    analysis_id: Mapped[str] = mapped_column(ForeignKey("stenosis_analysis_jobs.id", ondelete="RESTRICT"))
    lesion_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    artifact_id: Mapped[str] = mapped_column(String(36))
    # ExplanationDetails only. Source hash, affine, grid hash and shape identity
    # are verified/inherited through result_id when constructing API metadata.
    metadata_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
