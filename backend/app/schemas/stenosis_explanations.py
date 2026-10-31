"""Supplied attribution contracts; no explanation generator is enabled."""
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, StrictBool, model_validator

from app.schemas.stenosis import Contract, Finite, Identifier, Index, SHA256, Text, UnavailableReason, Version, VolumeGeometry
from app.schemas.stenosis_results import VisualizationState

MAX_EXPLANATIONS = 16
MethodID = Literal["grad_cam", "integrated_gradients", "saliency", "feature_attribution", "reviewed_other"]


class AttributionValues(Contract):
    value_type: Literal["signed", "non_negative"]
    expected_range: tuple[Finite, Finite]
    normalization: Literal["none", "provider_defined"]
    normalized_for_visualization: StrictBool
    normalization_description: Text | None = None
    baseline: Text | None = None

    @model_validator(mode="after")
    def semantics(self) -> Self:
        lo, hi = self.expected_range
        if not -1e12 <= lo < hi <= 1e12:
            raise ValueError("A finite increasing attribution range is required")
        if (self.value_type == "signed" and not lo < 0 < hi) or (self.value_type == "non_negative" and lo < 0):
            raise ValueError("Range must agree with attribution sign semantics")
        if self.normalization == "none" and (self.normalized_for_visualization or self.normalization_description is not None):
            raise ValueError("Unnormalized values must not claim visualization normalization")
        if self.normalization == "provider_defined" and self.normalization_description is None:
            raise ValueError("Provider normalization must be described")
        return self


class ExplainedTarget(Contract):
    identifier: Identifier
    description: Text
    # A genuine prediction record supplied/verified by the future provider,
    # not an attribution hash or calibrated-confidence claim.
    prediction_sha256: SHA256


class ExplanationDetails(Contract):
    contract_version: Version
    explanation_id: UUID
    artifact_id: UUID
    lesion_id: UUID | None = None
    method_id: MethodID
    method_name: Text
    method_version: Identifier
    explanation_type: Literal["attribution"]
    target: ExplainedTarget
    model_id: Identifier
    model_version: Identifier
    checkpoint_sha256: SHA256 | None = None
    scope: Literal["volume", "slice", "lesion", "prediction_target"]
    slice_axis: Literal[0, 1, 2] | None = None
    slice_index: Index | None = None
    values: AttributionValues
    format: Literal["nii", "nii.gz"]
    content_sha256: SHA256
    shape: tuple[Annotated[int, Field(strict=True, gt=0)], Annotated[int, Field(strict=True, gt=0)], Annotated[int, Field(strict=True, gt=0)]]
    dtype: Literal["float32"]
    created_at: AwareDatetime
    limitations: Text

    @model_validator(mode="after")
    def associations(self) -> Self:
        if self.scope == "lesion" and self.lesion_id is None:
            raise ValueError("Lesion scope requires a lesion")
        if self.scope == "slice":
            if self.slice_axis is None or self.slice_index is None or self.slice_index >= self.shape[self.slice_axis]:
                raise ValueError("Slice scope requires an in-grid original-array slice")
            if not self.values.expected_range[0] <= 0 <= self.values.expected_range[1]:
                raise ValueError("Full-grid slice maps require zero outside the declared slice")
        elif self.slice_axis is not None or self.slice_index is not None:
            raise ValueError("Only slice scope has a slice reference")
        if self.method_id == "integrated_gradients" and self.values.baseline is None:
            raise ValueError("Integrated Gradients requires a baseline description")
        return self


class ExplanationSubmission(ExplanationDetails):
    analysis_id: UUID
    source_sha256: SHA256
    geometry_fingerprint: SHA256
    geometry: VolumeGeometry

    @model_validator(mode="after")
    def grid(self) -> Self:
        if self.shape != self.geometry.shape:
            raise ValueError("Attribution must use the full source grid")
        return self


class ExplanationMetadata(ExplanationSubmission):
    result_id: UUID
    visualization: VisualizationState


class ExplanationList(Contract):
    contract_version: Version
    case_id: Annotated[int, Field(strict=True, gt=0)]
    analysis_id: UUID
    result_id: UUID
    status: Literal["available", "not_generated", "unsupported_geometry"]
    unavailable_reason: UnavailableReason | None
    items: Annotated[list[ExplanationMetadata], Field(max_length=MAX_EXPLANATIONS)]
