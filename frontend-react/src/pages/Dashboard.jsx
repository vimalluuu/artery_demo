import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import { FolderOpen, CheckCircle, Clock, ImageIcon, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

export default function Dashboard() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    casesApi.list()
      .then((d) => { setCases(d); setLoading(false); })
      .catch((err) => {
        setLoading(false);
        setLoadError(err.response?.status === 403
          ? 'Your role does not permit viewing cases.'
          : err.message || 'Failed to load cases.');
      });
  }, []);

  const total      = cases.length;
  const complete   = cases.filter((c) => c.status === 'Complete').length;
  const processing = cases.filter((c) => c.status === 'Processing').length;
  const withImage  = cases.filter((c) => c.hasImage).length;

  // Status distribution for doughnut chart (real backend statuses)
  const statusDist = [
    { label: 'Complete',   count: complete,                                                            color: '#22c55e' },
    { label: 'Processing', count: processing,                                                          color: '#3b82f6' },
    { label: 'Pending',    count: cases.filter((c) => c.status === 'Pending').length,                  color: '#eab308' },
    { label: 'Failed',     count: cases.filter((c) => c.status === 'Failed').length,                   color: '#ef4444' },
  ];

  const doughnutData = {
    labels: statusDist.map((s) => s.label),
    datasets: [{
      data: statusDist.map((s) => s.count || 0),
      backgroundColor: statusDist.map((s) => s.color),
      borderWidth: 0,
      hoverOffset: 6,
    }],
  };

  const recent = [...cases].slice(0, 5);

  const barData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [{
      label: 'Cases processed',
      data: [4, 7, 5, 9, 6, 3, 2],
      backgroundColor: 'rgba(37,99,235,0.75)',
      borderRadius: 6,
      borderSkipped: false,
    }],
  };

  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b' } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      y: { grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 11 } }, beginAtZero: true },
    },
  };

  const STATS = [
    { label: 'Total Cases',       value: total,      icon: FolderOpen,  color: '#dbeafe', iconColor: '#2563eb' },
    { label: 'Analyses Complete', value: complete,   icon: CheckCircle, color: '#dcfce7', iconColor: '#16a34a' },
    { label: 'Processing',        value: processing, icon: Clock,       color: '#fef9c3', iconColor: '#d97706' },
    { label: 'Images Uploaded',   value: withImage,  icon: ImageIcon,   color: '#ede9fe', iconColor: '#7c3aed' },
  ];

  return (
    <AppShell breadcrumbs={[{ label: 'Dashboard' }]}>
      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Clinical Research</div>
          <h1 className="page-title">Medical Imaging Dashboard</h1>
          <p className="page-subtitle">Overview of real persisted case activity.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>
          <span>+</span> New Case
        </button>
      </div>

      {loadError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          color: '#dc2626', fontSize: 13.5, marginBottom: 20,
        }}>
          <AlertTriangle size={16} />{loadError}
        </div>
      )}

      {/* Stats */}
      {loading
        ? <div className="stats-grid">{[0,1,2,3].map((i) => (
            <div key={i} className="stat-card" style={{ height: 130, background: '#f1f5f9', borderRadius: 20 }} />
          ))}</div>
        : (
          <div className="stats-grid">
            {STATS.map(({ label, value, icon: Icon, color, iconColor }) => (
              <div key={label} className="stat-card">
                <div className="stat-icon" style={{ background: color }}>
                  <Icon size={22} style={{ color: iconColor }} />
                </div>
                <div className="stat-value">{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>
        )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Weekly Case Volume</h2>
            <span className="badge badge-blue">Illustrative — not real data</span>
          </div>
          <div className="card-body" style={{ height: 200 }}>
            <Bar data={barData} options={barOptions} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Status Distribution</h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {total === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No cases yet</div>
            ) : (
              <>
                <div style={{ height: 140, width: 140 }}>
                  <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }} />
                </div>
                <div style={{ width: '100%', display: 'grid', gap: 6 }}>
                  {statusDist.map((s) => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                        <span style={{ color: '#475569' }}>{s.label}</span>
                      </span>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Recent cases */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent Cases</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/cases')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          {/* Unsupported fields notice */}
          <div style={{
            display: 'flex', gap: 7, alignItems: 'flex-start', padding: '8px 12px',
            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
            fontSize: 12, color: '#6b7280', marginBottom: 12,
          }}>
            <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            Modality, severity, and confidence are not yet stored by the backend.
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Case Code</th>
                  <th>Study Type</th>
                  <th>Status</th>
                  <th>Image</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading…</td></tr>
                  : recent.length === 0
                  ? <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>No cases yet. <button className="btn btn-ghost btn-sm" onClick={() => navigate('/cases/new')}>Create one →</button></td></tr>
                  : recent.map((c) => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cases/${c.id}`)}>
                      <td><code style={{ fontFamily: 'monospace', fontSize: 13, color: '#1d4ed8' }}>{c.caseCode}</code></td>
                      <td style={{ color: '#475569', fontSize: 13 }}>{c.studyType}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td style={{ textAlign: 'center' }}>
                        {c.hasImage ? <ImageIcon size={13} style={{ color: '#22c55e' }} /> : <span style={{ color: '#e2e8f0' }}>—</span>}
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: 13 }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/cases/${c.id}`); }}>
                          <ArrowRight size={14} />
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

function StatusBadge({ status }) {
  const map = {
    Complete:   'badge-green',
    Processing: 'badge-blue',
    Pending:    'badge-yellow',
    Failed:     'badge-red',
  };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}
