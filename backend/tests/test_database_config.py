from io import StringIO

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from pydantic import ValidationError
import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import OperationalError

from app.core.config import Settings, settings
from app.database.session import Base, engine
from app.models import Case, Patient, User
from conftest import clear_database, migrate, PASSWORD


def test_health_cors_openapi(client):
    assert client.get("/").status_code == 200
    assert client.get("/health").json() == {"status": "healthy"}
    assert client.get("/health/ready").json() == {"status": "ready"}
    headers = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "Authorization,Content-Type"}
    assert client.options("/api/v1/auth/login", headers=headers).status_code == 200
    headers["Origin"] = "https://untrusted.example"
    assert client.options("/api/v1/auth/login", headers=headers).status_code == 400
    schema = client.get("/openapi.json").json()
    login = schema["paths"]["/api/v1/auth/login"]["post"]
    assert set(login["requestBody"]["content"]) == {"application/json", "application/x-www-form-urlencoded"}
    assert "/api/v1/cases/{case_id}/image" in schema["paths"]


@pytest.mark.parametrize("changes", [
    {"SECRET_KEY": "too-short"}, {"SECRET_KEY": "vascuai-super-secret-key-change-in-production-2026"},
    {"DATABASE_URL": "sqlite://", "TESTING": False}, {"DATABASE_URL": "mysql://user@localhost/db"},
    {"ALGORITHM": "none"}, {"ACCESS_TOKEN_EXPIRE_MINUTES": 0},
    {"ACCESS_TOKEN_EXPIRE_MINUTES": 100000},
])
def test_configuration_fails_closed(changes):
    data = {"SECRET_KEY": settings.SECRET_KEY, "DATABASE_URL": "postgresql+psycopg://user@localhost/db",
            "TESTING": False, **changes}
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, **data)
    assert "vascuai-super-secret-key-change-in-production-2026" not in str(exc.value)


def test_postgres_driver_and_sqlite_configuration():
    config = Settings(_env_file=None, SECRET_KEY=settings.SECRET_KEY, DATABASE_URL="postgresql://user@localhost/db")
    assert config.DATABASE_URL.startswith("postgresql+psycopg://")
    assert engine.dialect.name in {"sqlite", "postgresql"}
    if engine.dialect.name == "sqlite":
        with engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1


def test_database_errors_do_not_leak(client, monkeypatch):
    from app import main
    def fail():
        raise OperationalError("private-sql", {}, Exception("private-credential"))
    monkeypatch.setattr(main, "check_database_connection", fail)
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database temporarily unavailable"}


def test_migration_matches_models():
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert differences == []


def test_main_upgrade_preserves_data_and_hashes(db, encoded_password, client):
    clear_database()
    migrate("0001_main")
    with engine.begin() as connection:
        for number, role in enumerate(["doctor", "researcher", "admin", "Data Scientist"], 1):
            connection.execute(text(
                "INSERT INTO users (id,full_name,email,password_hash,role,is_active) "
                "VALUES (:id,'Legacy User',:email,:hash,:role,true)"),
                {"id": number, "email": f"legacy{number}@example.org", "hash": encoded_password, "role": role})
        connection.execute(text("INSERT INTO patients (id,patient_code,display_name) VALUES (1,'P-legacy','Legacy Test')"))
        connection.execute(text("INSERT INTO cases (id,patient_id,case_code,study_type,status,image_path) "
                                "VALUES (1,1,'C-legacy','Coronary Artery Analysis','pending','legacy.png')"))
    migrate()
    users = db.scalars(select(User).order_by(User.id)).all()
    assert [u.role for u in users] == ["Clinician", "Researcher", "Admin", "DataScientist"]
    assert all(u.password_hash == encoded_password and u.token_version == 0 for u in users)
    assert db.get(Case, 1).image_path == "legacy.png"
    assert db.get(Patient, 1).patient_code == "P-legacy"
    login = client.post("/api/v1/auth/login", json={"email": "legacy1@example.org", "password": PASSWORD})
    assert login.status_code == 200


def test_unknown_legacy_role_blocks_before_schema_change():
    clear_database()
    migrate("0001_main")
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users (full_name,email,password_hash,role,is_active) "
                                "VALUES ('Unknown','unknown@example.org','hash','unreviewed',true)"))
    with pytest.raises(RuntimeError, match="Unknown existing roles"):
        migrate()
    assert "token_version" not in {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT role FROM users")) == "unreviewed"


def test_admin_bootstrap_and_init_db(monkeypatch, db):
    from app.database import create_admin, init_db
    replies = iter(["Operator Name", "operator@example.org"])
    monkeypatch.setattr("builtins.input", lambda _: next(replies))
    monkeypatch.setattr(create_admin, "getpass", lambda _: PASSWORD)
    create_admin.main()
    assert db.scalar(select(User)).role == "Admin"
    replies = iter(["Operator Name", "operator@example.org"])
    with pytest.raises(SystemExit, match="already exists"):
        create_admin.main()
    init_db.init_db()  # second migration run is idempotent


def test_postgres_offline_migration(monkeypatch):
    # Compile real PostgreSQL DDL even when running the lightweight SQLite suite.
    stream = StringIO()
    config = Config("alembic.ini", output_buffer=stream)
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://user@localhost/db")
    command.upgrade(config, "head", sql=True)
    ddl = stream.getvalue()
    assert "SERIAL" in ddl and "TIMESTAMP WITH TIME ZONE" in ddl
    assert "ck_users_role" in ddl and "audit_events" in ddl
