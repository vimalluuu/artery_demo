from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

from app.database.session import engine, Base
from app.routers import auth

# Create the database tables automatically when the app starts
Base.metadata.create_all(bind=engine)

load_dotenv()

app = FastAPI(
    title="Artery Segmentation and Stenosis Detection API",
    description="Backend API for our medical image analysis research prototype.",
    version="0.1.0",
)

# Setup CORS to allow the React frontend to communicate with this backend
origins = os.getenv("CORS_ORIGINS", '["http://localhost:5173"]').strip("][").split(",")
clean_origins = [origin.strip().strip("'").strip('"') for origin in origins]

app.add_middleware(
    CORSMiddleware,
    allow_origins=clean_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register the authentication routes
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])

@app.get("/")
def root():
    return {
        "message": "Artery Analysis API is running",
        "status": "ok",
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}