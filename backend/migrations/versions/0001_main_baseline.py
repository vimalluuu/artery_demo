"""Exact main-branch schema baseline. Existing verified main databases may stamp this revision."""
from alembic import op
import sqlalchemy as sa

revision = "0001_main"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table("patients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_code", sa.String(50), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_patients_id", "patients", ["id"])
    op.create_index("ix_patients_patient_code", "patients", ["patient_code"], unique=True)
    op.create_table("cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("case_code", sa.String(50), nullable=False),
        sa.Column("study_type", sa.String(100), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("image_path", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_cases_id", "cases", ["id"])
    op.create_index("ix_cases_patient_id", "cases", ["patient_id"])
    op.create_index("ix_cases_case_code", "cases", ["case_code"], unique=True)


def downgrade():
    raise RuntimeError("Forward-only migration: restore a reviewed backup to roll back")
