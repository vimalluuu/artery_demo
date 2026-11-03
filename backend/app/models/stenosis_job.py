"""Durable lifecycle/provenance only; medical results have a separate future store."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class StenosisAnalysisJob(Base):
    __tablename__ = "stenosis_analysis_jobs"
    __table_args__ = (
        UniqueConstraint("created_by", "case_id", "idempotency_key", name="uq_stenosis_job_idempotency"),
        CheckConstraint("status IN ('queued','running','completed','failed')", name="ck_stenosis_job_status"),
        CheckConstraint("contract_version = '1.0' AND image_reference = 'case-volume'", name="ck_stenosis_job_contract"),
        CheckConstraint("length(source_sha256) = 64 AND length(request_fingerprint) = 64", name="ck_stenosis_job_hashes"),
        CheckConstraint("status != 'completed' OR (result_reference IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NOT NULL)", name="ck_stenosis_job_result"),
        CheckConstraint("status != 'running' OR (claim_token_hash IS NOT NULL AND started_at IS NOT NULL AND lease_expires_at IS NOT NULL)", name="ck_stenosis_job_claim"),
        CheckConstraint("status != 'failed' OR (failure_code IS NOT NULL AND failure_reason IS NOT NULL AND failed_at IS NOT NULL)", name="ck_stenosis_job_failure"),
        CheckConstraint("failure_code IS NULL OR failure_code IN ('source_changed','provider_changed','provider_error','lease_expired','dispatch_failed')", name="ck_stenosis_job_failure_code"),
        CheckConstraint("(status = 'completed' OR (result_reference IS NULL AND completed_at IS NULL)) AND (status = 'failed' OR (failure_code IS NULL AND failure_reason IS NULL AND failed_at IS NULL)) AND (status = 'running' OR (claim_token_hash IS NULL AND lease_expires_at IS NULL)) AND (status != 'queued' OR started_at IS NULL)", name="ck_stenosis_job_fields"),
        Index("ix_stenosis_job_history", "case_id", "created_at", "id"),
        Index("ix_stenosis_job_status", "status", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"))
    parent_segmentation_result_id: Mapped[str] = mapped_column(ForeignKey("segmentation_results.id", ondelete="RESTRICT"))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    contract_version: Mapped[str] = mapped_column(String(10))
    image_reference: Mapped[str] = mapped_column(String(30))
    source_sha256: Mapped[str] = mapped_column(String(64))
    method_id: Mapped[str] = mapped_column(String(128))
    method_version: Mapped[str] = mapped_column(String(128))
    checkpoint_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(250), nullable=True)
    # Fencing token is never returned by an HTTP response.
    claim_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_reference: Mapped[str | None] = mapped_column(String(36), nullable=True)
