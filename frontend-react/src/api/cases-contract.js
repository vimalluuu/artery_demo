/**
 * cases-contract.js
 *
 * Adapter between the real backend CaseAPI and the React UI.
 *
 * Backend CaseResponse (after migration 0003_case_meta):
 *   { id: int, patient_id: int, case_code: str, study_type: str,
 *     status: str, image_path: str|null, created_at: datetime,
 *     modality: str|null, region: str|null, scan_date: str|null,
 *     age_years: int|null, sex: str|null, notes: str|null }
 *
 * UI case shape (what pages receive):
 *   { id, patientId, caseCode, studyType, status, hasImage, createdAt,
 *     modality, region, scanDate, age, gender, notes,
 *     // still not in backend — always null/[]:
 *     severity: null, confidence: null, createdBy: null, riskFactors: [], analyses: [] }
 *
 * ─── FIELD MAPPING TABLE ────────────────────────────────────────────────────
 * Backend field   UI field        Notes
 * id (int DB PK)  id              Numeric; used in route /cases/:id
 * case_code (str) caseCode        Human-readable label, e.g. "CASE-2026-001"
 *                                 NOT the same as the DB primary key id
 * patient_id      patientId       FK to patients table
 * study_type      studyType       Free-text; "Coronary Artery Analysis" etc.
 * status          status          Backend stores lowercase: 'pending'|'processing'|'complete'|'failed'
 *                                 Adapter title-cases to: 'Pending'|'Processing'|'Complete'|'Failed'
 *                                 UI StatusBadge components require title-case
 * image_path      hasImage        boolean (path is server-internal, not exposed)
 * created_at      createdAt       ISO datetime string
 * modality        modality        Now persisted: "CT Angiography"|"MRA"|"CTA"|"DSA"|"Ultrasound"|"Other"|null
 * region          region          Now persisted: "Coronary"|"Carotid"|"Renal"|"Peripheral"|"Cerebral"|"Aorta"|"Other"|null
 * scan_date       scanDate        Date string "YYYY-MM-DD" or null (backend returns Date, not datetime)
 * age_years       age             Integer 0-120 or null
 * sex             gender          "M"|"F"|"O" or null  (UI historically named this 'gender')
 * notes           notes           Free-text string or null
 *
 * Unsupported fields (absent from backend — reported honestly as null/[]):
 *   severity, confidence, createdBy, riskFactors, analyses
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Endpoints:
 *   POST  /api/v1/cases           { patient_id, case_code, study_type, modality?,
 *                                   region?, scan_date?, age_years?, sex?, notes? }
 *                                   → 201 CaseResponse                [Clinician, Admin]
 *   GET   /api/v1/cases           []CaseResponse                      [all roles]
 *   GET   /api/v1/cases/:id       CaseResponse                        [all roles]
 *   PATCH /api/v1/cases/:id       { study_type?, modality?, region?,
 *                                   scan_date?, age_years?, sex?, notes? }
 *                                   → CaseResponse (partial update)   [Clinician, Admin]
 *   POST  /api/v1/cases/:id/image multipart FormData { file }
 *                                   → CaseResponse                    [Clinician, Admin]
 *   GET   /api/v1/cases/:id/image/metadata  ImageMetadata             [all roles]
 *
 * RBAC summary (backend enforces; frontend only presents correct affordances):
 *   Clinician, Admin  → list, get, create, update, upload
 *   Researcher, DataScientist → list, get ONLY
 */

/**
 * Backend stores status as lowercase ('pending', 'processing', 'complete', 'failed').
 * The UI StatusBadge components expect title-case — this mapping normalises at the adapter boundary.
 */
const STATUS_MAP = {
  pending:    'Pending',
  processing: 'Processing',
  complete:   'Complete',
  failed:     'Failed',
};

/**
 * Convert one raw CaseResponse from the backend into the UI shape.
 * Fields that have no backend equivalent are set to null/[] explicitly.
 * They are NOT invented — see the field mapping table above.
 */
