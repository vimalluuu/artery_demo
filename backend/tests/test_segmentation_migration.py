from io import StringIO

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.database.session import engine
from app.routers.segmentation import result_directory
from test_segmentation_api import fake_runtime, seed


def test_segmentation_downgrade_preserves_prior_tables_and_can_reupgrade(client, account, fake_runtime, db):
    case_id, headers = seed(client, account)
    response = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={})
    assert response.status_code == 201
    db.rollback()  # Release fixture SELECT locks before PostgreSQL DDL.
    artifact = result_directory(response.json()["id"]) / "prediction_mask.nii.gz"
    tables = ["users", "patients", "cases", "volume_metadata", "audit_events"]
    def snapshot():
        with engine.connect() as connection:
            return {name: connection.execute(text(f"SELECT * FROM {name} ORDER BY id")).all() for name in tables}
    before = snapshot()
    assert "ix_segmentation_results_case_id" in {index["name"] for index in inspect(engine).get_indexes("segmentation_results")}
    command.downgrade(Config("alembic.ini"), "0004_volume_ingestion")
    assert "segmentation_results" not in inspect(engine).get_table_names()
    assert snapshot() == before
    assert artifact.is_file()  # Downgrade affects DB history, not filesystem artifacts.
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0004_volume_ingestion"
    command.upgrade(Config("alembic.ini"), "head")
    assert "segmentation_results" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM segmentation_results")) == 0
    assert snapshot() == before


def test_postgres_downgrade_ddl_drops_index_before_table(monkeypatch):
    stream = StringIO()
    config = Config("alembic.ini", output_buffer=stream)
    # Use explicit offline PostgreSQL compilation; no DB connection is opened.
    config.attributes["connection"] = None
    from app.core.config import settings
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://test@localhost/unused")
    command.downgrade(config, "0005_segmentation_results:0004_volume_ingestion", sql=True)
    ddl = stream.getvalue()
    assert ddl.index("DROP INDEX ix_segmentation_results_case_id") < ddl.index("DROP TABLE segmentation_results")
