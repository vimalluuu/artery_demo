"""Version 1.0 contracts; only capability retrieval is executable in Phase 1."""
from enum import StrEnum
from math import isclose, isfinite
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

CONTRACT_VERSION = "1.0"
Version = Literal["1.0"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")]
SHA256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
PositiveID = Annotated[int, Field(strict=True, gt=0)]
Index = Annotated[int, Field(strict=True, ge=0)]
Finite = Annotated[float, Field(allow_inf_nan=False)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CapabilityStatus(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    NOT_INTEGRATED = "not_integrated"
    DISABLED = "disabled"


class CapabilityID(StrEnum):
    DETECTION = "stenosis_detection"
    CANDIDATES = "candidate_region_extraction"
    LOCALIZATION = "stenosis_localization"
    DIAMETER = "vessel_diameter_measurement"
    NARROWING = "percentage_narrowing"
    SEVERITY = "severity_classification"
    EXPLAINABILITY = "explainability"
    VISUALIZATION = "stenosis_visualization"
    REPORTING = "stenosis_reporting"


class Capability(Contract):
    contract_version: Version
    id: CapabilityID
    display_name: Text
    status: CapabilityStatus
    availability_reason: Text
    execution_permitted: StrictBool
    method_id: Identifier | None = None
    method_version: Identifier | None = None

    @model_validator(mode="after")
    def operational_state(self) -> Self:
        if self.execution_permitted and self.status != CapabilityStatus.AVAILABLE:
            raise ValueError("Execution requires an available capability")
        if (self.method_id is None) != (self.method_version is None):
            raise ValueError("Method identifier and version must be supplied together")
        if self.status == CapabilityStatus.AVAILABLE and self.method_id is None:
            raise ValueError("An available capability requires a versioned method")
        return self


class CapabilitiesResponse(Contract):
    contract_version: Version
    capabilities: list[Capability]

    @model_validator(mode="after")
    def complete_registry(self) -> Self:
        ids = [item.id for item in self.capabilities]
        if len(ids) != len(set(ids)) or set(ids) != set(CapabilityID):
            raise ValueError("Exactly one entry for every stenosis capability is required")
        return self


class UnavailableReason(Contract):
    code: Literal["not_implemented", "not_integrated", "disabled", "not_run", "failed",
                  "not_provided", "not_applicable", "unsupported_geometry"]
    message: Text


class SourceReference(Contract):
    case_id: PositiveID
    # Logical reference scoped by case + fingerprint, never a storage filename.
    image_reference: Literal["case-volume"]
    source_sha256: SHA256
    parent_segmentation_result_id: UUID


class VolumeGeometry(Contract):
    shape: tuple[PositiveID, PositiveID, PositiveID]
    array_axis_order: Literal["nifti_i_j_k"]
    world_convention: Literal["RAS"]
    world_unit: Literal["mm"]
    # Converts zero-based voxel centres in original array order to RAS mm.
    affine: tuple[tuple[Finite, Finite, Finite, Finite],
                  tuple[Finite, Finite, Finite, Finite],
                  tuple[Finite, Finite, Finite, Finite],
                  tuple[Finite, Finite, Finite, Finite]]

    @model_validator(mode="after")
    def valid_affine(self) -> Self:
        if self.affine[3] != (0, 0, 0, 1):
            raise ValueError("Affine must have a homogeneous final row")
        a, b, c = [row[:3] for row in self.affine[:3]]
        determinant = (a[0] * (b[1]*c[2] - b[2]*c[1])
                       - a[1] * (b[0]*c[2] - b[2]*c[0])
                       + a[2] * (b[0]*c[1] - b[1]*c[0]))
        if not isfinite(determinant) or determinant == 0:
            raise ValueError("Affine must be invertible")
        return self


class AnalysisProvenance(Contract):
    contract_version: Version
    source: SourceReference
    geometry: VolumeGeometry | None = None
    method_id: Identifier | None = None
    method_version: Identifier | None = None
    checkpoint_sha256: SHA256 | None = None
    created_at: AwareDatetime

    @model_validator(mode="after")
    def paired_method(self) -> Self:
        if (self.method_id is None) != (self.method_version is None):
            raise ValueError("Method identifier and version must be supplied together")
        return self


class AnalysisRequest(Contract):
    contract_version: Version
    source: SourceReference
    # No execution options are supported yet; unknown fields are rejected.


class LesionLocation(Contract):
    coordinate_convention: Literal["array_ijk_and_RAS_mm"]
    voxel_indices: tuple[Index, Index, Index]
    world_coordinates: tuple[Finite, Finite, Finite]
    slice_axis: Literal[0, 1, 2] | None = None
    slice_index: Index | None = None

    @model_validator(mode="after")
    def paired_slice(self) -> Self:
        if (self.slice_axis is None) != (self.slice_index is None):
            raise ValueError("Slice axis and index must be supplied together")
        return self


class Measurement(Contract):
    value: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None
    unit: Literal["mm", "percent"]
    unavailable_reason: UnavailableReason | None
    method_id: Identifier | None = None
    method_version: Identifier | None = None
    definition: Text | None = None
    reference_region: Text | None = None

    @model_validator(mode="after")
    def value_or_reason(self) -> Self:
        if (self.value is None) != (self.unavailable_reason is not None):
            raise ValueError("Supply a measurement value or an unavailable reason, exclusively")
        if self.value is not None:
            if not self.method_id or not self.method_version:
                raise ValueError("A measurement requires method provenance")
            if self.unit == "percent" and (self.value > 100 or not self.definition):
                raise ValueError("Percentage narrowing requires a definition and range 0–100")
        return self


class LesionMeasurements(Contract):
    reference_diameter: Measurement
    minimum_lumen_diameter: Measurement
    percentage_narrowing: Measurement

    @model_validator(mode="after")
    def measurement_units(self) -> Self:
        if self.reference_diameter.unit != "mm" or self.minimum_lumen_diameter.unit != "mm" or self.percentage_narrowing.unit != "percent":
            raise ValueError("Diameters use mm; percentage narrowing uses percent")
        return self


class SeverityAssessment(Contract):
    category: Identifier | None
    unavailable_reason: UnavailableReason | None
    method_id: Identifier | None = None
    method_version: Identifier | None = None

    @model_validator(mode="after")
    def category_or_reason(self) -> Self:
        if (self.category is None) != (self.unavailable_reason is not None):
            raise ValueError("Supply a severity category or unavailable reason, exclusively")
        if self.category is not None and (not self.method_id or not self.method_version):
            raise ValueError("Severity requires a versioned classification methodology")
        return self


class ExplanationReference(Contract):
    artifact_id: UUID | None
    unavailable_reason: UnavailableReason | None
    method_id: Identifier | None = None
    method_version: Identifier | None = None
    explained_target: Text | None = None
    geometry: VolumeGeometry | None = None
    source_sha256: SHA256 | None = None

    @model_validator(mode="after")
    def artifact_or_reason(self) -> Self:
        if (self.artifact_id is None) != (self.unavailable_reason is not None):
            raise ValueError("Supply an explanation reference or unavailable reason, exclusively")
        if self.artifact_id is not None and any(value is None for value in (
                self.method_id, self.method_version, self.explained_target, self.geometry, self.source_sha256)):
            raise ValueError("Explanation artifacts require method, target, geometry and source identity")
        return self


class CandidateRegionReference(Contract):
    artifact_id: UUID
    sha256: SHA256
    format: Literal["nii", "nii.gz"]
    source_sha256: SHA256
    geometry_fingerprint: SHA256
    geometry: VolumeGeometry


class LesionResult(Contract):
    lesion_id: UUID
    vessel_label: Text | None = None
    anatomical_location: Text | None = None
    vessel_id: Identifier | None = None
    external_provider_id: Identifier | None = None
    anatomical_method: Text | None = None
    candidate_region: CandidateRegionReference | None = None
    location: LesionLocation | None
    localization_unavailable_reason: UnavailableReason | None
    measurements: LesionMeasurements
    severity: SeverityAssessment
    explanation: ExplanationReference

    @model_validator(mode="after")
    def location_or_reason(self) -> Self:
        if (self.location is None) != (self.localization_unavailable_reason is not None):
            raise ValueError("Supply a location or unavailable reason, exclusively")
        return self


class AnalysisState(StrEnum):
    NOT_PERFORMED = "not_performed"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    UNAVAILABLE = "unavailable"


class AnalysisResult(Contract):
    contract_version: Version
    analysis_id: UUID
    state: AnalysisState
    provenance: AnalysisProvenance
    lesions: list[LesionResult] | None
    unavailable_reason: UnavailableReason | None

    @model_validator(mode="after")
    def result_state(self) -> Self:
        if self.state == AnalysisState.COMPLETED:
            if self.lesions is None or self.unavailable_reason is not None:
                raise ValueError("Completed analysis requires a lesion list, possibly empty, and no failure reason")
            if self.provenance.geometry is None or self.provenance.method_id is None:
                raise ValueError("Completed analysis requires verified geometry and a versioned method")
        elif self.lesions is not None:
            raise ValueError("Non-completed analyses must not advertise a lesion list")
        needs_reason = self.state in {AnalysisState.NOT_PERFORMED, AnalysisState.FAILED, AnalysisState.UNAVAILABLE}
        if needs_reason != (self.unavailable_reason is not None):
            raise ValueError("Unavailable, failed and not-performed analyses require an explicit reason")
        for lesion in self.lesions or []:
            if lesion.location:
                indices = lesion.location.voxel_indices
                shape = self.provenance.geometry.shape
                if any(i >= n for i, n in zip(indices, shape)):
                    raise ValueError("Lesion indices are outside the source grid")
                affine = self.provenance.geometry.affine
                expected = [sum(row[i] * indices[i] for i in range(3)) + row[3] for row in affine[:3]]
                if not all(isclose(a, b, rel_tol=1e-6, abs_tol=1e-4) for a, b in zip(expected, lesion.location.world_coordinates)):
                    raise ValueError("World coordinates must match voxel indices through the declared affine")
                axis = lesion.location.slice_axis
                if axis is not None and lesion.location.slice_index != indices[axis]:
                    raise ValueError("Slice reference must identify the lesion voxel")
            explanation = lesion.explanation
            if explanation.artifact_id is not None and (
                    explanation.source_sha256 != self.provenance.source.source_sha256
                    or explanation.geometry != self.provenance.geometry):
                raise ValueError("Explanation must match the analysis source and geometry")
            region = lesion.candidate_region
            if region is not None and (region.source_sha256 != self.provenance.source.source_sha256
                                       or region.geometry != self.provenance.geometry):
                raise ValueError("Candidate region must match the analysis source and geometry")
        ids = [lesion.lesion_id for lesion in self.lesions or []]
        if len(ids) != len(set(ids)):
            raise ValueError("Lesion identifiers must be unique within an analysis")
        return self
