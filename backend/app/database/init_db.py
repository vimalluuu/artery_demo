"""Compatibility entry point: run versioned migrations, never create_all at startup."""
from pathlib import Path

from alembic import command
from alembic.config import Config


def init_db() -> None:
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(config, "head")


if __name__ == "__main__":
    init_db()
