
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CaseCreate(BaseModel):
    patient_id: int = Field(gt=0)
    case_code: str = Field(min_length=2, max_length=50)
    study_type: str = Field(
        default="Coronary Artery Analysis",
        min_length=1,
        max_length=100,
    )


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    case_code: str
    study_type: str
    status: str
    image_path: str | None
    created_at: datetime
