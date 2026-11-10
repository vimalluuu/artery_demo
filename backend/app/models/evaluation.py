"""Offline evaluation evidence; no execution or checkpoint-file management."""
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, ForeignKeyConstraint, Index, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database.session import Base


class EvaluationArtifact(Base):
    __tablename__ = "evaluation_artifacts"
    __table_args__ = (CheckConstraint("length(sha256) = 64", name="ck_evaluation_artifact_sha256"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int]
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvaluationModel(Base):
    __tablename__ = "evaluation_models"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    architecture: Mapped[str] = mapped_column(String(200))
    display_name: Mapped[str] = mapped_column(String(200))


class EvaluationModelRun(Base):
    __tablename__ = "evaluation_model_runs"
    __table_args__ = (
        UniqueConstraint("model_id", "training_run_id", name="uq_evaluation_training_identity"),
        UniqueConstraint("id", "model_id", "checkpoint_sha256", name="uq_evaluation_run_checkpoint"),
        CheckConstraint("length(checkpoint_sha256) = 64", name="ck_evaluation_run_sha256"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    model_id: Mapped[str] = mapped_column(ForeignKey("evaluation_models.id", ondelete="RESTRICT"))
    training_run_id: Mapped[str] = mapped_column(String(200))
    checkpoint_sha256: Mapped[str] = mapped_column(String(64))
    source_artifact_id: Mapped[str] = mapped_column(ForeignKey("evaluation_artifacts.id", ondelete="RESTRICT"))
    reported_training_steps: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Evaluation(Base):
    __tablename__ = "evaluations"
    __table_args__ = (
        UniqueConstraint("source_artifact_id", name="uq_evaluation_source_artifact"),
        ForeignKeyConstraint(["model_run_id", "model_id", "checkpoint_sha256"],
                             ["evaluation_model_runs.id", "evaluation_model_runs.model_id", "evaluation_model_runs.checkpoint_sha256"], ondelete="RESTRICT"),
        CheckConstraint("threshold >= 0 AND threshold <= 1", name="ck_evaluation_threshold"),
        Index("ix_evaluation_model_history", "model_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_artifact_id: Mapped[str] = mapped_column(ForeignKey("evaluation_artifacts.id", ondelete="RESTRICT"))
    model_id: Mapped[str] = mapped_column(ForeignKey("evaluation_models.id", ondelete="RESTRICT"))
    model_run_id: Mapped[str] = mapped_column(String(36))
    checkpoint_sha256: Mapped[str] = mapped_column(String(64))
    threshold: Mapped[float] = mapped_column(Float)
    metadata_json: Mapped[dict] = mapped_column(JSON)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    history_sha256: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvaluationCase(Base):
    __tablename__ = "evaluation_cases"
    evaluation_id: Mapped[str] = mapped_column(ForeignKey("evaluations.id", ondelete="CASCADE"), primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"), primary_key=True)
    payload_json: Mapped[dict] = mapped_column(JSON)
