
import logging
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.evaluation_upload import EvaluationUploadBodyLimit
from app.routers.auth import router as auth_router
from app.routers.patients import router as patients_router
from app.routers.cases import router as cases_router
from app.routers.admin import router as admin_router
from app.routers.segmentation import router as segmentation_router
from app.routers.stenosis import router as stenosis_router
from app.routers.stenosis_jobs import router as stenosis_jobs_router
from app.routers.stenosis_results import router as stenosis_results_router
from app.routers.stenosis_explanations import router as stenosis_explanations_router
from app.routers.stenosis_reporting import router as stenosis_reporting_router
from app.routers.evaluations import router as evaluations_router
from app.database.session import check_database_connection


logger = logging.getLogger(__name__)


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Backend API for our medical image analysis research prototype."
    ),
    version="0.1.0",
)

app.add_middleware(EvaluationUploadBodyLimit, path=f"{settings.API_V1_STR}/evaluations/artifacts")
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS,
                   allow_credentials=False, allow_methods=["GET", "POST", "PATCH"],
                   allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Default validation errors include submitted passwords; expose metadata only.
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]})


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc: SQLAlchemyError):
    original = getattr(exc, "orig", None)
    sqlstate = getattr(original, "sqlstate", None)
    schema_error = sqlstate in {"42P01", "42703"} or (
        isinstance(original, sqlite3.OperationalError)
        and str(original).startswith(("no such table:", "no such column:"))
    )
    # SQLAlchemy exception strings/tracebacks can contain SQL parameters and
    # credentials. Log diagnostic categories and the route template only.
    route = getattr(request.scope.get("route"), "path", "unmatched")
    logger.error(
        "Database request failed: route=%s error_type=%s sqlstate=%s schema_error=%s",
        route, type(exc).__name__, sqlstate, schema_error,
    )
    detail = (
        "Database schema is out of date or incomplete. Review and apply the "
        "documented Alembic migrations before retrying."
        if schema_error else "Database temporarily unavailable"
    )
    return JSONResponse(status_code=503, content={"detail": detail})


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(admin_router, prefix=settings.API_V1_STR)
app.include_router(segmentation_router, prefix=settings.API_V1_STR)
app.include_router(stenosis_router, prefix=settings.API_V1_STR)
app.include_router(stenosis_jobs_router, prefix=settings.API_V1_STR)
app.include_router(stenosis_results_router, prefix=settings.API_V1_STR)
app.include_router(stenosis_explanations_router, prefix=settings.API_V1_STR)
app.include_router(stenosis_reporting_router, prefix=settings.API_V1_STR)
app.include_router(evaluations_router, prefix=settings.API_V1_STR)

app.include_router(
    patients_router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    cases_router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    auth_router,
    prefix=settings.API_V1_STR,
)

@app.get("/")
def root():
    return {
        "message": "Artery Analysis API is running",
        "status": "ok",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/health/ready")
def readiness_check():
    check_database_connection()
    return {"status": "ready"}
