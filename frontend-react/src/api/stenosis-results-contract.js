import { StenosisContractError } from "./stenosis-contract.js";
import { geometryFingerprint, isHash, isUUID, MAX_LESIONS, validateGeometry, validateLocation } from "../lib/stenosis-results.js";
import { sameAffine, MAX_TRANSFER_BYTES } from "../lib/volume-geometry.js";

const fail = message => { throw new StenosisContractError(message || "Malformed stenosis result. No findings were displayed."); };
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 1000;
const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const reasons = new Set(["not_implemented", "not_integrated", "disabled", "not_run", "failed", "not_provided", "not_applicable", "unsupported_geometry"]);
const reason = value => Boolean(value && reasons.has(value.code) && text(value.message));

function measurement(value, unit) {
  if (!value || value.unit !== unit) fail();
  if (value.value === null) { if (!reason(value.unavailable_reason)) fail(); }
  else if (!Number.isFinite(value.value) || value.value < 0 || value.unavailable_reason !== null
      || !identifier(value.method_id) || !identifier(value.method_version) || (unit === "percent" && (value.value > 100 || !text(value.definition)))) fail();
  // The public Measurement schema requires both for available values (above),
  // but permits each independently when a value is unavailable. Preserve that
  // optional provenance instead of rejecting an otherwise valid whole result.
  for (const field of ['method_id', 'method_version']) if (value[field] != null && !identifier(value[field])) fail();
}

export async function validateResultResponse(data, caseId, analysisId) {
  if (!data || data.contract_version !== "1.0" || data.case_id !== Number(caseId) || !isUUID(data.result_id) || !isHash(data.geometry_fingerprint)) fail();
  const result = data.result, provenance = result?.provenance, source = provenance?.source, parent = data.segmentation;
  if (result?.contract_version !== "1.0" || result.state !== "completed" || result.analysis_id !== analysisId.toLowerCase()
      || provenance?.contract_version !== "1.0" || source?.case_id !== Number(caseId) || source.image_reference !== "case-volume"
      || !isUUID(source.parent_segmentation_result_id) || !isHash(source.source_sha256)
      || !identifier(provenance.method_id) || !identifier(provenance.method_version) || !Number.isFinite(Date.parse(provenance.created_at))
      || !/(Z|[+-]\d{2}:\d{2})$/.test(provenance.created_at) || (provenance.checkpoint_sha256 != null && !isHash(provenance.checkpoint_sha256))
      || !["supported", "unsupported_geometry"].includes(data.visualization?.status) || !text(data.visualization?.reason)
      || !Array.isArray(result.lesions) || result.lesions.length > MAX_LESIONS || result.unavailable_reason !== null
      || parent?.id !== source.parent_segmentation_result_id || parent.case_id !== Number(caseId) || parent.stale !== false) fail();
  const geometry = validateGeometry(provenance.geometry);
  if (parent.metadata?.source_sha256 !== source.source_sha256 || (parent.metadata.xyzt_units & 7) !== 2
      || !Array.isArray(parent.metadata.shape) || parent.metadata.shape.length !== 3 || geometry.shape.some((n, i) => n !== parent.metadata.shape[i]) || !sameAffine(geometry.affine, parent.metadata.affine)) fail();
  if (await geometryFingerprint(geometry, source.source_sha256) !== data.geometry_fingerprint) fail("The result geometry fingerprint could not be verified.");
  const ids = new Set();
  for (const lesion of result.lesions) {
    if (!isUUID(lesion.lesion_id) || ids.has(lesion.lesion_id)) fail();
    ids.add(lesion.lesion_id); validateLocation(lesion.location, geometry);
    for (const field of ["vessel_label", "vessel_id", "anatomical_location", "anatomical_method", "external_provider_id"]) if (lesion[field] != null && !text(lesion[field])) fail();
    if ((lesion.location == null) !== reason(lesion.localization_unavailable_reason)) fail();
    for (const [field, unit] of [["reference_diameter", "mm"], ["minimum_lumen_diameter", "mm"], ["percentage_narrowing", "percent"]]) measurement(lesion.measurements?.[field], unit);
    if (!lesion.severity || (lesion.severity.category === null ? !reason(lesion.severity.unavailable_reason) : !text(lesion.severity.category) || !text(lesion.severity.method_id) || !text(lesion.severity.method_version) || lesion.severity.unavailable_reason !== null)) fail();
    const explanation = lesion.explanation;
    if (!explanation || (explanation.artifact_id == null ? !reason(explanation.unavailable_reason)
      : !isUUID(explanation.artifact_id) || explanation.unavailable_reason !== null || !identifier(explanation.method_id) || !identifier(explanation.method_version)
        || !text(explanation.explained_target) || explanation.source_sha256 !== source.source_sha256)) fail();
    if (explanation.artifact_id != null) {
      validateGeometry(explanation.geometry);
      if (!sameAffine(explanation.geometry.affine, geometry.affine) || explanation.geometry.shape.some((n, i) => n !== geometry.shape[i])) fail();
    }
    const region = lesion.candidate_region;
    if (region) validateGeometry(region.geometry);
    if (region && (!isUUID(region.artifact_id) || !isHash(region.sha256) || !["nii", "nii.gz"].includes(region.format)
        || region.source_sha256 !== source.source_sha256 || region.geometry_fingerprint !== data.geometry_fingerprint
        || !sameAffine(region.geometry?.affine, geometry.affine) || region.geometry?.shape?.some((n, i) => n !== geometry.shape[i]))) fail();
  }
  return data;
}

