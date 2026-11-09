"""Versioned JSON interchange for actual offline results, with explicit nulls."""
from typing import Annotated, Literal
from uuid import UUID
from datetime import datetime
import math
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

SHA256 = Annotated[str, Field(pattern=r"^[a-fA-F0-9]{64}$"), AfterValidator(str.lower)]
CaseID = Annotated[int, Field(strict=True, gt=0, le=2147483647)]
Count = Annotated[int, Field(strict=True, ge=0, le=9223372036854775807)]
Score = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Slug = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelIdentity(StrictModel):
    id: Slug
    architecture: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)


class CheckpointIdentity(StrictModel):
    sha256: SHA256
    training_run_id: str = Field(min_length=1, max_length=200)
    reported_training_steps: Annotated[int, Field(strict=True, ge=0, le=2147483647)] | None = None


class SplitSource(StrictModel):
    dataset: str = Field(min_length=1, max_length=200)
    manifest_sha256: SHA256
    workbook_sha256: SHA256 | None = None
    sheet: str | None = Field(default=None, max_length=100)
    split_column: str = Field(min_length=1, max_length=100)
    split: Literal["Val", "Validation"]


class MetricDefinitions(StrictModel):
    version: Literal["binary-voxel/1.0"]
    reference_foreground: str = Field(min_length=1, max_length=500)
    prediction_foreground: str = Field(min_length=1, max_length=500)
    zero_denominator: Literal["null"]


class EvaluationMetadata(StrictModel):
    model: ModelIdentity
    checkpoint: CheckpointIdentity
    threshold: Score
    validation_split_source: SplitSource
    metric_definitions: MetricDefinitions
    provenance: dict[str, JsonValue] = Field(min_length=1, max_length=100)

    @field_validator("provenance")
    @classmethod
    def finite_provenance(cls, value):
        def check(item, depth=0):
            if depth > 20 or isinstance(item, float) and not math.isfinite(item):
                raise ValueError("Provenance must be finite, bounded JSON")
            if isinstance(item, dict):
                for child in item.values():
                    check(child, depth+1)
            elif isinstance(item, list):
                for child in item:
                    check(child, depth+1)
        check(value)
        return value


class Metrics(StrictModel):
    dice: Score | None
    iou: Score | None
    precision: Score | None
    recall: Score | None


class ConfusionCounts(StrictModel):
    tp: Count
    fp: Count
    fn: Count
    tn: Count | None = None

    def metrics(self):
        tp, fp, fn = self.tp, self.fp, self.fn
        ratio = lambda n, d: n / d if d else None
        return dict(dice=ratio(2*tp, 2*tp+fp+fn), iou=ratio(tp, tp+fp+fn),
                    precision=ratio(tp, tp+fp), recall=ratio(tp, tp+fn))


class MaskProvenance(StrictModel):
    origin: Literal["reference_annotation", "model_prediction"]
    mask_sha256: SHA256
    model_checkpoint_sha256: SHA256 | None = None
    segmentation_result_id: UUID | None = None

    @model_validator(mode="after")
    def source_kind(self):
        if self.origin == "reference_annotation" and (self.model_checkpoint_sha256 or self.segmentation_result_id):
            raise ValueError("Reference-derived masks must not claim prediction provenance")
        if self.origin == "model_prediction" and self.model_checkpoint_sha256 is None:
            raise ValueError("Prediction masks require checkpoint identity")
        return self


class SectionStatus(StrictModel):
    section_id: str = Field(min_length=1, max_length=100)
    section_index: Annotated[int, Field(strict=True, ge=0)]
    source_status: str = Field(min_length=1, max_length=100)
    exclusion_reason: str | None = Field(default=None, max_length=500)


class CaseEvaluation(StrictModel):
    case_id: CaseID
    dataset_case_id: str = Field(min_length=1, max_length=100)
    reference_sha256: SHA256
    prediction_sha256: SHA256
    metrics: Metrics
    confusion_counts: ConfusionCounts | None = None
    exclusion_reason: str | None = Field(default=None, min_length=1, max_length=500)
    mask_provenance: MaskProvenance | None = None
    sections: list[SectionStatus] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def consistent(self):
        if self.confusion_counts:
            expected = self.confusion_counts.metrics()
            for key, value in self.metrics.model_dump().items():
                target = expected[key]
                if (value is None) != (target is None) or (value is not None and abs(value-target) > 0.000005):
                    raise ValueError("Metrics contradict confusion counts or null-denominator conventions")
        if self.sections and self.mask_provenance is None:
            raise ValueError("Section statuses require explicit mask provenance")
        if len({s.section_id for s in self.sections}) != len(self.sections) or len({s.section_index for s in self.sections}) != len(self.sections):
            raise ValueError("Duplicate section identity")
        return self


