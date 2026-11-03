
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
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
from app.database.session import check_database_connection


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Backend API for our medical image analysis research prototype."
    ),
    version="0.1.0",
)

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
    return JSONResponse(status_code=503, content={"detail": "Database temporarily unavailable"})


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
