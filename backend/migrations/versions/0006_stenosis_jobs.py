"""Add durable stenosis lifecycle records; preserve all existing tables/data."""
import sqlalchemy as sa
from alembic import op

revision = "0006_stenosis_jobs"
down_revision = "0005_segmentation_results"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "stenosis_analysis_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("parent_segmentation_result_id", sa.String(36), sa.ForeignKey("segmentation_results.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("contract_version", sa.String(10), nullable=False),
        sa.Column("image_reference", sa.String(30), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("method_id", sa.String(128), nullable=False),
        sa.Column("method_version", sa.String(128), nullable=False),
        sa.Column("checkpoint_sha256", sa.String(64), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_code", sa.String(40), nullable=True),
        sa.Column("failure_reason", sa.String(250), nullable=True),
        sa.Column("claim_token_hash", sa.String(64), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_reference", sa.String(36), nullable=True),
        sa.UniqueConstraint("created_by", "case_id", "idempotency_key", name="uq_stenosis_job_idempotency"),
        sa.CheckConstraint("status IN ('queued','running','completed','failed')", name="ck_stenosis_job_status"),
        sa.CheckConstraint("contract_version = '1.0' AND image_reference = 'case-volume'", name="ck_stenosis_job_contract"),
        sa.CheckConstraint("length(source_sha256) = 64 AND length(request_fingerprint) = 64", name="ck_stenosis_job_hashes"),
        sa.CheckConstraint("status != 'completed' OR (result_reference IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NOT NULL)", name="ck_stenosis_job_result"),
        sa.CheckConstraint("status != 'running' OR (claim_token_hash IS NOT NULL AND started_at IS NOT NULL AND lease_expires_at IS NOT NULL)", name="ck_stenosis_job_claim"),
        sa.CheckConstraint("status != 'failed' OR (failure_code IS NOT NULL AND failure_reason IS NOT NULL AND failed_at IS NOT NULL)", name="ck_stenosis_job_failure"),
        sa.CheckConstraint("failure_code IS NULL OR failure_code IN ('source_changed','provider_changed','provider_error','lease_expired','dispatch_failed')", name="ck_stenosis_job_failure_code"),
        sa.CheckConstraint("(status = 'completed' OR (result_reference IS NULL AND completed_at IS NULL)) AND (status = 'failed' OR (failure_code IS NULL AND failure_reason IS NULL AND failed_at IS NULL)) AND (status = 'running' OR (claim_token_hash IS NULL AND lease_expires_at IS NULL)) AND (status != 'queued' OR started_at IS NULL)", name="ck_stenosis_job_fields"),
    )
    op.create_index("ix_stenosis_job_history", "stenosis_analysis_jobs", ["case_id", "created_at", "id"])
    op.create_index("ix_stenosis_job_status", "stenosis_analysis_jobs", ["status", "created_at", "id"])


def downgrade():
    # Deletes stenosis job history only. Existing cases/segmentations/files remain.
    op.drop_index("ix_stenosis_job_status", table_name="stenosis_analysis_jobs")
    op.drop_index("ix_stenosis_job_history", table_name="stenosis_analysis_jobs")
    op.drop_table("stenosis_analysis_jobs")
