/**
 * cases-contract.js
 *
 * Adapter between the real backend CaseAPI and the React UI.
 *
 * Backend CaseResponse (after migration 0004_volume_ingestion):
 *   { id, patient_id, case_code, study_type, status,
 *     image_path, volume_path, created_at,
 *     modality, region, scan_date, age_years, sex, notes }
 *
 * UI case shape:
 *   { id, patientId, caseCode, studyType, status,
 *     hasImage, hasVolume, volumePath, createdAt,
 *     modality, region, scanDate, age, gender, notes,
 *     severity: null, confidence: null, createdBy: null,
 *     riskFactors: [], analyses: [] }
 *
 * ─── FIELD MAPPING TABLE ────────────────────────────────────────────────────
 * Backend field    UI field         Notes
 * id (int DB PK)   id               Numeric; used in route /cases/:id
 * case_code (str)  caseCode         Human-readable label
 * patient_id       patientId        FK to patients table
 * study_type       studyType        Free-text
 * status           status           Backend lowercase → adapter title-cases
 * image_path       hasImage         boolean (path is server-internal)
 * volume_path      volumePath/      Relative path (server-internal); bool
 *                  hasVolume        derived from volume_path != null
 * created_at       createdAt        ISO datetime string
 * modality         modality         Persisted since migration 0003
 * region           region           Persisted since migration 0003
 * scan_date        scanDate         Date string "YYYY-MM-DD" or null
 * age_years        age              Integer 0-120 or null
 * sex              gender           "M"|"F"|"O" or null
 * notes            notes            Free-text string or null
 *
 * Unsupported fields (absent from backend):
 *   severity, confidence, createdBy, riskFactors, analyses
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Endpoints:
 *   POST  /api/v1/cases                   → 201 CaseResponse  [Clinician, Admin]
 *   GET   /api/v1/cases                   []CaseResponse      [all roles]
 *   GET   /api/v1/cases/:id              CaseResponse         [all roles]
 *   PATCH /api/v1/cases/:id              CaseResponse         [Clinician, Admin]
 *   POST  /api/v1/cases/:id/image        CaseResponse         [Clinician, Admin]
 *   GET   /api/v1/cases/:id/image/metadata  ImageMetadata     [all roles]
 *   POST  /api/v1/cases/:id/volume       CaseResponse         [Clinician, Admin]
 *   GET   /api/v1/cases/:id/volume/metadata  VolumeMetadata   [all roles]
 *
 * RBAC summary (backend enforces; frontend only shows correct affordances):
 *   Clinician, Admin  → list, get, create, update, image upload, volume upload
 *   Researcher, DataScientist → list, get, metadata reads ONLY
 */

/**
 * Backend stores status as lowercase ('pending', 'processing', 'complete', 'failed').
 * The UI StatusBadge components expect title-case — this mapping normalises at the adapter boundary.
 */
const STATUS_MAP = {
  pending: "Pending",
  processing: "Processing",
  complete: "Complete",
  failed: "Failed",
};

/**
 * Convert one raw CaseResponse from the backend into the UI shape.
 * Fields that have no backend equivalent are set to null/[] explicitly.
 * They are NOT invented — see the field mapping table above.
 */
export function toCase(raw) {
  return {
    // ── Supported fields ──────────────────────────────────────────────────
    id: raw.id,
    patientId: raw.patient_id,
    caseCode: raw.case_code,
    studyType: raw.study_type,
    status: STATUS_MAP[raw.status] ?? raw.status,
    hasImage: raw.image_path != null,
    // ── Volume fields (added in migration 0004_volume_ingestion) ──────────
    hasVolume: raw.volume_path != null,
    volumePath: raw.volume_path ?? null, // server-internal relative path
    createdAt: raw.created_at,
    // ── Metadata fields (persisted since migration 0003_case_meta) ────────
    modality: raw.modality ?? null,
    region: raw.region ?? null,
    scanDate: raw.scan_date ?? null,
    age: raw.age_years ?? null,
    gender: raw.sex ?? null,
    notes: raw.notes ?? null,
    // ── Still unsupported (backend does not provide these yet) ────────────
    severity: null,
    confidence: null,
    createdBy: null,
    riskFactors: [],
    analyses: [], // No inference backend yet — analyses array is always empty
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
    case_code: form.caseCode.trim(),
    study_type: (form.studyType || "Coronary Artery Analysis").trim(),
  };

  // Optional metadata — only include if non-empty
  if (form.modality) payload.modality = form.modality;
  if (form.region) payload.region = form.region;
  if (form.scanDate) payload.scan_date = form.scanDate; // "YYYY-MM-DD"
  if (form.age !== "" && form.age != null) {
    const parsed = parseInt(form.age, 10);
    if (!isNaN(parsed)) payload.age_years = parsed;
  }
  if (form.gender) payload.sex = form.gender; // UI 'gender' → backend 'sex'
  if (form.notes && form.notes.trim()) payload.notes = form.notes.trim();

  return payload;
}

/**
 * Serialize a metadata update form → backend CaseUpdate JSON.
 * Only includes fields that are explicitly set (partial update).
 */
export function fromCaseUpdateForm(form) {
  const payload = {};
  if (form.studyType && form.studyType.trim())
    payload.study_type = form.studyType.trim();
  if (form.modality) payload.modality = form.modality;
  if (form.region) payload.region = form.region;
  if (form.scanDate) payload.scan_date = form.scanDate;
  if (form.age !== "" && form.age != null) {
    const parsed = parseInt(form.age, 10);
    if (!isNaN(parsed)) payload.age_years = parsed;
  }
  if (form.gender) payload.sex = form.gender;
  if (form.notes && form.notes.trim()) payload.notes = form.notes.trim();
  return payload;
}

export function createCasesApi(api) {
  return {
    /** List all cases the current user is authorized to see. */
    async list() {
      const { data } = await api.get("/cases");
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
      const { data } = await api.post("/cases", fromCaseForm(form));
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
    async upload(caseId, formData, onProgress, signal) {
      const { data } = await api.post(`/cases/${caseId}/image`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        signal,
        onUploadProgress: (evt) => {
          if (onProgress && evt.total)
            onProgress(Math.round((evt.loaded * 100) / evt.total));
        },
      });
      return toCase(data);
    },

    /**
     * Retrieve image metadata for a case that has an uploaded 2D image.
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

    /**
     * Retrieve volume metadata for a case that has an uploaded NIfTI volume.
     * Returns the VolumeMetadata object or null if the case has no volume.
     */
    async getVolumeMetadata(caseId) {
      try {
        const { data } = await api.get(`/cases/${caseId}/volume/metadata`);
        return data;
      } catch (err) {
        if (err.response?.status === 404) return null;
        throw err;
      }
    },

    /**
     * Upload a NIfTI volume file for a case. Requires Clinician or Admin.
     * formData must be a FormData object with key "file".
     * Accepted extensions: .nii, .nii.gz
     * Returns the updated CaseResponse (with has_volume=true).
     */
    async uploadVolume(caseId, formData, onProgress, signal) {
      const { data } = await api.post(`/cases/${caseId}/volume`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        signal,
        onUploadProgress: (evt) => {
          if (onProgress && evt.total) {
            onProgress(Math.round((evt.loaded * 100) / evt.total));
          }
        },
      });
      return toCase(data);
    },
  };
}
