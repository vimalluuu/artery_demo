export const STENOSIS_CONTRACT_VERSION = "1.0";
export const CAPABILITY_IDS = Object.freeze([
  "stenosis_detection", "candidate_region_extraction", "stenosis_localization",
  "vessel_diameter_measurement", "percentage_narrowing", "severity_classification",
  "explainability", "stenosis_visualization", "stenosis_reporting",
]);
const statuses = new Set(["available", "unavailable", "not_integrated", "disabled"]);
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 1000;
const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export class StenosisContractError extends Error {
  constructor(message) { super(message); this.name = "StenosisContractError"; }
}

export function validateCapabilities(data) {
  if (!object(data) || data.contract_version !== STENOSIS_CONTRACT_VERSION) {
    throw new StenosisContractError("Unsupported or missing stenosis contract version. Capability information could not be verified.");
  }
  const invalid = () => { throw new StenosisContractError("Malformed stenosis capability response. No analysis availability was assumed."); };
  if (!Array.isArray(data.capabilities) || data.capabilities.length !== CAPABILITY_IDS.length) invalid();
  const seen = new Set();
  for (const capability of data.capabilities) {
    if (!object(capability) || capability.contract_version !== data.contract_version
        || !CAPABILITY_IDS.includes(capability.id) || seen.has(capability.id)
        || !text(capability.display_name) || !text(capability.availability_reason)
        || !statuses.has(capability.status) || typeof capability.execution_permitted !== "boolean") invalid();
    const method = capability.method_id;
    const version = capability.method_version;
    // Optional fields may be omitted or null, matching Pydantic defaults.
    if ((method == null) !== (version == null) || (method != null && (!identifier(method) || !identifier(version)))) invalid();
    if (capability.execution_permitted && capability.status !== "available") invalid();
    if (capability.status === "available" && method == null) invalid();
    seen.add(capability.id);
  }
  return data;
}

export function createStenosisApi(api) {
  return {
    async capabilities({ signal } = {}) {
      const response = await api.get("/stenosis/capabilities", signal ? { signal } : undefined);
      if (response.status !== 200) throw new StenosisContractError("The server did not confirm capability retrieval.");
      return validateCapabilities(response.data);
    },
  };
}

export function capabilityError(error) {
  if (error.response?.status === 401) return "Your session expired. Sign in again to retrieve capability information.";
  if (error.response?.status === 403) return "Your account does not have access to capability information.";
  if (error instanceof StenosisContractError) return error.message;
  return "Capability information could not be retrieved. Check your connection and retry; analysis availability is unknown.";
}
