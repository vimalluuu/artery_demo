import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Info, Loader } from 'lucide-react';
import AppShell from '../components/AppShell';
import { patientsApi } from '../api/patients';
import { casesApi } from '../api/cases';
import { useAuth } from '../context/AuthContext';
import { IMAGING_GUIDANCE } from '../constants/imaging-guidance';

/*
 * NewCase — Phase 2 real API integration
 *
 * Backend contract:
 *   1. POST /patients  { patient_code, display_name, notes? }   → PatientResponse { id, … }
 *   2. POST /cases     { patient_id, case_code, study_type }     → CaseResponse    { id, … }
 *   Redirect to /cases/:id (integer DB PK, not case_code)
 *
 * RBAC: both endpoints require Clinician or Admin.
 *       Researcher / DataScientist receive 403; the route is already
 *       guarded in App.jsx (roles={['Clinician','Admin']}).
 *
 * Fields not supported by the backend (modality, region, scanDate, age,
 * gender, riskFactors) are collected in the UI only as optional context
 * encoded into the case_code or study_type string. They are NOT sent as
 * separate JSON fields — the backend schema has no such columns.
 */

const STUDY_TYPES = [
  'Coronary Artery Analysis',
  'Carotid Artery Analysis',
  'Renal Artery Analysis',
  'Peripheral Artery Analysis',
  'Cerebral Vessel Analysis',
  'Aortic Analysis',
];

const MODALITY_OPTIONS = [
  '', 'CT Angiography', 'MRA', 'CTA', 'DSA', 'Ultrasound', 'Other',
];

const REGION_OPTIONS = [
  '', 'Coronary', 'Carotid', 'Renal', 'Peripheral', 'Cerebral', 'Aorta', 'Other',
];

