"""Immutable explanation records. Downgrade deletes explanation history only."""
from alembic import op
import sqlalchemy as sa

revision = "0008_stenosis_explanations"
down_revision = "0007_stenosis_results"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("stenosis_explanation_artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("result_id", sa.String(36), sa.ForeignKey("stenosis_analysis_results.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("analysis_id", sa.String(36), sa.ForeignKey("stenosis_analysis_jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("lesion_id", sa.String(36), nullable=True),
        sa.Column("artifact_id", sa.String(36), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["result_id", "lesion_id"], ["stenosis_lesions.result_id", "stenosis_lesions.lesion_id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("artifact_id", name="uq_stenosis_explanation_artifact"))
    op.create_index("ix_stenosis_explanation_result", "stenosis_explanation_artifacts", ["result_id", "id"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""CREATE OR REPLACE FUNCTION stenosis_explanation_guard() RETURNS trigger AS $$
        BEGIN
            IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Explanations are immutable' USING ERRCODE='23514'; END IF;
            IF NOT EXISTS (SELECT 1 FROM stenosis_analysis_results r JOIN stenosis_analysis_jobs j ON j.id=r.analysis_id
                WHERE r.id=NEW.result_id AND r.analysis_id=NEW.analysis_id AND j.status='running') THEN
                RAISE EXCEPTION 'Explanation requires a matching running result transaction' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END; $$ LANGUAGE plpgsql""")
        op.execute("CREATE TRIGGER stenosis_explanation_guard BEFORE INSERT OR UPDATE OR DELETE ON stenosis_explanation_artifacts FOR EACH ROW EXECUTE FUNCTION stenosis_explanation_guard()")
    else:
        for action in ("UPDATE", "DELETE"):
            op.execute(f"CREATE TRIGGER stenosis_explanation_{action.lower()} BEFORE {action} ON stenosis_explanation_artifacts BEGIN SELECT RAISE(ABORT, 'Explanations are immutable'); END")
        op.execute("""CREATE TRIGGER stenosis_explanation_insert BEFORE INSERT ON stenosis_explanation_artifacts
            WHEN NOT EXISTS (SELECT 1 FROM stenosis_analysis_results r JOIN stenosis_analysis_jobs j ON j.id=r.analysis_id
                WHERE r.id=NEW.result_id AND r.analysis_id=NEW.analysis_id AND j.status='running')
            BEGIN SELECT RAISE(ABORT, 'Explanation requires a matching running result transaction'); END""")


def downgrade():
    # Drops explanation metadata/history, not source files, results, lesions or jobs.
    op.drop_index("ix_stenosis_explanation_result", table_name="stenosis_explanation_artifacts")
    op.drop_table("stenosis_explanation_artifacts")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION stenosis_explanation_guard()")
