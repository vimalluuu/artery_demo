import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, History, CheckCircle, Loader, AlertTriangle, X, ImageIcon, Info } from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';
import { useAuth } from '../context/AuthContext';

/*
 * CaseDetail — Phase 2 real API integration
 *
 * The :id URL parameter is the integer DB PK (not case_code).
 * Backend GET /cases/:id  →  CaseResponse { id, patient_id, case_code, study_type, status, image_path, created_at }
 *
 * Image upload:
 *   POST /cases/:id/image   multipart FormData { file }   → updated CaseResponse
 *   Allowed formats: .png .jpg .jpeg .tif .tiff  (not DICOM/NIfTI — backend 415)
 *   Max size: 20 MB. Max dimension: 8192 px.
 *
 * RBAC:
 *   - GET  /cases/:id  — all authenticated roles
 *   - POST /cases/:id/image — Clinician, Admin only
 *   - Analysis ("Start Analysis") is NOT connected to any backend endpoint.
 *     The button is disabled and labelled clearly.
 *
 * Fields not supported by backend (severity, confidence, analyses, createdBy,
 * modality, region, scanDate, age, gender, riskFactors, notes) display as "—".
 */

function StatusBadge({ status }) {
  const map = { Complete: 'badge-green', Processing: 'badge-blue', Pending: 'badge-yellow', Failed: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

const STEPS = ['Uploaded', 'Preprocessing', 'Segmenting', 'Analysing', 'Complete'];

export default function CaseDetail() {
  const { id }       = useParams();  // integer DB PK from URL
  const navigate     = useNavigate();
  const { user }     = useAuth();
  const fileRef      = useRef();

  const [caseData, setCaseData]     = useState(null);
  const [imageMeta, setImageMeta]   = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState('');
  const [uploading, setUploading]   = useState(false);
  const [uploadPct, setUploadPct]   = useState(0);
  const [dragOver, setDragOver]     = useState(false);
  const [file, setFile]             = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [toast, setToast]           = useState(null);

  const canWrite = user && (user.role === 'Clinician' || user.role === 'Admin');

  // ── Load case ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true); setLoadError('');
    casesApi.get(id)
      .then((d) => { setCaseData(d); setLoading(false); })
      .catch((err) => {
        setLoading(false);
        if (err.response?.status === 404) {
          setLoadError('not_found');
        } else if (err.response?.status === 403) {
          setLoadError('forbidden');
        } else {
          setLoadError(err.message || 'Failed to load case.');
        }
      });
  }, [id]);

  // ── Load image metadata when case has an image ─────────────────────────────
  useEffect(() => {
    if (!caseData?.hasImage) return;
    setMetaLoading(true);
    casesApi.getImageMetadata(id)
      .then((meta) => { setImageMeta(meta); setMetaLoading(false); })
      .catch(() => setMetaLoading(false));
  }, [caseData?.hasImage, id]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleFileDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0] || e.target.files?.[0];
    if (f) { setFile(f); setUploadError(''); }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setUploadPct(0); setUploadError('');

    // Simulate progress bar (real upload is a single XHR via Axios)
    const interval = setInterval(() => setUploadPct((p) => Math.min(p + 14, 90)), 200);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const updated = await casesApi.upload(id, fd);
      clearInterval(interval); setUploadPct(100);
      setCaseData(updated);
      setFile(null);
      showToast('Scan uploaded successfully!');
      // Refresh image metadata
      setMetaLoading(true);
      casesApi.getImageMetadata(id)
        .then((meta) => { setImageMeta(meta); setMetaLoading(false); })
        .catch(() => setMetaLoading(false));
    } catch (err) {
      clearInterval(interval); setUploadPct(0);
      const status = err.response?.status;
      if (status === 403) {
        setUploadError('You do not have permission to upload images. Clinician or Admin required.');
      } else if (status === 415) {
        setUploadError('Unsupported file type. Upload PNG, JPEG, or TIFF.');
      } else if (status === 413) {
        setUploadError('File exceeds the 20 MB limit.');
      } else if (status === 400) {
        setUploadError(err.message || 'Invalid image file.');
      } else {
        setUploadError(err.message || 'Upload failed — please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  // Stepper state driven by real status
  const stepIdx =
    caseData?.status === 'Processing' ? 1
    : caseData?.status === 'Complete' ? 4
    : -1;

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: '…' }]}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10, color: '#64748b' }}>
        <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading case…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </AppShell>
  );

  if (loadError === 'not_found') return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Not found' }]}>
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={28} /></div>
        <div className="empty-title">Case not found</div>
        <div className="empty-sub">Case #{id} does not exist or you don't have access.</div>
        <button className="btn btn-primary" onClick={() => navigate('/cases')}>Back to cases</button>
      </div>
    </AppShell>
  );

  if (loadError === 'forbidden') return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Access denied' }]}>
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={28} /></div>
        <div className="empty-title">Access denied</div>
        <div className="empty-sub">Your role does not permit access to this case.</div>
        <button className="btn btn-primary" onClick={() => navigate('/cases')}>Back to cases</button>
      </div>
    </AppShell>
  );

  if (loadError) return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Error' }]}>
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={28} /></div>
        <div className="empty-title">Failed to load case</div>
        <div className="empty-sub">{loadError}</div>
        <button className="btn btn-primary" onClick={() => navigate('/cases')}>Back to cases</button>
      </div>
    </AppShell>
  );

  return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: caseData.caseCode || `Case #${caseData.id}` }]}>
      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.type === 'success'
              ? <CheckCircle size={16} style={{ color: '#22c55e' }} />
              : <AlertTriangle size={16} style={{ color: '#ef4444' }} />}
            {toast.msg}
            <button onClick={() => setToast(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Case Detail</div>
          <h1 className="page-title" style={{ fontFamily: 'monospace', fontSize: 26 }}>
            {caseData.caseCode || `Case #${caseData.id}`}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <StatusBadge status={caseData.status} />
            {caseData.hasImage && (
              <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ImageIcon size={11} /> Image uploaded
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Status stepper */}
      {stepIdx >= 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-body">
            <div className="stepper">
              {STEPS.map((step, i) => (
                <div key={step} className={`step ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}`}>
                  <div className="step-dot">
                    {i < stepIdx ? <CheckCircle size={14} /> : i + 1}
                  </div>
                  <span className="step-label">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Upload zone */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Upload size={17} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                Scan Upload
              </h2>
            </div>
            <div className="card-body">
              {!canWrite && (
                <div style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 14px',
                  background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10,
                  fontSize: 13, color: '#92400e', marginBottom: 16,
                }}>
                  <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Image upload requires Clinician or Admin role.
                </div>
              )}

              <div
                className={`dropzone${dragOver ? ' drag-over' : ''}${!canWrite ? ' disabled' : ''}`}
                id="scan-dropzone"
                onDragOver={(e) => { if (!canWrite) return; e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={canWrite ? handleFileDrop : undefined}
                onClick={() => canWrite && fileRef.current?.click()}
                role="button" tabIndex={canWrite ? 0 : -1}
                aria-label="Upload scan file"
                aria-disabled={!canWrite}
                onKeyDown={(e) => e.key === 'Enter' && canWrite && fileRef.current?.click()}
                style={{ cursor: canWrite ? 'pointer' : 'default', opacity: canWrite ? 1 : 0.6 }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.tif,.tiff"
                  hidden
                  disabled={!canWrite}
                  onChange={handleFileDrop}
                />
                <div className="dropzone-icon"><Upload size={26} /></div>
                {file ? (
                  <div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{file.name}</div>
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>{(file.size / 1e6).toFixed(1)} MB</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      {canWrite ? 'Drop your scan here or click to browse' : 'Upload not permitted for your role'}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>PNG, JPEG, TIFF · Max 20 MB · 8192 px</div>
                  </div>
                )}
              </div>

              {uploadError && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                  color: '#dc2626', fontSize: 13, marginTop: 12,
                }}>
                  <AlertTriangle size={14} />{uploadError}
                </div>
              )}

              {uploading && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                    <span>Uploading…</span><span>{uploadPct}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${uploadPct}%`, background: 'var(--primary)' }} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  id="upload-btn"
                  className="btn btn-primary"
                  disabled={!file || uploading || !canWrite}
                  onClick={handleUpload}
                >
                  {uploading
                    ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</>
                    : <><Upload size={15} /> Upload Scan</>}
                </button>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          </div>

          {/* Image metadata panel */}
          {caseData.hasImage && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <ImageIcon size={17} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                  Image Metadata
                </h2>
              </div>
              <div className="card-body">
                {metaLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}>
                    <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
                  </div>
                ) : imageMeta ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                    {[
                      ['Filename',   imageMeta.filename],
                      ['Format',     imageMeta.format],
                      ['Dimensions', `${imageMeta.width} × ${imageMeta.height} px`],
                      ['Channels',   imageMeta.channels],
                      ['Pixel type', imageMeta.pixel_dtype],
                      ['File size',  `${(imageMeta.file_size_bytes / 1024).toFixed(1)} KB`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                        <div style={{ color: '#0f172a', fontWeight: 600 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>Image metadata unavailable.</div>
                )}
              </div>
            </div>
          )}

          {/* Analysis history — disabled notice */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <History size={17} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                Analysis History
              </h2>
            </div>
            <div className="card-body">
              <div style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '14px 16px',
                background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10,
                fontSize: 13, color: '#92400e',
              }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>Model inference not yet available.</strong><br />
                  The VascuNet analysis backend has not been implemented.
                  Analysis history will appear here once the inference pipeline is connected.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — case info */}
        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card-header"><h2 className="card-title">Case Information</h2></div>
          <div className="card-body">
            {[
              { label: 'DB Case ID',   value: <code style={{ fontFamily: 'monospace', color: '#1d4ed8' }}>#{caseData.id}</code> },
              { label: 'Case Code',    value: caseData.caseCode },
              { label: 'Study Type',   value: caseData.studyType },
              { label: 'Modality',     value: caseData.modality  || '—' },
              { label: 'Region',       value: caseData.region    || '—' },
              { label: 'Scan Date',    value: caseData.scanDate  || '—' },
              { label: 'Age at Scan',  value: caseData.age != null ? `${caseData.age} yr` : '—' },
              { label: 'Sex',          value: caseData.gender
                ? ({ M: 'Male', F: 'Female', O: 'Other/NS' }[caseData.gender] ?? caseData.gender)
                : '—' },
              { label: 'Patient ID',   value: `Patient #${caseData.patientId}` },
              { label: 'Created',      value: new Date(caseData.createdAt).toLocaleString() },
              { label: 'Status',       value: <StatusBadge status={caseData.status} /> },
              { label: 'Image',        value: caseData.hasImage ? '✓ Uploaded' : '— Not yet uploaded' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #f8fafc' }}>
                <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
              </div>
            ))}

            {/* Notes */}
            {caseData.notes && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Notes</div>
                {caseData.notes}
              </div>
            )}
            {/* Unsupported fields notice */}
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
              <strong>Still not in backend:</strong><br />
              Severity, confidence, analysis history, risk factors, and createdBy
              are not stored by the current backend schema.
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
