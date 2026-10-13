
from fastapi import FastAPI

app = FastAPI(
    title="Artery Segmentation and Stenosis Detection API",
    description="Backend API for our medical image analysis research prototype.",
    version="0.1.0",
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
