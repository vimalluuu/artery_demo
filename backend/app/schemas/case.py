from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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

    # Volume field added in 0004_volume_ingestion (null for cases without a volume)
    volume_path: str | None = None
    has_volume: bool = False

    @model_validator(mode="after")
    def _compute_has_volume(self) -> "CaseResponse":
        """Derive has_volume from volume_path after all fields are populated."""
        self.has_volume = self.volume_path is not None
        return self


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


class VolumeMetadataResponse(BaseModel):
    """Volume metadata returned by GET /cases/{id}/volume/metadata.

    Contains only spatial and acquisition metadata extracted from the NIfTI
    header.  No voxel data, no filenames, no PHI.
    """
    model_config = ConfigDict(from_attributes=True)

    case_id: int
    ndim: int
    shape_x: int           # alias: dim_x
    shape_y: int           # alias: dim_y
    shape_z: int           # alias: dim_z
    shape_t: int | None    # alias: dim_t — None for 3D volumes
    voxel_spacing_x: float
    voxel_spacing_y: float
    voxel_spacing_z: float
    affine: list[float]    # 16 floats, row-major 4x4
    voxel_dtype: str
    nifti_version: int
    qform_code: int
    sform_code: int
    xyzt_units: int
    file_size_bytes: int
    uploaded_at: datetime
