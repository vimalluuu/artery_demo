import os
from pathlib import Path
import secrets
import tempfile
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

# Never read application credentials or use a developer database implicitly.
TEMP = tempfile.TemporaryDirectory(prefix="vascuai-tests-")
os.environ["SECRET_KEY"] = secrets.token_hex(32)
os.environ["TESTING"] = "true"
os.environ["UPLOAD_DIR"] = str(Path(TEMP.name) / "uploads")
os.environ["OUTPUT_DIR"] = str(Path(TEMP.name) / "outputs")
TEST_URL = os.environ.get("TEST_DATABASE_URL")
ADMIN_ENGINE = None
SCHEMA = None
if TEST_URL:
    url = make_url(TEST_URL)
    if url.drivername != "postgresql+psycopg":
        raise RuntimeError("TEST_DATABASE_URL must use postgresql+psycopg")
    SCHEMA = "vascuai_test_" + uuid4().hex
    ADMIN_ENGINE = create_engine(url)
    with ADMIN_ENGINE.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{SCHEMA}"'))
    url = url.update_query_dict({"options": f"-csearch_path={SCHEMA}"})
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
else:
    os.environ["DATABASE_URL"] = "sqlite://"

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from app.core.security import create_access_token, hash_password
from app.database.session import Base, SessionLocal, engine
from app.main import app
from app.models import User

PASSWORD = "a-long-test-password-123"


def migrate(revision="head"):
    command.upgrade(Config("alembic.ini"), revision)


def clear_database():
    Base.metadata.drop_all(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.fixture(autouse=True)
def database():
    clear_database()
    migrate()
    yield


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def db():
    with SessionLocal() as db:
        yield db


@pytest.fixture(scope="session")
def encoded_password():
    return hash_password(PASSWORD)


@pytest.fixture
def account(db, encoded_password):
    def create(role="Clinician", active=True):
        user = User(full_name="Test User", email=f"{uuid4().hex}@example.org",
                    password_hash=encoded_password, role=role, is_active=active)
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(str(user.id), role, user.token_version)
        return user, {"Authorization": f"Bearer {token}"}
    return create


def pytest_sessionfinish(session, exitstatus):
    engine.dispose()
    if ADMIN_ENGINE:
        with ADMIN_ENGINE.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{SCHEMA}" CASCADE'))
        ADMIN_ENGINE.dispose()
    TEMP.cleanup()
