"""Read-only operational analytics and versioned research reports."""
from datetime import date, datetime, timezone
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, model_validator, AwareDatetime
from app.schemas.stenosis import Contract, Identifier, Text, Version
from app.schemas.stenosis_jobs import AnalysisJobResponse
from app.schemas.stenosis_results import StenosisResultResponse
from app.schemas.stenosis_explanations import ExplanationList

JobStatus = Literal["queued", "running", "completed", "failed"]


class AnalyticsFilters(Contract):
    start_date: date | None = None
    end_date: date | None = None
    case_id: int | None = Field(None, gt=0)
    patient_id: int | None = Field(None, gt=0)
    status: JobStatus | None = None
    method_id: Identifier | None = None
    method_version: Identifier | None = None

    @model_validator(mode="after")
    def dates(self) -> Self:
        if self.start_date and self.end_date and (self.end_date < self.start_date or (self.end_date-self.start_date).days > 365):
            raise ValueError("Use an increasing UTC date window of at most 366 days")
        if self.method_version and not self.method_id:
            raise ValueError("Method version requires method identifier")
        return self

    def resolved(self):
        end = self.end_date or datetime.now(timezone.utc).date()
        # Clamp only the default lookback; valid ISO dates at the calendar's
        # lower bound must not overflow before query validation.
        start = self.start_date or date.fromordinal(max(1, end.toordinal()-29))
        return AnalyticsFilters(**{**self.model_dump(), "start_date": start, "end_date": end})


class JobCounts(Contract):
    total: int = Field(ge=0)
    queued: int = Field(ge=0)
    running: int = Field(ge=0)
    completed: int = Field(ge=0)
    failed: int = Field(ge=0)


class CurrentCounts(Contract):
    analyses: int = Field(ge=0)
    unique_cases: int = Field(ge=0)
    unique_patients: int | None = Field(None, ge=0)
    patient_count_reason: Text | None
    lesions: int = Field(ge=0)
    analyses_with_lesions: int = Field(ge=0)
    cases_with_lesions: int = Field(ge=0)
    zero_finding_analyses: int = Field(ge=0)
    explanation_artifacts: int = Field(ge=0)
    analyses_with_explanations: int = Field(ge=0)


class DataQuality(Contract):
    stale: int = Field(ge=0)
    unverified: int = Field(ge=0)
    integrity_errors: int = Field(ge=0)
    freshness_policy: Text


class MeasurementCounts(Contract):
    field: Literal["reference_diameter", "minimum_lumen_diameter", "percentage_narrowing"]
    available: int = Field(ge=0)
    unavailable: int = Field(ge=0)


class GroupCount(Contract):
    label: Text
    method_id: Text
    method_version: Text
    count: int = Field(ge=0)


class TrendDay(Contract):
    date: date
    queued: int = Field(ge=0)
    running: int = Field(ge=0)
    completed: int = Field(ge=0)
    failed: int = Field(ge=0)


class TrendResponse(Contract):
    contract_version: Version
    generated_at: AwareDatetime
    filters: AnalyticsFilters
    timezone: Literal["UTC"]
    definition: Text
    items: list[TrendDay]


class AnalyticsSummary(Contract):
    contract_version: Version
    generated_at: AwareDatetime
    filters: AnalyticsFilters
    execution_available: bool
    execution_reason: Text
    jobs: JobCounts
    current: CurrentCounts
    quality: DataQuality
    severity_status: Literal["unavailable"]
    severity_reason: Text
    severity_distribution: None
    supplied_severity_labels: int = Field(ge=0)
    measurements: list[MeasurementCounts]
    measurement_summary_status: Literal["unavailable"]
    measurement_summary_reason: Text
    anatomy: list[GroupCount]
    explanation_methods: list[GroupCount]
    trends: TrendResponse
    definitions: dict[str, Text]


class AnalysisIndexItem(Contract):
    analysis_id: UUID
    case_id: int
    status: JobStatus
    created_at: AwareDatetime
    completed_at: AwareDatetime | None
    method_id: Text
    method_version: Text
    result_id: UUID | None
    result_availability: Literal["not_completed", "current", "stale", "unverified", "integrity_error"]


class AnalysisIndex(Contract):
    contract_version: Version
    filters: AnalyticsFilters
    items: list[AnalysisIndexItem]
    total: int = Field(ge=0)
    limit: int
    offset: int
    has_more: bool


class ReportCase(Contract):
    case_id: int
    case_reference: Text
    # Existing case-reader contracts already expose the subject's opaque ID.
    # Patient names/notes/codes are never copied into this report.
    patient_id: int


class StenosisReport(Contract):
    schema_version: Version
    document_type: Literal["stenosis_analysis_research_report"]
    generated_at: AwareDatetime
    case: ReportCase
    analysis: AnalysisJobResponse
    report_state: Literal["queued", "running", "failed", "stale", "integrity_error", "completed"]
    unavailable_reason: Text | None
    result: StenosisResultResponse | None
    explanations: ExplanationList | None
    limitations: list[Text]