function base(caseId, analysisId) {
  if (!Number.isSafeInteger(Number(caseId)) || Number(caseId) < 1 || !isUUID(analysisId)) throw new Error("Invalid result identity.");
  return `/cases/${Number(caseId)}/stenosis/analyses/${analysisId.toLowerCase()}`;
}

function decodeError(error) {
  let detail = error.response?.data?.detail;
  if (error.response?.data instanceof ArrayBuffer) {
    try { detail = JSON.parse(new TextDecoder().decode(error.response.data)).detail; } catch { /* Retain HTTP error. */ }
  }
  if (detail?.contract_version === "1.0" && text(detail.message)) { error.message = detail.message; error.code = detail.code; }
  return error;
}

export function createStenosisResultsApi(api) {
  return {
    async result(caseId, analysisId, { signal } = {}) {
      try {
        const response = await api.get(`${base(caseId, analysisId)}/result`, { signal });
        if (response.status !== 200) fail();
        return await validateResultResponse(response.data, caseId, analysisId);
      } catch (error) { throw decodeError(error); }
    },
    async region(caseId, analysisId, lesionId, artifactId, { signal } = {}) {
      if (!isUUID(lesionId) || !isUUID(artifactId)) throw new Error("Invalid region identity.");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      let exceeded = false;
      try {
        const response = await api.get(`${base(caseId, analysisId)}/lesions/${lesionId}/regions/${artifactId}`, {
          signal: controller.signal, responseType: "arraybuffer", headers: { Accept: "application/gzip, application/octet-stream" },
          onDownloadProgress: event => { if (event.loaded > MAX_TRANSFER_BYTES || event.total > MAX_TRANSFER_BYTES) { exceeded = true; abort(); } },
        });
        if (controller.signal.aborted) throw new DOMException("Region request cancelled.", "AbortError");
        if (response.status !== 200 || !(response.data instanceof ArrayBuffer) || !response.data.byteLength || response.data.byteLength > MAX_TRANSFER_BYTES || /json|html|text\//i.test(response.headers?.["content-type"] || "")) fail("The server did not return a candidate-region volume.");
        return response.data;
      } catch (error) {
        if (exceeded) throw new Error("The candidate region exceeds the browser transfer limit.");
        throw decodeError(error);
      } finally { signal?.removeEventListener("abort", abort); }
    },
  };
}
