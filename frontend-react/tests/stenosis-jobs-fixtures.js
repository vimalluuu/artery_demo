// Synthetic lifecycle records only; no clinical results or production registration.
export const parentId = "12345678-1234-4567-890a-123456789abc";
export const sourceFixture = { case_id: 1, image_reference: "case-volume", source_sha256: "a".repeat(64), parent_segmentation_result_id: parentId };
export function jobFixture(status = "queued", index = 1) {
  const time = "2026-10-31T00:00:00Z";
  return { contract_version: "1.0", analysis_id: `${String(index).padStart(8, "0")}-1234-4567-890a-123456789abc`, case_id: 1, status,
    provenance: { contract_version: "1.0", source: { ...sourceFixture }, geometry: null, method_id: "test-only-provider", method_version: "v1", checkpoint_sha256: null, created_at: time },
    created_at: time, updated_at: time, started_at: status === "queued" ? null : time,
    completed_at: status === "completed" ? time : null, failed_at: status === "failed" ? time : null,
    failure: status === "failed" ? { code: "provider_error", message: "The analysis provider could not complete this job." } : null,
    stale: false, result_reference: status === "completed" ? parentId : null };
}
export const historyFixture = (states = []) => ({ contract_version: "1.0", case_id: 1, items: states.map((status, i) => jobFixture(status, i + 1)), total: states.length, limit: 20, offset: 0, has_more: false });

export function capabilitiesFixture(available = false) {
  const ids = ["stenosis_detection", "candidate_region_extraction", "stenosis_localization", "vessel_diameter_measurement", "percentage_narrowing", "severity_classification", "explainability", "stenosis_visualization", "stenosis_reporting"];
  return { contract_version: "1.0", capabilities: ids.map((id, i) => ({
    contract_version: "1.0", id, display_name: id.replaceAll("_", " "), status: available && !i ? "available" : "unavailable",
    availability_reason: available && !i ? "Test-only registered runtime fixture." : "No verified provider is registered.",
    execution_permitted: available && !i, method_id: available && !i ? "test-only-provider" : null, method_version: available && !i ? "v1" : null,
  })) };
}
