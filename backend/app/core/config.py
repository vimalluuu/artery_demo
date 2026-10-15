
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    PROJECT_NAME: str = "VascuAI - Artery Segmentation & Stenosis Detection API"
    API_V1_STR: str = "/api/v1"

    SECRET_KEY: SecretStr
    ALGORITHM: Literal["HS256"] = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30, ge=1, le=1440)
    JWT_ISSUER: str = "vascuai"
    JWT_AUDIENCE: str = "vascuai-api"

    DATABASE_URL: str
    TESTING: bool = False

    @field_validator("SECRET_KEY")
    @classmethod
    def secure_key(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        if len(secret.encode()) < 32 or secret.startswith(("vascuai-super-secret", "replace-")):
            raise ValueError("SECRET_KEY must be a newly generated secret of at least 32 bytes")
        return value

    @field_validator("DATABASE_URL")
    @classmethod
    def database_driver(cls, value: str) -> str:
        url = make_url(value)
        if url.drivername in {"postgresql", "postgres"}:
            url = url.set(drivername="postgresql+psycopg")
        if url.drivername not in {"postgresql+psycopg", "sqlite"}:
            raise ValueError("Use PostgreSQL with psycopg, or SQLite in TESTING mode")
        return url.render_as_string(hide_password=False)

    @model_validator(mode="after")
    def sqlite_only_for_tests(self):
        if self.DATABASE_URL.startswith("sqlite:") and not self.TESTING:
            raise ValueError("SQLite requires TESTING=true; PostgreSQL is the primary database")
        return self

    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    UPLOAD_DIR: str = "./uploads"
    OUTPUT_DIR: str = "./outputs"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
