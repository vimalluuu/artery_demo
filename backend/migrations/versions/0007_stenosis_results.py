"""Immutable lesion results. Downgrade deletes only the new result/lesion data."""
import sqlalchemy as sa
from alembic import op

revision = "0007_stenosis_results"
down_revision = "0006_stenosis_jobs"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("stenosis_analysis_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("analysis_id", sa.String(36), sa.ForeignKey("stenosis_analysis_jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("parent_segmentation_result_id", sa.String(36), sa.ForeignKey("segmentation_results.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("schema_version", sa.String(10), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("geometry_fingerprint", sa.String(64), nullable=False),
        sa.Column("provenance_json", sa.JSON(), nullable=False),
        sa.Column("finding_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("analysis_id", name="uq_stenosis_result_analysis"),
        sa.CheckConstraint("schema_version = '1.0' AND status = 'completed'", name="ck_stenosis_result_state"),
        sa.CheckConstraint("finding_count >= 0 AND finding_count <= 200", name="ck_stenosis_result_count"),
        sa.CheckConstraint("length(source_sha256) = 64 AND length(geometry_fingerprint) = 64", name="ck_stenosis_result_hashes"))
    op.create_index("ix_stenosis_result_case", "stenosis_analysis_results", ["case_id", "created_at"])
    op.create_table("stenosis_lesions",
        sa.Column("result_id", sa.String(36), sa.ForeignKey("stenosis_analysis_results.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("lesion_id", sa.String(36), primary_key=True),
        sa.Column("payload_json", sa.JSON(), nullable=False))
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""CREATE OR REPLACE FUNCTION stenosis_result_immutable() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'Stenosis results are immutable' USING ERRCODE='23514'; END;
            $$ LANGUAGE plpgsql""")
        for table in ("stenosis_analysis_results", "stenosis_lesions"):
            op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION stenosis_result_immutable()")
        op.execute("""CREATE OR REPLACE FUNCTION stenosis_result_insert_guard() RETURNS trigger AS $$
            BEGIN
            IF TG_TABLE_NAME = 'stenosis_analysis_results' THEN
                IF NOT EXISTS (SELECT 1 FROM stenosis_analysis_jobs j WHERE j.id=NEW.analysis_id
                    AND j.status='running' AND j.case_id=NEW.case_id
                    AND j.parent_segmentation_result_id=NEW.parent_segmentation_result_id
                    AND j.source_sha256=NEW.source_sha256) THEN
                    RAISE EXCEPTION 'Result requires a matching running job' USING ERRCODE='23514';
                END IF;
            ELSE
                IF NOT EXISTS (SELECT 1 FROM stenosis_analysis_results r JOIN stenosis_analysis_jobs j
                    ON j.id=r.analysis_id WHERE r.id=NEW.result_id AND j.status='running') THEN
                    RAISE EXCEPTION 'Lesion requires a running result transaction' USING ERRCODE='23514';
                END IF;
            END IF;
            RETURN NEW; END; $$ LANGUAGE plpgsql""")
        for table in ("stenosis_analysis_results", "stenosis_lesions"):
            op.execute(f"CREATE TRIGGER {table}_insert BEFORE INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION stenosis_result_insert_guard()")
    else:
        # SQLite is test-only. Preserve the immutability rules, without claiming
        # that its locking is equivalent to PostgreSQL.
        for table in ("stenosis_analysis_results", "stenosis_lesions"):
            for action in ("UPDATE", "DELETE"):
                op.execute(f"CREATE TRIGGER {table}_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT, 'Stenosis results are immutable'); END")
        op.execute("""CREATE TRIGGER stenosis_analysis_results_insert BEFORE INSERT ON stenosis_analysis_results
            WHEN NOT EXISTS (SELECT 1 FROM stenosis_analysis_jobs j WHERE j.id=NEW.analysis_id AND j.status='running'
                AND j.case_id=NEW.case_id AND j.parent_segmentation_result_id=NEW.parent_segmentation_result_id AND j.source_sha256=NEW.source_sha256)
            BEGIN SELECT RAISE(ABORT, 'Result requires a matching running job'); END""")
        op.execute("""CREATE TRIGGER stenosis_lesions_insert BEFORE INSERT ON stenosis_lesions
            WHEN NOT EXISTS (SELECT 1 FROM stenosis_analysis_results r JOIN stenosis_analysis_jobs j ON j.id=r.analysis_id
                WHERE r.id=NEW.result_id AND j.status='running') BEGIN SELECT RAISE(ABORT, 'Lesion requires a running result transaction'); END""")


def downgrade():
    # Removes new findings, not users/cases/segmentations/job history or files.
    # Completed job references lose their result; back up results before rollback.
    op.drop_table("stenosis_lesions")
    op.drop_index("ix_stenosis_result_case", table_name="stenosis_analysis_results")
    op.drop_table("stenosis_analysis_results")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION stenosis_result_insert_guard()")
        op.execute("DROP FUNCTION stenosis_result_immutable()")
