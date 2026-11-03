import { StenosisContractError, STENOSIS_CONTRACT_VERSION } from "./stenosis-contract.js";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const text = value => typeof value === "string" && value.trim().length > 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = () => { throw new StenosisContractError("Malformed analysis lifecycle response. Refresh history; no execution result was assumed."); };
const statuses = ["queued", "running", "completed", "failed"];
const failureCodes = ["source_changed", "provider_changed", "provider_error", "lease_expired", "dispatch_failed"];

export function validateJob(job, caseId) {
  if (!job || job.contract_version !== STENOSIS_CONTRACT_VERSION || !uuid(job.analysis_id)
      || !positive(job.case_id) || job.case_id !== Number(caseId) || !statuses.includes(job.status)
      || typeof job.stale !== "boolean" || !date(job.created_at) || !date(job.updated_at)) fail();
  const provenance = job.provenance, source = provenance?.source;
  if (provenance?.contract_version !== STENOSIS_CONTRACT_VERSION || !date(provenance.created_at)
      || !text(provenance.method_id) || !text(provenance.method_version)
      || (provenance.checkpoint_sha256 != null && !hash(provenance.checkpoint_sha256))
      || source?.case_id !== job.case_id || source.image_reference !== "case-volume"
      || !uuid(source.parent_segmentation_result_id) || !hash(source.source_sha256)) fail();
  for (const field of ["started_at", "completed_at", "failed_at"]) if (job[field] !== null && !date(job[field])) fail();
  if (job.status === "running" && !date(job.started_at)) fail();
  if (job.status === "queued" && job.started_at !== null) fail();
  if (job.status === "completed" && (!date(job.started_at) || !date(job.completed_at) || !uuid(job.result_reference))) fail();
  if (job.status === "failed" && (!date(job.failed_at) || !failureCodes.includes(job.failure?.code) || !text(job.failure?.message))) fail();
  if (job.status !== "failed" && (job.failure !== null || job.failed_at !== null)) fail();
  if (job.status !== "completed" && (job.completed_at !== null || job.result_reference !== null)) fail();
  return job;
}

export function validateHistory(data, caseId) {
  if (!data || data.contract_version !== STENOSIS_CONTRACT_VERSION || data.case_id !== Number(caseId)
      || !positive(data.case_id) || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0
      || !positive(data.limit) || data.limit > 100 || !Number.isSafeInteger(data.offset) || data.offset < 0
      || data.items.length > data.limit || data.total < data.items.length
      || data.has_more !== (data.offset + data.items.length < data.total)) fail();
  const ids = new Set();
  for (const job of data.items) {
    validateJob(job, caseId);
    if (ids.has(job.analysis_id)) fail();
    ids.add(job.analysis_id);
  }
  return data;
}

function path(caseId) {
  if (!positive(Number(caseId))) throw new Error("Invalid case ID.");
  return `/cases/${Number(caseId)}/stenosis/analyses`;
}

function structuredError(error) {
  const detail = error.response?.data?.detail;
  if (detail?.contract_version === STENOSIS_CONTRACT_VERSION && text(detail.code) && text(detail.message)) {
    error.message = detail.message;
    error.code = detail.code;
  }
  return error;
}

export function createStenosisJobsApi(api) {
  const active = new Map();
  return {
    async history(caseId, { limit = 20, offset = 0, signal, status, start_date, end_date, method_id, method_version } = {}) {
      if (!positive(limit) || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid history pagination.");
      try {
        const filters=Object.fromEntries(Object.entries({status,start_date,end_date,method_id,method_version}).filter(([,value])=>value));
        const response = await api.get(path(caseId), { params: { limit, offset, ...filters }, signal });
        if (response.status !== 200) fail();
        const value = validateHistory(response.data, caseId);
        if (value.limit !== limit || value.offset !== offset) fail();
        return value;
      } catch (error) { throw structuredError(error); }
    },
    async job(caseId, analysisId, { signal } = {}) {
      if (!uuid(analysisId)) throw new Error("Invalid analysis ID.");
      const canonicalId = analysisId.toLowerCase();
      try {
        const response = await api.get(`${path(caseId)}/${canonicalId}`, { signal });
        if (response.status !== 200) fail();
        const job = validateJob(response.data, caseId);
        if (job.analysis_id !== canonicalId) fail();
        return job;
      } catch (error) { throw structuredError(error); }
    },
    start(caseId, source, key) {
      const endpoint = path(caseId);
      if (source?.case_id !== Number(caseId) || source.image_reference !== "case-volume"
          || !uuid(source.parent_segmentation_result_id) || !hash(source.source_sha256)
          || typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return Promise.reject(new Error("Select a current segmentation source and valid idempotency key."));
      const body = { contract_version: STENOSIS_CONTRACT_VERSION, source: {
        case_id: Number(caseId), image_reference: "case-volume", source_sha256: source.source_sha256,
        parent_segmentation_result_id: source.parent_segmentation_result_id.toLowerCase(),
      } };
      const identity = JSON.stringify(body), activeKey = `${endpoint}:${key}`;
      const previous = active.get(activeKey);
      if (previous) return previous.identity === identity ? previous.promise : Promise.reject(new Error("This active idempotency key is bound to another request."));
      const promise = Promise.resolve().then(() => api.post(endpoint, body, { headers: { "Idempotency-Key": key } }))
        .then(response => {
          if (![200, 202].includes(response.status)) fail();
          const job = validateJob(response.data, caseId);
          if (Object.keys(body.source).some(field => job.provenance.source[field] !== body.source[field])) fail();
          return { job, created: response.status === 202 };
        }).catch(error => { throw structuredError(error); }).finally(() => active.delete(activeKey));
      active.set(activeKey, { identity, promise });
      return promise;
    },
  };
}
