"""Central, fail-closed capability registry. No model imports or storage queries."""
from app.schemas.stenosis import (
    CONTRACT_VERSION, AnalysisRequest, CapabilitiesResponse, Capability, CapabilityID,
    CapabilityStatus,
)

# Changes to operational status require a verified provider and a reviewed version.
# Segmentation availability never activates these independent capabilities.
_REGISTRY = (
    (CapabilityID.DETECTION, "Stenosis detection", CapabilityStatus.UNAVAILABLE,
     "No verified stenosis detection provider is registered."),
    (CapabilityID.CANDIDATES, "Candidate region extraction", CapabilityStatus.UNAVAILABLE,
     "No stenosis candidate extraction method is implemented."),
    (CapabilityID.LOCALIZATION, "Stenosis localization", CapabilityStatus.UNAVAILABLE,
     "No verified lesion localization output is available."),
    (CapabilityID.DIAMETER, "Vessel diameter measurement", CapabilityStatus.NOT_INTEGRATED,
     "No verified vessel diameter service is integrated into this application."),
    (CapabilityID.NARROWING, "Percentage narrowing", CapabilityStatus.UNAVAILABLE,
     "No narrowing measurement method or reference-region selection is implemented."),
    (CapabilityID.SEVERITY, "Severity classification", CapabilityStatus.UNAVAILABLE,
     "No validated severity methodology or classifier is integrated."),
    (CapabilityID.EXPLAINABILITY, "Explainability", CapabilityStatus.UNAVAILABLE,
     "No explanation generation method or attribution artifacts are integrated."),
    (CapabilityID.VISUALIZATION, "Stenosis visualization", CapabilityStatus.NOT_INTEGRATED,
     "Geometry-checked lesion markers are implemented; no verified stenosis provider outputs are integrated."),
    (CapabilityID.REPORTING, "Stenosis reporting", CapabilityStatus.NOT_INTEGRATED,
     "Structured research reports use persisted stenosis records; no genuine stenosis provider outputs are integrated."),
)


def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse(contract_version=CONTRACT_VERSION, capabilities=[
        Capability(contract_version=CONTRACT_VERSION, id=key, display_name=name,
                   status=status, availability_reason=reason, execution_permitted=False)
        for key, name, status, reason in _REGISTRY
    ])


def validate_source_association(request: AnalysisRequest, segmentation) -> None:
    """Pure binding check for a future handler after its authorized record lookup.

    Does not establish current-source freshness; the future handler must also use
    the existing stale-input guards. No execution endpoint calls this in Phase 1.
    """
    source = request.source
    if (segmentation.case_id != source.case_id
            or str(segmentation.id) != str(source.parent_segmentation_result_id)
            or segmentation.metadata_json.get("source_sha256") != source.source_sha256):
        raise ValueError("Source and parent segmentation do not belong to the requested case/input")
