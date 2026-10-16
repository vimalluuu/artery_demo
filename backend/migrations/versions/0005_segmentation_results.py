"""Add experimental segmentation provenance without altering existing case data."""
import sqlalchemy as sa
from alembic import op

revision = "0005_segmentation_results"
down_revision = "0004_volume_ingestion"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "segmentation_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_volume_path", sa.String(500), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_segmentation_results_case_id", "segmentation_results", ["case_id"])


def downgrade():
    # Destructive to segmentation history only; source cases/uploads are retained.
    # Output files are outside the database and require separate retention cleanup.
    op.drop_index("ix_segmentation_results_case_id", table_name="segmentation_results")
    op.drop_table("segmentation_results")