class EvaluationDocument(StrictModel):
    schema_version: Literal["offline-evaluation/1.0"]
    metadata: EvaluationMetadata
    cases: list[CaseEvaluation] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def identities(self):
        if len({r.case_id for r in self.cases}) != len(self.cases) or len({r.dataset_case_id for r in self.cases}) != len(self.cases):
            raise ValueError("Duplicate case membership")
        for row in self.cases:
            mask = row.mask_provenance
            if mask and mask.origin == "model_prediction" and mask.model_checkpoint_sha256 != self.metadata.checkpoint.sha256:
                raise ValueError("Mask checkpoint differs from evaluation checkpoint")
            if mask and mask.mask_sha256 != (row.reference_sha256 if mask.origin == "reference_annotation" else row.prediction_sha256):
                raise ValueError("Mask provenance differs from the case artifact identity")
        return self


class EvaluationImport(StrictModel):
    source_artifact_id: UUID
    metadata: EvaluationMetadata


class ArtifactResponse(StrictModel):
    id: UUID
    sha256: SHA256
    size_bytes: int
    created_at: datetime
    schema_version: Literal["offline-evaluation/1.0"]


class EvaluationIdentity(StrictModel):
    id: UUID
    source_artifact_id: UUID
    model_id: str
    model_run_id: UUID
    checkpoint_sha256: SHA256
    threshold: Score
    metadata: EvaluationMetadata
    created_at: datetime


class EvaluationMembership(EvaluationIdentity):
    case_ids: list[int]


class MacroDenominator(StrictModel):
    defined_cases: int
    undefined_cases: int


class CaseExclusion(StrictModel):
    case_id: int
    reason: str


class EvaluationSummary(EvaluationMembership):
    case_count: int
    included_case_count: int
    exclusions: list[CaseExclusion]
    headline_aggregation: Literal["macro_unweighted_per_case"]
    macro_metrics: Metrics
    macro_denominators: dict[str, MacroDenominator]
    pooled_micro_metrics: Metrics | None
    pooled_status: str
    metric_formulas: dict[str, str]
    zero_denominator: Literal["null"]
    undefined_macro_policy: str


class EvaluationCases(EvaluationIdentity):
    metric_definitions: MetricDefinitions
    metric_formulas: dict[str, str]
    undefined_macro_policy: str
    cases: list[CaseEvaluation]


class EvaluationComparison(StrictModel):
    case_ids: list[int]
    evaluations: list[EvaluationSummary]
    metric_definitions_match: bool
    reference_artifacts_match: bool
    exclusions_match: bool


class TrainingRunResponse(StrictModel):
    id: UUID
    training_run_id: str
    checkpoint_sha256: SHA256
    reported_training_steps: int | None
    source_artifact_id: UUID
    record_origin: Literal["imported_offline_evaluation_metadata"]
    created_at: datetime


class HistoryPagination(StrictModel):
    limit: int
    offset: int
    next_offset: int | None
    offset_limit_reached: bool
    returned_evaluations: int
    returned_training_runs: int


class ModelRuns(StrictModel):
    model: ModelIdentity
    training_runs: list[TrainingRunResponse]
    evaluations: list[EvaluationMembership]
    pagination: HistoryPagination


class UnavailableSection(SectionStatus):
    measurement_status: Literal["measurement_unavailable_no_validated_gate"]


class StenosisEvaluationSections(StrictModel):
    evaluation_id: UUID
    case_id: int
    source_artifact_id: UUID
    measurement_status: Literal["measurement_unavailable_no_validated_gate"]
    validated_resolution_gate: None
    mask_provenance: MaskProvenance | None
    sections: list[UnavailableSection]
    section_data_status: Literal["available", "unavailable_no_section_records"]
    provenance: dict[str, JsonValue]
    quantitative_stenosis_available: Literal[False]
