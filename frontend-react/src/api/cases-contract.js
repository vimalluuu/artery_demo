/**
 * cases-contract.js
 *
 * Adapter between the real backend CaseAPI and the React UI.
 *
 * Backend CaseResponse:
 *   { id: int, patient_id: int, case_code: str, study_type: str,
 *     status: str, image_path: str|null, created_at: datetime }
 *
 * UI case shape (what pages receive):
 *   { id, patientId, caseCode, studyType, status, hasImage, createdAt,
 *     // These fields have NO backend equivalent — they are absent, not invented:
 *     modality: null, region: null, scanDate: null, severity: null,
 *     confidence: null, createdBy: null, age: null, gender: null,
 *     riskFactors: [], analyses: [], notes: null }
 *
 * ─── FIELD MAPPING TABLE ────────────────────────────────────────────────────
 * Backend field   UI field        Notes
 * id (int DB PK)  id              Numeric; used in route /cases/:id
 * case_code (str) caseCode        Human-readable label, e.g. "CASE-2026-001"
 *                                 NOT the same as the DB primary key id
 * patient_id      patientId       FK to patients table
 * study_type      studyType       Free-text; "CT Angiography" etc.
 * status          status          Backend stores lowercase: 'pending'|'processing'|'complete'|'failed'
 *                                 Adapter title-cases to: 'Pending'|'Processing'|'Complete'|'Failed'
 *                                 UI StatusBadge components require title-case
 * image_path      hasImage        boolean (path is server-internal, not exposed)
 * created_at      createdAt       ISO datetime string
 *
 * Unsupported fields (absent from backend, reported honestly as null/[]):
 *   modality, region, scanDate, severity, confidence, createdBy,
 *   age, gender, riskFactors, analyses, notes
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Endpoints:
 *   POST /api/v1/cases       { patient_id, case_code, study_type }  → 201 CaseResponse  [Clinician, Admin]
 *   GET  /api/v1/cases       []CaseResponse                                              [all roles]
 *   GET  /api/v1/cases/:id   CaseResponse                                                [all roles]
 *   POST /api/v1/cases/:id/image   multipart FormData { file }  → CaseResponse          [Clinician, Admin]
 *   GET  /api/v1/cases/:id/image/metadata  ImageMetadata                                 [all roles]
 *
 * RBAC summary (backend enforces; frontend only presents correct affordances):
 *   Clinician, Admin  → list, get, create, upload
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
    // ── Unsupported fields (backend does not provide these yet) ───────────
    modality:   null,
    region:     null,
    scanDate:   null,
    severity:   null,
    confidence: null,
    createdBy:  null,
    age:        null,
    gender:     null,
    riskFactors: [],
    analyses:    [],   // No inference backend yet — analyses array is always empty
    notes:       null,
  };
}

/**
 * Serialize a "new case" form payload → backend CaseCreate JSON.
 * The UI form collects:
 *   patientId (int), caseCode (str), studyType (str)
 * Additional UI-only fields (modality, region, scanDate, age, gender,
 * riskFactors, notes) have no backend CaseCreate field and are dropped here.
 */
export function fromCaseForm(form) {
  return {
    patient_id: parseInt(form.patientId, 10),
    case_code:  form.caseCode.trim(),
    study_type: (form.studyType || 'Coronary Artery Analysis').trim(),
  };
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
     * form: { patientId, caseCode, studyType }
     */
    async create(form) {
      const { data } = await api.post('/cases', fromCaseForm(form));
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
