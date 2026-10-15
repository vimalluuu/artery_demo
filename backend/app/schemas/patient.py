
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PatientCreate(BaseModel):
    patient_code: str = Field(min_length=2, max_length=50)
    display_name: str = Field(min_length=1, max_length=120)
    notes: str | None = None


class PatientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_code: str
    display_name: str
    notes: str | None
    created_at: datetime