export function toCase(raw) {
  return {
    // ── Supported fields ──────────────────────────────────────────────────
    id:        raw.id,          // int DB PK — used in /cases/:id URL
    patientId: raw.patient_id,
    caseCode:  raw.case_code,   // human label, distinct from id
    studyType: raw.study_type,
    status:    STATUS_MAP[raw.status] ?? raw.status,
    hasImage:  raw.image_path != null,
    createdAt: raw.created_at,
    // ── Metadata fields (now persisted — null for pre-migration cases) ─────
    modality:  raw.modality  ?? null,
    region:    raw.region    ?? null,
    scanDate:  raw.scan_date ?? null,   // "YYYY-MM-DD" or null
    age:       raw.age_years ?? null,   // UI uses 'age', backend uses 'age_years'
    gender:    raw.sex       ?? null,   // UI uses 'gender', backend uses 'sex'
    notes:     raw.notes     ?? null,
    // ── Still unsupported (backend does not provide these yet) ────────────
    severity:   null,
    confidence: null,
    createdBy:  null,
    riskFactors: [],
    analyses:    [],   // No inference backend yet — analyses array is always empty
  };
}

/**
 * Serialize a "new case" form payload → backend CaseCreate JSON.
 * The UI form collects:
 *   patientId (int), caseCode (str), studyType (str),
 *   and optionally: modality, region, scanDate, age (→age_years), gender (→sex), notes
 *
 * Fields with empty / blank values are omitted (sent as null so backend stores null).
 */
export function fromCaseForm(form) {
  const payload = {
    patient_id: parseInt(form.patientId, 10),
    case_code:  form.caseCode.trim(),
    study_type: (form.studyType || 'Coronary Artery Analysis').trim(),
  };

  // Optional metadata — only include if non-empty
  if (form.modality)  payload.modality  = form.modality;
  if (form.region)    payload.region    = form.region;
  if (form.scanDate)  payload.scan_date = form.scanDate;  // "YYYY-MM-DD"
  if (form.age !== '' && form.age != null) {
    const parsed = parseInt(form.age, 10);
    if (!isNaN(parsed)) payload.age_years = parsed;
  }
  if (form.gender)    payload.sex       = form.gender;    // UI 'gender' → backend 'sex'
  if (form.notes && form.notes.trim()) payload.notes = form.notes.trim();

  return payload;
}

/**
 * Serialize a metadata update form → backend CaseUpdate JSON.
 * Only includes fields that are explicitly set (partial update).
 */
export function fromCaseUpdateForm(form) {
  const payload = {};
  if (form.studyType && form.studyType.trim()) payload.study_type = form.studyType.trim();
  if (form.modality)  payload.modality  = form.modality;
  if (form.region)    payload.region    = form.region;
  if (form.scanDate)  payload.scan_date = form.scanDate;
  if (form.age !== '' && form.age != null) {
    const parsed = parseInt(form.age, 10);
    if (!isNaN(parsed)) payload.age_years = parsed;
  }
  if (form.gender)  payload.sex   = form.gender;
  if (form.notes && form.notes.trim()) payload.notes = form.notes.trim();
  return payload;
}

export function createCasesApi(api) {
  return {
    /** List all cases the current user is authorized to see. */
    async list() {
      const { data } = await api.get('/cases');
      return data.map(toCase);
    },

    /** Get a single case by its integer DB id. */
    async get(id) {
      const { data } = await api.get(`/cases/${id}`);
      return toCase(data);
    },

    /**
     * Create a new case. Requires Clinician or Admin.
     * form: { patientId, caseCode, studyType, modality?, region?, scanDate?, age?, gender?, notes? }
     */
    async create(form) {
      const { data } = await api.post('/cases', fromCaseForm(form));
      return toCase(data);
    },

    /**
     * Partially update mutable case metadata. Requires Clinician or Admin.
     * form: { studyType?, modality?, region?, scanDate?, age?, gender?, notes? }
     * Only fields present in the form are sent.
     */
    async update(caseId, form) {
      const payload = fromCaseUpdateForm(form);
      if (Object.keys(payload).length === 0) {
        // Nothing to update — return current case without a request
        return this.get(caseId);
      }
      const { data } = await api.patch(`/cases/${caseId}`, payload);
      return toCase(data);
    },

    /**
     * Upload an image file for a case. Requires Clinician or Admin.
     * formData must be a FormData object with key "file".
     * Returns the updated case.
     */
    async upload(caseId, formData) {
      const { data } = await api.post(`/cases/${caseId}/image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return toCase(data);
    },

    /**
     * Retrieve image metadata for a case that has an uploaded image.
     * Returns the raw ImageMetadata object (case_id, case_code, filename,
     * format, width, height, channels, pixel_dtype, file_size_bytes).
     * Returns null if the case has no image yet.
     */
    async getImageMetadata(caseId) {
      try {
        const { data } = await api.get(`/cases/${caseId}/image/metadata`);
        return data;
      } catch (err) {
        if (err.response?.status === 404) return null;
        throw err;
      }
    },
  };
}
