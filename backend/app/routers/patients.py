
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.database.session import get_db
from app.models import Patient, User
from app.schemas.patient import PatientCreate, PatientResponse


router = APIRouter(
    prefix="/patients",
    tags=["Patients"],
)


CurrentUser = Annotated[
    User,
    Depends(require_roles("admin", "doctor")),
]

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]


@router.post(
    "",
    response_model=PatientResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_patient(
    patient_data: PatientCreate,
    current_user: CurrentUser,
    db: DatabaseSession,
):
    existing = db.scalar(
        select(Patient).where(
            Patient.patient_code == patient_data.patient_code
        )
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Patient code already exists",
        )

    patient = Patient(**patient_data.model_dump())
    db.add(patient)

    try:
        db.commit()
        db.refresh(patient)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Patient could not be created because of a data conflict",
        )

    return patient


@router.get(
    "",
    response_model=list[PatientResponse],
)
def list_patients(
    current_user: CurrentUser,
    db: DatabaseSession,
):
    statement = select(Patient).order_by(Patient.id.desc())

    return db.scalars(statement).all()
