"""Add case metadata fields: modality, region, scan_date, age_years, sex, notes.

All new columns are nullable so that existing cases created before this
migration remain valid without backfill.

Revision:    0003_case_metadata
Down rev:    0002_auth
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_case_meta"
down_revision = "0002_auth"
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# Allowed values (informational — enforced in the application layer via
# Pydantic, not as DB CHECK constraints so that SQLite test runs work
# identically to PostgreSQL production runs).
# ---------------------------------------------------------------------------
# modality: CT Angiography | MRA | CTA | DSA | Ultrasound | Other
# region:   Coronary | Carotid | Renal | Peripheral | Cerebral | Aorta | Other
# sex:      M | F | O   (Male / Female / Other-or-not-stated)
# age_years: 0–120


def upgrade():
    with op.batch_alter_table("cases") as batch:
        # Imaging modality (e.g. "CT Angiography", "MRA")
        batch.add_column(
            sa.Column("modality", sa.String(50), nullable=True, default=None)
        )
        # Anatomical region of interest
        batch.add_column(
            sa.Column("region", sa.String(50), nullable=True, default=None)
        )
        # Date the scan was acquired (not the case creation date)
        batch.add_column(
            sa.Column("scan_date", sa.Date(), nullable=True, default=None)
        )
        # De-identified age in whole years at time of scan
        batch.add_column(
            sa.Column("age_years", sa.SmallInteger(), nullable=True, default=None)
        )
        # De-identified biological sex: M / F / O (other / not stated)
        batch.add_column(
            sa.Column("sex", sa.String(1), nullable=True, default=None)
        )
        # Free-text clinical notes (de-identified)
        batch.add_column(
            sa.Column("notes", sa.Text(), nullable=True, default=None)
        )


def downgrade():
    raise RuntimeError(
        "Forward-only migration: restore a reviewed backup to roll back. "
        "To remove these columns manually, drop modality, region, scan_date, "
        "age_years, sex, notes from the 'cases' table after taking a backup."
    )
