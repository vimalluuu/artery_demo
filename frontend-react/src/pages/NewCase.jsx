import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Calendar, Info } from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';

const MODALITIES = ['CT Angiography', 'MRA', 'CTA', 'DSA', 'Ultrasound'];
const REGIONS    = ['Coronary', 'Carotid', 'Renal', 'Peripheral', 'Cerebral', 'Aorta'];
const RISKS      = ['Hypertension', 'Diabetes', 'Smoking', 'Hyperlipidaemia', 'Obesity', 'Family History'];

export default function NewCase() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    modality: 'CT Angiography',
    region: 'Coronary',
    scanDate: '',
    notes: '',
    age: '',
    gender: '',
    riskFactors: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const toggleRisk = (r) => setForm((f) => ({
    ...f,
    riskFactors: f.riskFactors.includes(r)
      ? f.riskFactors.filter((x) => x !== r)
      : [...f.riskFactors, r],
  }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.scanDate) { setError('Scan date is required.'); return; }
    setError(''); setLoading(true);
    try {
      const created = await casesApi.create(form);
      navigate(`/cases/${created.id}`);
    } catch (err) {
      setError(err.message || 'Failed to create case.');
      setLoading(false);
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'New Case' }]}>
      <div className="page-header">
        <div className="page-eyebrow">Cases</div>
        <h1 className="page-title">Create New Case</h1>
        <p className="page-subtitle">Enter de-identified scan information to register a new imaging case.</p>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="modality">Modality *</label>
                  <select id="modality" name="modality" className="form-select" value={form.modality} onChange={handle}>
                    {MODALITIES.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="region">Anatomical Region *</label>
                  <select id="region" name="region" className="form-select" value={form.region} onChange={handle}>
                    {REGIONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="scanDate">
                  <Calendar size={14} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
                  Scan Date *
                </label>
                <input id="scanDate" name="scanDate" type="date" className="form-input"
                  value={form.scanDate} onChange={handle} max={new Date().toISOString().slice(0,10)} required />
              </div>

              <div className="divider" />

              <p style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
                De-identified Demographics (optional)
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="age">Age (years)</label>
                  <input id="age" name="age" type="number" className="form-input"
                    placeholder="e.g. 58" min={0} max={120} value={form.age} onChange={handle} />
                  <p className="form-hint">Age in years — no exact DOB</p>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="gender">Gender</label>
                  <select id="gender" name="gender" className="form-select" value={form.gender} onChange={handle}>
                    <option value="">Select…</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other / Not stated</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Risk Factors</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {RISKS.map((r) => (
                    <button
                      key={r} type="button"
                      id={`risk-${r.replace(/\s+/g, '-').toLowerCase()}`}
                      onClick={() => toggleRisk(r)}
                      style={{
                        padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: '1.5px solid',
                        background: form.riskFactors.includes(r) ? '#dbeafe' : '#f8fafc',
                        borderColor: form.riskFactors.includes(r) ? '#3b82f6' : '#e2e8f0',
                        color: form.riskFactors.includes(r) ? '#1d4ed8' : '#475569',
                        transition: 'all 0.15s',
                      }}
                    >
                      {form.riskFactors.includes(r) ? '✓ ' : ''}{r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="notes">Clinical Notes</label>
                <textarea id="notes" name="notes" className="form-textarea"
                  placeholder="Brief clinical context — no patient-identifiable information…"
                  value={form.notes} onChange={handle} rows={4} />
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/cases')}>
                  Cancel
                </button>
                <button id="create-case-submit-btn" type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Creating…' : 'Create Case & Upload Scan →'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Help sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header"><h2 className="card-title">What happens next?</h2></div>
            <div className="card-body">
              {[
                ['1. Create case', 'Register the case metadata here.'],
                ['2. Upload scan', 'Drop your NIfTI or DICOM file.'],
                ['3. Run analysis', 'Click "Start Analysis" to process.'],
                ['4. Review results', 'See segmentation, mask, and findings.'],
              ].map(([step, desc]) => (
                <div key={step} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{step}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
            <div className="card-body" style={{ display: 'flex', gap: 10, fontSize: 12.5, color: '#92400e' }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Supported formats</div>
                <div>NIfTI (.nii, .nii.gz), DICOM (.dcm), PNG/JPEG slices.</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>Max file size</div>
                <div>2 GB per upload.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
