from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Allowed value sets — enforced by Pydantic, not as DB CHECK constraints
# (avoids SQLite vs PostgreSQL incompatibility in the test suite).
# ---------------------------------------------------------------------------
MODALITY_VALUES = Literal[
    "CT Angiography", "MRA", "CTA", "DSA", "Ultrasound", "Other"
]
REGION_VALUES = Literal[
    "Coronary", "Carotid", "Renal", "Peripheral", "Cerebral", "Aorta", "Other"
]
SEX_VALUES = Literal["M", "F", "O"]


class CaseCreate(BaseModel):
    """Fields accepted when creating a new case.

    Required: patient_id, case_code, study_type
    Optional metadata (all nullable / absent = None):
        modality, region, scan_date, age_years, sex, notes
    """

    patient_id: int = Field(gt=0)
    case_code: str = Field(min_length=2, max_length=50)
    study_type: str = Field(
        default="Coronary Artery Analysis",
        min_length=1,
        max_length=100,
    )

    # Optional metadata fields — absent in request body defaults to None
    modality: MODALITY_VALUES | None = None
    region: REGION_VALUES | None = None
    scan_date: date | None = None
    age_years: int | None = Field(default=None, ge=0, le=120)
    sex: SEX_VALUES | None = None
    notes: str | None = Field(default=None, max_length=2000)


class CaseUpdate(BaseModel):
    """Fields that can be updated via PATCH /cases/:id.

    Only metadata and study_type are mutable after creation.
    patient_id, case_code, status, image_path, and created_at are immutable.
    Omitted fields are left unchanged (partial update semantics).
    """

    study_type: str | None = Field(default=None, min_length=1, max_length=100)
    modality: MODALITY_VALUES | None = None
    region: REGION_VALUES | None = None
    scan_date: date | None = None
    age_years: int | None = Field(default=None, ge=0, le=120)
    sex: SEX_VALUES | None = None
    notes: str | None = Field(default=None, max_length=2000)


class CaseResponse(BaseModel):
    """Serialized case returned by the API.

    Includes all new metadata fields. Existing cases (created before the
    0003_case_meta migration) will have null for the new fields.
    """

    model_config = ConfigDict(from_attributes=True)

    # Core fields (unchanged from before migration)
    id: int
    patient_id: int
    case_code: str
    study_type: str
    status: str
    image_path: str | None
    created_at: datetime

    # Metadata fields added in 0003_case_meta (null for pre-migration cases)
    modality: str | None = None
    region: str | None = None
    scan_date: date | None = None
    age_years: int | None = None
    sex: str | None = None
    notes: str | None = None


class ImageMetadata(BaseModel):
    case_id: int
    case_code: str
    filename: str
    format: str
    width: int
    height: int
    channels: int
    pixel_dtype: str
    file_size_bytes: int
