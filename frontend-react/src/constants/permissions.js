import policy from "./access-policy.json" with { type: "json" };

// Backend tests verify this policy against the actual Python enum and groups.
export const ROLES = Object.freeze(policy.roles);
export const CASE_READERS = Object.freeze(policy.caseReaders);
export const CLINICAL_WRITERS = Object.freeze(policy.clinicalWriters);
export const RESEARCH_READERS = Object.freeze(policy.researchReaders);
export const ADMINISTRATORS = Object.freeze(policy.administrators);
export const REGISTRATION_ROLES = Object.freeze(policy.publicRegistration);
