from typing import Literal
from uuid import UUID

from app.schemas.stenosis import AnalysisProvenance, AnalysisResult, Contract, LesionResult, PositiveID, SHA256, Text, Version, VolumeGeometry


class VisualizationState(Contract):
    status: Literal["supported", "unsupported_geometry"]
    reason: Text


class ViewerMetadata(Contract):
    source_sha256: SHA256
    shape: tuple[PositiveID, PositiveID, PositiveID]
    affine: list[list[float]]
    xyzt_units: int


class ViewerSource(Contract):
    id: UUID
    case_id: PositiveID
    stale: Literal[False]
    metadata: ViewerMetadata


class StenosisResultResponse(Contract):
    contract_version: Version
    result_id: UUID
    case_id: PositiveID
    geometry_fingerprint: SHA256
    visualization: VisualizationState
    segmentation: ViewerSource
    result: AnalysisResult


class StenosisLesionResponse(Contract):
    contract_version: Version
    result_id: UUID
    analysis_id: UUID
    case_id: PositiveID
    geometry_fingerprint: SHA256
    visualization: VisualizationState
    provenance: AnalysisProvenance
    lesion: LesionResult
