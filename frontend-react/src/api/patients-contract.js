/**
 * patients-contract.js
 *
 * Adapter between the real backend PatientAPI and the React UI.
 *
 * Backend PatientResponse:
 *   { id: int, patient_code: str, display_name: str, notes: str|null, created_at: datetime }
 *
 * UI patient shape (what pages receive):
 *   { id, patientCode, displayName, notes, createdAt }
 *
 * Endpoints (all require Clinician or Admin — backend enforces CLINICAL_WRITERS):
 *   POST /api/v1/patients            { patient_code, display_name, notes? }  → 201 PatientResponse
 *   GET  /api/v1/patients            []PatientResponse
 */

/** Convert one raw PatientResponse from the backend into the UI shape. */
export function toPatient(raw) {
  return {
    id:          raw.id,
    patientCode: raw.patient_code,
    displayName: raw.display_name,
    notes:       raw.notes ?? null,
    createdAt:   raw.created_at,
  };
}

/** Serialize a UI create-patient form payload → backend PatientCreate JSON. */
export function fromPatientForm(form) {
  return {
    patient_code: form.patientCode.trim(),
    display_name: form.displayName.trim(),
    notes:        form.notes?.trim() || null,
  };
}

export function createPatientsApi(api) {
  return {
    /** Create a new patient record. Throws on 409 (duplicate code) or 403 (wrong role). */
    async create(form) {
      const { data } = await api.post('/patients', fromPatientForm(form));
      return toPatient(data);
    },

    /** List all patients. Requires Clinician or Admin. */
    async list() {
      const { data } = await api.get('/patients');
      return data.map(toPatient);
    },
  };
}
