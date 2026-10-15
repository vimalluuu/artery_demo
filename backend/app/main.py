
from fastapi import FastAPI

from app.core.config import settings
from app.routers.auth import router as auth_router
from app.routers.patients import router as patients_router
from app.routers.cases import router as cases_router


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Backend API for our medical image analysis research prototype."
    ),
    version="0.1.0",
)

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
