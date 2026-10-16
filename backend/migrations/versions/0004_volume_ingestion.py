"""0004 — Volume ingestion: volume_path column + volume_metadata table

Revision:      0004_volume_ingestion
Down revision: 0003_case_meta
Created:       2026-10-16

Changes:
  1. Add nullable cases.volume_path (String 500)  — relative path to NIfTI file.
  2. Create table volume_metadata with full spatial header metadata.

Forward-only.  downgrade() raises RuntimeError per project convention.

Safe for existing data:
  - cases.volume_path is nullable → existing rows are unaffected.
  - volume_metadata is a new table; no existing data is touched.
  - No columns dropped, no constraints removed.

To apply (development only, against an approved dev DB):
    python -m alembic upgrade head

To roll back if needed (manual DDL only — no automated downgrade):
    DROP TABLE volume_metadata;
    ALTER TABLE cases DROP COLUMN volume_path;
    DELETE FROM alembic_version WHERE version_num = '0004_volume_ingestion';
"""
import sqlalchemy as sa
from alembic import op

# Alembic revision identifiers
revision:      str = "0004_volume_ingestion"
down_revision: str = "0003_case_meta"
branch_labels       = None
depends_on          = None


def upgrade() -> None:
    # ── 1. Add volume_path to cases ───────────────────────────────────────────
    with op.batch_alter_table("cases", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "volume_path",
                sa.String(length=500),
                nullable=True,
            )
        )

    # ── 2. Create volume_metadata table ───────────────────────────────────────
    op.create_table(
        "volume_metadata",
        sa.Column("id",         sa.Integer(),    nullable=False),
        sa.Column("case_id",    sa.Integer(),    nullable=False),

        # Shape
        sa.Column("dim_x",      sa.Integer(),    nullable=False),
        sa.Column("dim_y",      sa.Integer(),    nullable=False),
        sa.Column("dim_z",      sa.Integer(),    nullable=False),
        sa.Column("dim_t",      sa.Integer(),    nullable=True),

        # Voxel spacing (mm)
        sa.Column("voxel_spacing_x", sa.Float(), nullable=False),
        sa.Column("voxel_spacing_y", sa.Float(), nullable=False),
        sa.Column("voxel_spacing_z", sa.Float(), nullable=False),

        # 4×4 affine matrix (row-major, 16 columns)
        sa.Column("aff_00", sa.Float(), nullable=False),
        sa.Column("aff_01", sa.Float(), nullable=False),
        sa.Column("aff_02", sa.Float(), nullable=False),
        sa.Column("aff_03", sa.Float(), nullable=False),
        sa.Column("aff_10", sa.Float(), nullable=False),
        sa.Column("aff_11", sa.Float(), nullable=False),
        sa.Column("aff_12", sa.Float(), nullable=False),
        sa.Column("aff_13", sa.Float(), nullable=False),
        sa.Column("aff_20", sa.Float(), nullable=False),
        sa.Column("aff_21", sa.Float(), nullable=False),
        sa.Column("aff_22", sa.Float(), nullable=False),
        sa.Column("aff_23", sa.Float(), nullable=False),
        sa.Column("aff_30", sa.Float(), nullable=False),
        sa.Column("aff_31", sa.Float(), nullable=False),
        sa.Column("aff_32", sa.Float(), nullable=False),
        sa.Column("aff_33", sa.Float(), nullable=False),

        # Acquisition metadata
        sa.Column("voxel_dtype",     sa.String(length=20), nullable=False),
        sa.Column("nifti_version",   sa.SmallInteger(),    nullable=False),
        sa.Column("qform_code",      sa.SmallInteger(),    nullable=False, server_default="0"),
        sa.Column("sform_code",      sa.SmallInteger(),    nullable=False, server_default="0"),
        sa.Column("xyzt_units",      sa.SmallInteger(),    nullable=False, server_default="0"),
        sa.Column("file_size_bytes", sa.Integer(),         nullable=False),

        # Audit
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("uploader_id", sa.Integer(), nullable=True),

        # Constraints
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["case_id"],
            ["cases.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["uploader_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
    )
    # One volume per case — enforced via unique index (matches ORM index=True pattern)
    op.create_index(
        "ix_volume_metadata_case_id",
        "volume_metadata",
        ["case_id"],
        unique=True,
    )


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade from 0004_volume_ingestion is intentionally disabled "
        "(forward-only migration policy). To roll back manually:\n"
        "  1. DROP TABLE volume_metadata;\n"
        "  2. ALTER TABLE cases DROP COLUMN volume_path;\n"
        "  3. DELETE FROM alembic_version WHERE version_num = '0004_volume_ingestion';"
    )
