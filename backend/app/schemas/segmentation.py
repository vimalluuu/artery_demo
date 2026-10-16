from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SegmentationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    threshold: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)


class SegmentationResponse(BaseModel):
    id: str
    case_id: int
    created_at: datetime
    stale: bool
    metadata: dict
    mask_url: str
    probabilities_url: str
