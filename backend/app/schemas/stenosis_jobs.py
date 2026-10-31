"""Additive lifecycle DTOs. They do not contain medical analysis results."""
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from app.schemas.stenosis import AnalysisProvenance, Contract, PositiveID, Text, Version


class JobFailure(Contract):
    code: Literal["source_changed", "provider_changed", "provider_error", "lease_expired", "dispatch_failed"]
    message: Text


class AnalysisJobResponse(Contract):
    contract_version: Version
    analysis_id: UUID
    case_id: PositiveID
    status: Literal["queued", "running", "completed", "failed"]
    provenance: AnalysisProvenance
    created_at: AwareDatetime
    updated_at: AwareDatetime
    started_at: AwareDatetime | None
    completed_at: AwareDatetime | None
    failed_at: AwareDatetime | None
    failure: JobFailure | None
    stale: bool
    result_reference: UUID | None


class AnalysisHistoryResponse(Contract):
    contract_version: Version
    case_id: PositiveID
    items: list[AnalysisJobResponse]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    has_more: bool
