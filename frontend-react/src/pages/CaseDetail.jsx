import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, Play, History, ChevronRight, CheckCircle, Clock, Loader, AlertTriangle, X } from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';

const STEPS = ['Uploaded', 'Preprocessing', 'Segmenting', 'Analysing', 'Complete'];

function StatusBadge({ status }) {
  const map = { Complete: 'badge-green', Processing: 'badge-blue', Pending: 'badge-yellow', Failed: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

function SeverityBadge({ sev }) {
  if (!sev) return null;
  const map = { Normal: 'badge-green', Mild: 'badge-yellow', Moderate: 'badge-orange', Severe: 'badge-red', Critical: 'badge-red' };
  return (
    <span className={`badge ${map[sev] || 'badge-gray'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
      <span className={`severity-dot severity-${sev.toLowerCase()}`} />
      {sev} Stenosis
    </span>
  );
}

export default function CaseDetail() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const fileRef      = useRef();
  const [caseData, setCaseData]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [file, setFile]           = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [toast, setToast]         = useState(null);

  useEffect(() => {
    casesApi.get(id)
      .then((d) => { setCaseData(d); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [id]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleFileDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0] || e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setUploadPct(0);
    // Simulate progress
    const interval = setInterval(() => setUploadPct((p) => Math.min(p + 18, 95)), 250);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await casesApi.upload(id, fd);
      clearInterval(interval); setUploadPct(100);
      setCaseData((c) => ({ ...c, status: 'Processing' }));
      showToast('Scan uploaded successfully!');
      setFile(null);
    } catch (err) {
      clearInterval(interval);
      showToast('Upload failed — please try again.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyse = async () => {
    setAnalysing(true);
    try {
      await casesApi.analyze(id);
      setCaseData((c) => ({ ...c, status: 'Complete', severity: 'Moderate', confidence: 91.3 }));
      showToast('Analysis complete!');
      setTimeout(() => navigate(`/cases/${id}/analysis/a-001`), 1200);
    } catch {
      showToast('Analysis failed.', 'error');
      setAnalysing(false);
    }
  };

  // Stepper state
  const stepIdx = caseData
    ? caseData.status === 'Pending'     ? -1
    : caseData.status === 'Processing'  ? 1
    : caseData.status === 'Complete'    ? 4
    : caseData.status === 'Failed'      ? -1 : -1
    : -1;

  if (loading) return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: '…' }]}>
      <div style={{ textAlign: 'center', paddingTop: 80, color: '#94a3b8' }}>Loading case…</div>
    </AppShell>
  );

  if (!caseData) return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Not found' }]}>
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={28} /></div>
        <div className="empty-title">Case not found</div>
        <div className="empty-sub">This case ID does not exist or you don't have access.</div>
        <button className="btn btn-primary" onClick={() => navigate('/cases')}>Back to cases</button>
      </div>
    </AppShell>
  );

  return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: caseData.id }]}>
      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={16} style={{ color: '#22c55e' }} /> : <AlertTriangle size={16} style={{ color: '#ef4444' }} />}
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
          <h1 className="page-title" style={{ fontFamily: 'monospace', fontSize: 26 }}>{caseData.id}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <StatusBadge status={caseData.status} />
            {caseData.severity && <SeverityBadge sev={caseData.severity} />}
          </div>
        </div>
        {caseData.status === 'Complete' && caseData.analyses.length > 0 && (
          <button className="btn btn-primary" onClick={() => navigate(`/cases/${id}/analysis/${caseData.analyses[0].id}`)}>
            View Analysis <ChevronRight size={15} />
          </button>
        )}
      </div>

      {/* Status stepper */}
      {caseData.status !== 'Pending' && caseData.status !== 'Failed' && (
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
              <div
                className={`dropzone${dragOver ? ' drag-over' : ''}`}
                id="scan-dropzone"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
                role="button" tabIndex={0}
                aria-label="Upload scan file"
                onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".nii,.nii.gz,.dcm,.png,.jpg" hidden onChange={handleFileDrop} />
                <div className="dropzone-icon">
                  <Upload size={26} />
                </div>
                {file ? (
                  <div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{file.name}</div>
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>{(file.size / 1e6).toFixed(1)} MB</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Drop your scan here or click to browse
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>NIfTI, DICOM, PNG/JPEG · Max 2 GB</div>
                  </div>
                )}
              </div>

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
                  disabled={!file || uploading}
                  onClick={handleUpload}
                >
                  {uploading ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</> : <><Upload size={15} /> Upload Scan</>}
                </button>

                {(caseData.status === 'Processing' || caseData.status === 'Pending') && (
                  <button id="start-analysis-btn" className="btn btn-secondary" disabled={analysing} onClick={handleAnalyse}>
                    {analysing ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Analysing…</> : <><Play size={15} /> Start Analysis</>}
                  </button>
                )}
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          </div>

          {/* Analysis history */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <History size={17} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                Analysis History
              </h2>
            </div>
            <div className="card-body">
              {caseData.analyses.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <div className="empty-title">No analyses yet</div>
                  <div className="empty-sub">Upload a scan and start an analysis to see results here.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {caseData.analyses.map((a) => (
                    <div key={a.id} style={{
                      padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                    onClick={() => navigate(`/cases/${id}/analysis/${a.id}`)}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{a.model}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{new Date(a.date).toLocaleString()}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {a.severity && <span className={`badge ${a.severity === 'Severe' ? 'badge-red' : a.severity === 'Moderate' ? 'badge-orange' : 'badge-yellow'}`}>{a.severity}</span>}
                        <ChevronRight size={16} style={{ color: '#94a3b8' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column — case info */}
        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card-header"><h2 className="card-title">Case Information</h2></div>
          <div className="card-body">
            {[
              { label: 'Case ID',    value: <code style={{ fontFamily: 'monospace', color: '#1d4ed8' }}>{caseData.id}</code> },
              { label: 'Modality',   value: caseData.modality },
              { label: 'Region',     value: caseData.region },
              { label: 'Scan Date',  value: caseData.scanDate },
              { label: 'Created by', value: caseData.createdBy },
              { label: 'Age',        value: caseData.age ? `${caseData.age} years` : '—' },
              { label: 'Gender',     value: caseData.gender || '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #f8fafc' }}>
                <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
              </div>
            ))}

            {caseData.riskFactors?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500, marginBottom: 6 }}>Risk Factors</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {caseData.riskFactors.map((r) => <span key={r} className="badge badge-gray" style={{ fontSize: 11 }}>{r}</span>)}
                </div>
              </div>
            )}

            {caseData.notes && (
              <div>
                <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500, marginBottom: 4 }}>Notes</div>
                <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                  {caseData.notes}
                </div>
              </div>
            )}

            {caseData.confidence && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: '#15803d', fontWeight: 700, marginBottom: 6 }}>Model Confidence</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="progress-track" style={{ flex: 1 }}>
                    <div className="progress-fill" style={{ width: `${caseData.confidence}%`, background: '#22c55e' }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{caseData.confidence}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
