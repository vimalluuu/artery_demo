import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import {
  ZoomIn, ZoomOut, RotateCcw, Layers, Eye, EyeOff,
  AlertTriangle, Info, ArrowUpRight, ChevronLeft, ChevronRight,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const SEV_BADGE = {
  Normal:   'badge-green', Mild: 'badge-yellow',
  Moderate: 'badge-orange', Severe: 'badge-red', Critical: 'badge-red',
};

export default function AnalysisResult() {
  const { id, analysisId } = useParams();
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [slice, setSlice]       = useState(22);
  const [showMask, setShowMask] = useState(true);
  const [showExp, setShowExp]   = useState(false);
  const [opacity, setOpacity]   = useState(60);
  const [wl, setWl]             = useState(0);    // window/level
  const [zoom, setZoom]         = useState(100);
  const [selectedFinding, setSel] = useState(null);

  useEffect(() => {
    casesApi.getAnalysis(id, analysisId)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id, analysisId]);

  if (loading) return (
    <AppShell breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: id, href: `/cases/${id}` }, { label: 'Analysis' }]}>
      <div style={{ textAlign: 'center', paddingTop: 80, color: '#94a3b8' }}>Loading analysis…</div>
    </AppShell>
  );

  if (!data) return <AppShell><div className="empty-state"><div className="empty-title">Analysis not found</div></div></AppShell>;

  const profileData = {
    labels: data.diameterProfile.map((p) => p.x),
    datasets: [
      {
        label: 'Measured Diameter (mm)',
        data: data.diameterProfile.map((p) => +p.measured.toFixed(2)),
        borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',
        fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
      },
      {
        label: 'Reference Diameter (mm)',
        data: data.diameterProfile.map((p) => p.reference),
        borderColor: '#22c55e', borderDash: [5, 3],
        fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5,
      },
    ],
  };

  const profileOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { font: { size: 11 }, color: '#64748b' } },
      tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8' },
    },
    scales: {
      x: { grid: { color: '#1e2d3d' }, ticks: { color: '#4b5563', font: { size: 10 } }, title: { display: true, text: 'Distance along vessel', color: '#6b7280', font: { size: 11 } } },
      y: { grid: { color: '#1e2d3d' }, ticks: { color: '#4b5563', font: { size: 10 } }, title: { display: true, text: 'Diameter (mm)', color: '#6b7280', font: { size: 11 } }, min: 0, max: 4 },
    },
    onClick: (_, elements) => {
      if (elements[0]) {
        const idx = elements[0].index;
        setSlice(Math.round((idx / data.diameterProfile.length) * data.totalSlices));
      }
    },
  };

  return (
    <AppShell breadcrumbs={[
      { label: 'Cases', href: '/cases' },
      { label: id, href: `/cases/${id}` },
      { label: 'Analysis Result' },
    ]}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Analysis Result</div>
          <h1 className="page-title">Stenosis Analysis — {id}</h1>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Model: <strong>{data.model}</strong></span>
            <span style={{ color: '#cbd5e1' }}>·</span>
            <span style={{ fontSize: 13, color: '#64748b' }}>{new Date(data.date).toLocaleDateString()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => navigate(`/cases/${id}`)}>
            <ChevronLeft size={15} /> Case Detail
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/reports')}>
            Export Report <ArrowUpRight size={14} />
          </button>
        </div>
      </div>

      {/* Uncertainty / quality flags */}
      {data.uncertaintyFlag && (
        <div style={{ marginBottom: 20, padding: '12px 16px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10, display: 'flex', gap: 10, color: '#92400e', fontSize: 13 }}>
          <AlertTriangle size={17} style={{ flexShrink: 0 }} />
          <strong>Low confidence warning:</strong> Segmentation uncertainty is above threshold. Results should be interpreted with caution and verified manually.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, marginBottom: 20 }}>
        {/* Image viewer */}
        <div className="viewer-panel">
          {/* Viewer canvas — simulated with a gradient placeholder */}
          <div className="viewer-canvas" style={{ minHeight: 380 }}>
            {/* Simulated CT slice */}
            <div style={{
              width: '80%', height: '80%',
              borderRadius: 12,
              background: `radial-gradient(ellipse at 40% 50%, rgba(80,80,80,${0.3 + wl/200}), rgba(20,20,20,0.95))`,
              position: 'relative', overflow: 'hidden',
              transform: `scale(${zoom/100})`, transition: 'transform 0.2s',
              boxShadow: '0 0 40px rgba(0,0,0,0.6)',
            }}>
              {/* Simulated vessel */}
              <svg viewBox="0 0 200 200" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                {/* Main vessel */}
                <ellipse cx="100" cy="100" rx="30" ry="45" stroke="rgba(180,180,200,0.6)" strokeWidth="2" fill="rgba(60,60,80,0.4)" />
                {/* Stenosis spot */}
                {slice > 18 && slice < 28 && (
                  <ellipse cx="100" cy="100" rx={22 - (slice-18)*0.5} ry={38 - (slice-18)*0.8}
                    fill="rgba(239,68,68,0.35)" stroke="#ef4444" strokeWidth="1.5" />
                )}
                {/* Mask overlay */}
                {showMask && (
                  <ellipse cx="100" cy="100" rx="28" ry="43"
                    fill={`rgba(59,130,246,${opacity/200})`} stroke="rgba(59,130,246,0.6)" strokeWidth="1" />
                )}
                {/* Stenosis marker */}
                {slice >= 20 && slice <= 26 && (
                  <>
                    <circle cx="100" cy="100" r="6" fill="#ef4444" opacity="0.9" />
                    <circle cx="100" cy="100" r="12" stroke="#ef4444" strokeWidth="1.5" fill="none" opacity="0.5" />
                  </>
                )}
              </svg>

              {/* Orientation labels */}
              <span className="viewer-label" style={{ top: 8, left: '50%', transform: 'translateX(-50%)' }}>A</span>
              <span className="viewer-label" style={{ bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>P</span>
              <span className="viewer-label" style={{ left: 8, top: '50%', transform: 'translateY(-50%)' }}>R</span>
              <span className="viewer-label" style={{ right: 8, top: '50%', transform: 'translateY(-50%)' }}>L</span>
            </div>

            {/* Slice info */}
            <div style={{ position: 'absolute', bottom: 60, left: 12, fontSize: 11, color: 'rgba(148,213,245,0.8)', fontWeight: 600 }}>
              Slice {slice} / {data.totalSlices}
            </div>
          </div>

          {/* Viewer controls */}
          <div className="viewer-controls">
            <button className="viewer-btn" id="zoom-in-btn" onClick={() => setZoom((z) => Math.min(z + 20, 200))} aria-label="Zoom in">
              <ZoomIn size={14} />
            </button>
            <button className="viewer-btn" id="zoom-out-btn" onClick={() => setZoom((z) => Math.max(z - 20, 50))} aria-label="Zoom out">
              <ZoomOut size={14} />
            </button>
            <button className="viewer-btn" id="reset-btn" onClick={() => { setZoom(100); setWl(0); }} aria-label="Reset view">
              <RotateCcw size={14} />
            </button>

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

            <button className={`viewer-btn${showMask ? ' active' : ''}`} id="mask-toggle-btn"
              onClick={() => setShowMask((m) => !m)} aria-label="Toggle mask">
              <Layers size={14} /> Mask
            </button>
            <button className={`viewer-btn${showExp ? ' active' : ''}`} id="exp-toggle-btn"
              onClick={() => setShowExp((e) => !e)} aria-label="Toggle explanation map">
              {showExp ? <Eye size={14} /> : <EyeOff size={14} />} Explainability
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <span style={{ color: '#6b7280', fontSize: 11 }}>Opacity</span>
              <input type="range" min={0} max={100} value={opacity}
                onChange={(e) => setOpacity(+e.target.value)}
                style={{ width: 70 }} aria-label="Mask opacity" />
            </div>
          </div>

          {/* Slice slider */}
          <div style={{ padding: '10px 16px', background: '#0d1117', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="viewer-btn" onClick={() => setSlice((s) => Math.max(s - 1, 1))} aria-label="Previous slice">
              <ChevronLeft size={14} />
            </button>
            <input
              id="slice-slider"
              type="range" min={1} max={data.totalSlices} value={slice}
              onChange={(e) => setSlice(+e.target.value)}
              style={{ flex: 1 }}
              aria-label="Slice selector"
            />
            <button className="viewer-btn" onClick={() => setSlice((s) => Math.min(s + 1, data.totalSlices))} aria-label="Next slice">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Measurements panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Findings summary */}
          {data.findings.map((f) => (
            <div key={f.id} className="card"
              style={{
                cursor: 'pointer', border: selectedFinding === f.id ? '2px solid #2563eb' : '1px solid rgba(226,232,240,0.8)',
                transition: 'border-color 0.15s',
              }}
              onClick={() => { setSel(f.id); setSlice(f.slice); }}
            >
              <div className="card-header">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{f.vessel}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Slice {f.slice}</div>
                </div>
                <span className={`badge ${SEV_BADGE[f.severity]}`} style={{ fontSize: 12 }}>{f.severity}</span>
              </div>
              <div className="card-body" style={{ paddingTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { label: 'Min Diameter',  value: `${f.minDiameter} mm` },
                    { label: 'Ref Diameter',  value: `${f.refDiameter} mm` },
                    { label: '% Narrowing',   value: <strong style={{ color: '#dc2626', fontSize: 16 }}>{f.narrowing}%</strong> },
                    { label: 'Confidence',    value: `${f.confidence}%` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Confidence bar */}
                <div style={{ marginTop: 12 }}>
                  <div className="progress-track">
                    <div className="progress-fill" style={{
                      width: `${f.confidence}%`,
                      background: f.confidence > 85 ? '#22c55e' : f.confidence > 70 ? '#f59e0b' : '#ef4444',
                    }} />
                  </div>
                </div>

                <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}
                  onClick={(e) => { e.stopPropagation(); setSlice(f.slice); }}>
                  Jump to slice {f.slice}
                </button>
              </div>
            </div>
          ))}

          {/* Disclaimer */}
          <div className="ai-disclaimer">
            <Info size={15} style={{ flexShrink: 0 }} />
            <span>AI-assisted research analysis. Not a clinical diagnosis. All findings require qualified clinical review.</span>
          </div>
        </div>
      </div>

      {/* Diameter profile chart */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Vessel Diameter Profile</h2>
          <span style={{ fontSize: 12, color: '#64748b' }}>Click the chart to jump to that vessel location in the viewer</span>
        </div>
        <div className="card-body" style={{ background: '#0a0f1a', borderRadius: '0 0 16px 16px' }}>
          <div style={{ height: 200 }}>
            <Line data={profileData} options={profileOptions} />
          </div>
        </div>
      </div>

      {/* Findings table */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <h2 className="card-title">All Findings</h2>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vessel</th>
                  <th>Min Diam.</th>
                  <th>Ref Diam.</th>
                  <th>% Narrowing</th>
                  <th>Severity</th>
                  <th>Confidence</th>
                  <th>Slice</th>
                </tr>
              </thead>
              <tbody>
                {data.findings.map((f) => (
                  <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => { setSel(f.id); setSlice(f.slice); }}>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>{f.vessel}</td>
                    <td style={{ fontFamily: 'monospace' }}>{f.minDiameter} mm</td>
                    <td style={{ fontFamily: 'monospace' }}>{f.refDiameter} mm</td>
                    <td><strong style={{ color: '#dc2626' }}>{f.narrowing}%</strong></td>
                    <td><span className={`badge ${SEV_BADGE[f.severity]}`}>{f.severity}</span></td>
                    <td>{f.confidence}%</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setSlice(f.slice); }}>
                        #{f.slice}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