export default function NewCase() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── Step 1: Patient selection / creation ───────────────────────────────────
  const [patients, setPatients]       = useState([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [patientsError, setPatientsError]     = useState('');
  const [createPatient, setCreatePatient]     = useState(false); // toggle new patient form

  // ── Step 2: Case creation form ─────────────────────────────────────────────
  const [form, setForm] = useState({
    patientId:    '',       // selected existing patient id (int)
    patientCode:  '',       // new patient: unique code e.g. PT-2026-001
    displayName:  '',       // new patient: de-identified display name
    patientNotes: '',       // new patient: optional notes
    caseCode:     '',       // e.g. CASE-2026-001
    studyType:    STUDY_TYPES[0],
    // Metadata fields (all optional — now persisted in migration 0003_case_meta)
    modality:  '',
    region:    '',
    scanDate:  '',
    age:       '',
    gender:    '',
    notes:     '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // ── Load existing patients list ────────────────────────────────────────────
  useEffect(() => {
    patientsApi.list()
      .then((list) => { setPatients(list); setPatientsLoading(false); })
      .catch((err) => {
        if (err.response?.status === 403) {
          setPatientsError('You do not have permission to access patient records.');
        } else {
          setPatientsError(err.message || 'Failed to load patients.');
        }
        setPatientsLoading(false);
      });
  }, []);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.caseCode.trim()) { setError('Case Code is required.'); return; }

    let patientId = form.patientId ? parseInt(form.patientId, 10) : null;

    // Validate: must either select existing or fill new patient form
    if (!patientId && !createPatient) {
      setError('Select an existing patient or choose "Register new patient".');
      return;
    }
    if (createPatient && (!form.patientCode.trim() || !form.displayName.trim())) {
      setError('Patient Code and Display Name are required for a new patient.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: create patient if needed
      if (createPatient) {
        const created = await patientsApi.create({
          patientCode:  form.patientCode,
          displayName:  form.displayName,
          notes:        form.patientNotes || null,
        });
        patientId = created.id;
      }

      // Step 2: create case — pass all metadata fields
      const newCase = await casesApi.create({
        patientId,
        caseCode:  form.caseCode,
        studyType: form.studyType,
        modality:  form.modality  || undefined,
        region:    form.region    || undefined,
        scanDate:  form.scanDate  || undefined,
        age:       form.age       || undefined,
        gender:    form.gender    || undefined,
        notes:     form.notes     || undefined,
      });

      // Navigate to the case detail using its integer DB PK
      navigate(`/cases/${newCase.id}`);
    } catch (err) {
      if (err.response?.status === 403) {
        setError('You do not have permission to create cases. Clinician or Admin role required.');
      } else if (err.response?.status === 409) {
        setError(err.message || 'A case or patient with that code already exists.');
      } else if (err.response?.status === 404) {
        setError('Selected patient no longer exists. Refresh and try again.');
      } else {
        setError(err.message || 'Failed to create case. Please try again.');
      }
      setLoading(false);
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'New Case' }]}>
      <div className="page-header">
        <div className="page-eyebrow">Cases</div>
        <h1 className="page-title">Create New Case</h1>
        <p className="page-subtitle">Register a de-identified imaging case and link it to a patient record.</p>
      </div>

      {/* Data privacy notice */}
      <div className="ai-disclaimer" style={{ marginBottom: 24 }}>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        <span>
          <strong>Privacy requirement:</strong> Do NOT enter real patient names, DOBs, NHS/hospital numbers, or
          any other directly-identifying information. De-identify all data before upload.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* Main form */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Case Information</h2>
          </div>
          <div className="card-body">
            <form id="new-case-form" onSubmit={submit}>
              {error && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                  color: '#dc2626', fontSize: 13, marginBottom: 18,
                }}>
                  <AlertCircle size={15} />{error}
                </div>
              )}

              {/* ── Patient section ──────────────────────────────────────── */}
              <p style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
                Patient Record
              </p>

              {patientsLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                  <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  Loading patients…
                </div>
              ) : patientsError ? (
                <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16, padding: '10px 14px', background: '#fef2f2', borderRadius: 10 }}>
                  {patientsError}
                </div>
              ) : (
                <>
                  {!createPatient ? (
                    <div className="form-group">
                      <label className="form-label" htmlFor="patientId">
                        Select existing patient
                      </label>
                      <select
                        id="patientId"
                        name="patientId"
                        className="form-select"
                        value={form.patientId}
                        onChange={handle}
                      >
                        <option value="">— Select patient —</option>
                        {patients.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.patientCode} — {p.displayName}
                          </option>
                        ))}
                      </select>
                      <p className="form-hint">
                        {patients.length === 0
                          ? 'No patients found. Register one below.'
                          : `${patients.length} patient${patients.length !== 1 ? 's' : ''} available.`}
                      </p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 6 }}
                        onClick={() => { setCreatePatient(true); setForm({ ...form, patientId: '' }); }}
                      >
                        + Register new patient instead
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 12, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>New patient record</span>
                        {patients.length > 0 && (
                          <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => setCreatePatient(false)}>
                            ← Choose existing
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" htmlFor="patientCode">Patient Code *</label>
                          <input id="patientCode" name="patientCode" className="form-input"
                            placeholder="e.g. PT-2026-001"
                            value={form.patientCode} onChange={handle} required={createPatient} />
                          <p className="form-hint">Unique de-identified code</p>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" htmlFor="displayName">Display Name *</label>
                          <input id="displayName" name="displayName" className="form-input"
                            placeholder="e.g. Patient A"
                            value={form.displayName} onChange={handle} required={createPatient} />
                          <p className="form-hint">No real names or DOBs</p>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
                        <label className="form-label" htmlFor="patientNotes">Notes (optional)</label>
                        <textarea id="patientNotes" name="patientNotes" className="form-textarea"
                          placeholder="Brief de-identified clinical context…"
                          value={form.patientNotes} onChange={handle} rows={2} />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="divider" />

              {/* ── Case details ─────────────────────────────────────────── */}
              <p style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
                Case Details
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="caseCode">Case Code *</label>
                  <input
                    id="caseCode" name="caseCode" className="form-input"
                    placeholder="e.g. CASE-2026-001"
                    value={form.caseCode} onChange={handle}
                    minLength={2} maxLength={50} required
                  />
                  <p className="form-hint">Unique reference for this imaging case</p>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="studyType">Study Type *</label>
                  <select id="studyType" name="studyType" className="form-select" value={form.studyType} onChange={handle}>
                    {STUDY_TYPES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* ── Optional metadata ─────────────────────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="modality">Modality</label>
                  <select id="modality" name="modality" className="form-select" value={form.modality} onChange={handle}>
                    {MODALITY_OPTIONS.map((m) => <option key={m} value={m}>{m || '— Select modality —'}</option>)}
                  </select>
                  <p className="form-hint">Imaging technology used</p>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="region">Region</label>
                  <select id="region" name="region" className="form-select" value={form.region} onChange={handle}>
                    {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r || '— Select region —'}</option>)}
                  </select>
                  <p className="form-hint">Anatomical region of interest</p>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="scanDate">Scan Date</label>
                  <input
                    id="scanDate" name="scanDate" type="date"
                    className="form-input"
                    value={form.scanDate} onChange={handle}
                  />
                  <p className="form-hint">Date the scan was acquired</p>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="age">Age at Scan (years)</label>
                  <input
                    id="age" name="age" type="number"
                    className="form-input"
                    placeholder="e.g. 58"
                    min={0} max={120}
                    value={form.age} onChange={handle}
                  />
                  <p className="form-hint">De-identified whole years</p>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="gender">Biological Sex</label>
                  <select id="gender" name="gender" className="form-select" value={form.gender} onChange={handle}>
                    <option value="">— Not stated —</option>
                    <option value="M">M — Male</option>
                    <option value="F">F — Female</option>
                    <option value="O">O — Other / not stated</option>
                  </select>
                  <p className="form-hint">De-identified sex code stored as M/F/O</p>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 4 }}>
                <label className="form-label" htmlFor="notes">Clinical Notes (optional)</label>
                <textarea
                  id="notes" name="notes" className="form-textarea"
                  placeholder="Brief de-identified clinical context (max 2000 chars)…"
                  value={form.notes} onChange={handle}
                  rows={3} maxLength={2000}
                />
                <p className="form-hint">Do not include any directly identifying information.</p>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/cases')}>
                  Cancel
                </button>
                <button
                  id="create-case-submit-btn"
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || patientsLoading}
                >
                  {loading
                    ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
                    : 'Create Case →'}
                </button>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </form>
          </div>
        </div>

        {/* Help sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header"><h2 className="card-title">What happens next?</h2></div>
            <div className="card-body">
              {[
                ['1. Select / register patient', 'Link case to a de-identified patient record.'],
                ['2. Enter case details', 'Assign a unique code, study type, and optional metadata.'],
                ['3. Create case', 'The case record is saved to the database.'],
                ['4. Upload scan or volume', 'Upload a 2D scan (PNG, JPG/JPEG, TIFF) or NIfTI volume (.nii, .nii.gz) on the case page.'],
                ['5. Await analysis', 'Model inference is not yet available.'],
              ].map(([step, desc]) => (
                <div key={step} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{step}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ borderColor: '#e2e8f0' }}>
            <div className="card-header" style={{ paddingBottom: 8 }}>
              <h2 className="card-title" style={{ fontSize: 14 }}>
                <Info size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: '#2563eb' }} />
                Supported Imaging Formats
              </h2>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12.5, paddingTop: 4 }}>
              <div>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>2D Image Uploads</div>
                <div style={{ color: '#64748b', marginTop: 2 }}>
                  {IMAGING_GUIDANCE.twoDimensional.description}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, color: '#7c3aed' }}>Volumetric Uploads (NIfTI)</div>
                <div style={{ color: '#64748b', marginTop: 2 }}>
                  {IMAGING_GUIDANCE.volumetric.description}
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>
                  {IMAGING_GUIDANCE.volumetric.metadataDisclaimer}
                </div>
              </div>

              <div style={{ padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e' }}>
                <div style={{ fontWeight: 700 }}>DICOM</div>
                <div style={{ marginTop: 2 }}>
                  {IMAGING_GUIDANCE.unsupported.dicom.status} {IMAGING_GUIDANCE.unsupported.dicom.action}
                </div>
              </div>
            </div>
          </div>

          {user && (
            <div className="card" style={{ borderColor: '#bfdbfe', background: '#eff6ff' }}>
              <div className="card-body" style={{ fontSize: 12.5, color: '#1e40af' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Your role: {user.role}</div>
                {user.role === 'Clinician' || user.role === 'Admin'
                  ? <div>You can create patients, create cases, and upload 2D scans and NIfTI volumes.</div>
                  : <div>Your role cannot create patients or cases. Contact an Admin or Clinician.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
