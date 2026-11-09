"""Stored offline evaluation artifacts, registry and case results.

Downgrade deletes imported evaluation/registry history, not source files or cases.
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_evaluations"
down_revision = "0008_stenosis_explanations"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("evaluation_artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(sha256) = 64", name="ck_evaluation_artifact_sha256"))
    op.create_table("evaluation_models",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("architecture", sa.String(200), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False))
    op.create_table("evaluation_model_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("model_id", sa.String(100), sa.ForeignKey("evaluation_models.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("training_run_id", sa.String(200), nullable=False),
        sa.Column("checkpoint_sha256", sa.String(64), nullable=False),
        sa.Column("source_artifact_id", sa.String(36), sa.ForeignKey("evaluation_artifacts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reported_training_steps", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("model_id", "training_run_id", name="uq_evaluation_training_identity"),
        sa.UniqueConstraint("id", "model_id", "checkpoint_sha256", name="uq_evaluation_run_checkpoint"),
        sa.CheckConstraint("length(checkpoint_sha256) = 64", name="ck_evaluation_run_sha256"))
    op.create_table("evaluations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_artifact_id", sa.String(36), sa.ForeignKey("evaluation_artifacts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("model_id", sa.String(100), sa.ForeignKey("evaluation_models.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("model_run_id", sa.String(36), nullable=False),
        sa.Column("checkpoint_sha256", sa.String(64), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("history_sha256", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("source_artifact_id", name="uq_evaluation_source_artifact"),
        sa.ForeignKeyConstraint(["model_run_id", "model_id", "checkpoint_sha256"],
                               ["evaluation_model_runs.id", "evaluation_model_runs.model_id", "evaluation_model_runs.checkpoint_sha256"], ondelete="RESTRICT"),
        sa.CheckConstraint("threshold >= 0 AND threshold <= 1", name="ck_evaluation_threshold"))
    op.create_index("ix_evaluation_model_history", "evaluations", ["model_id", "created_at", "id"])
    op.create_table("evaluation_cases",
        sa.Column("evaluation_id", sa.String(36), sa.ForeignKey("evaluations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("cases.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("payload_json", sa.JSON(), nullable=False))


def downgrade():
    op.drop_table("evaluation_cases")
    op.drop_index("ix_evaluation_model_history", table_name="evaluations")
    op.drop_table("evaluations")
    op.drop_table("evaluation_model_runs")
    op.drop_table("evaluation_models")
    op.drop_table("evaluation_artifacts")
