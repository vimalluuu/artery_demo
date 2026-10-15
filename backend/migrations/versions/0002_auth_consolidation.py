"""Normalize roles and add revocation, profile fields and audit records without losing data."""
from alembic import context, op
import sqlalchemy as sa

revision = "0002_auth"
down_revision = "0001_main"
branch_labels = None
depends_on = None

ROLE_MAP = {
    "doctor": "Clinician", "admin": "Admin", "researcher": "Researcher",
    "Radiologist": "Clinician", "Medical Researcher": "Researcher",
    "Data Scientist": "DataScientist", "Administrator": "Admin",
}


def upgrade():
    if not context.is_offline_mode():
        roles = set(op.get_bind().execute(sa.text("SELECT DISTINCT role FROM users")).scalars())
        known = set(ROLE_MAP) | {"Clinician", "Researcher", "DataScientist", "Admin"}
        if roles - known:
            raise RuntimeError("Unknown existing roles: review and map them before migration")
    for old, new in ROLE_MAP.items():
        users = sa.table("users", sa.column("role", sa.String()))
        op.execute(users.update().where(users.c.role == old).values(role=new))
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("institution", sa.String(200), nullable=False, server_default=""))
        batch.add_column(sa.Column("department", sa.String(200), nullable=False, server_default=""))
        batch.create_check_constraint("ck_users_role", "role IN ('Clinician', 'Researcher', 'DataScientist', 'Admin')")
        batch.create_check_constraint("ck_users_token_version", "token_version >= 0")
    op.create_table("audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_audit_events_actor_id", "audit_events", ["actor_id"])


def downgrade():
    raise RuntimeError("Forward-only migration: restore a reviewed backup to roll back")
