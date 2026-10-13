import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import { FolderOpen, CheckCircle, AlertTriangle, Clock, TrendingUp, ArrowRight } from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

const SEV_COLORS = {
  Normal:   '#22c55e',
  Mild:     '#eab308',
  Moderate: '#f97316',
  Severe:   '#ef4444',
  Critical: '#7f1d1d',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    casesApi.list().then((d) => { setCases(d); setLoading(false); });
  }, []);

  const total      = cases.length;
  const complete   = cases.filter((c) => c.status === 'Complete').length;
  const processing = cases.filter((c) => c.status === 'Processing').length;
  const pending    = cases.filter((c) => c.status === 'Pending').length;
  const alerts     = cases.filter((c) => c.severity === 'Severe' || c.severity === 'Critical').length;

  const sevDist = ['Normal', 'Mild', 'Moderate', 'Severe', 'Critical'].map((s) => ({
    label: s,
    count: cases.filter((c) => c.severity === s).length,
    color: SEV_COLORS[s],
  }));

  const doughnutData = {
    labels: sevDist.map((s) => s.label),
    datasets: [{
      data: sevDist.map((s) => s.count || 0),
      backgroundColor: sevDist.map((s) => s.color),
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
    { label: 'Total Cases',       value: total,      icon: FolderOpen,     color: '#dbeafe', iconColor: '#2563eb', change: '+14%', up: true },
    { label: 'Analyses Complete', value: complete,   icon: CheckCircle,    color: '#dcfce7', iconColor: '#16a34a', change: '+8%',  up: true },
    { label: 'Processing',        value: processing, icon: Clock,          color: '#fef9c3', iconColor: '#d97706', change: null,   up: null },
    { label: 'High Severity',     value: alerts,     icon: AlertTriangle,  color: '#fee2e2', iconColor: '#dc2626', change: null,   up: null },
  ];

  return (
    <AppShell breadcrumbs={[{ label: 'Dashboard' }]}>
      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Clinical Research</div>
          <h1 className="page-title">Medical Imaging Dashboard</h1>
          <p className="page-subtitle">Overview of case activity and analysis outcomes.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>
          <span>+</span> New Case
        </button>
      </div>

      {/* Stats */}
      {loading
        ? <div className="stats-grid">{[0,1,2,3].map((i) => (
            <div key={i} className="stat-card" style={{ height: 130, background: '#f1f5f9', borderRadius: 20 }} />
          ))}</div>
        : (
          <div className="stats-grid">
            {STATS.map(({ label, value, icon: Icon, color, iconColor, change, up }) => (
              <div key={label} className="stat-card">
                <div className="stat-icon" style={{ background: color }}>
                  <Icon size={22} style={{ color: iconColor }} />
                </div>
                <div className="stat-value">{value}</div>
                <div className="stat-label">{label}</div>
                {change && (
                  <div className={`stat-change ${up ? 'up' : 'down'}`}>
                    <TrendingUp size={12} /> {change} this month
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Weekly Case Volume</h2>
            <span className="badge badge-blue">This week</span>
          </div>
          <div className="card-body" style={{ height: 200 }}>
            <Bar data={barData} options={barOptions} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Severity Distribution</h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ height: 140, width: 140 }}>
              <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }} />
            </div>
            <div style={{ width: '100%', display: 'grid', gap: 6 }}>
              {sevDist.map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                    <span style={{ color: '#475569' }}>{s.label}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recent cases */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent Analyses</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/cases')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Modality</th>
                  <th>Region</th>
                  <th>Scan Date</th>
                  <th>Status</th>
                  <th>Severity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading…</td></tr>
                  : recent.map((c) => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cases/${c.id}`)}>
                      <td><code style={{ fontFamily: 'monospace', fontSize: 13, color: '#1d4ed8' }}>{c.id}</code></td>
                      <td style={{ color: '#475569' }}>{c.modality}</td>
                      <td style={{ color: '#475569' }}>{c.region}</td>
                      <td style={{ color: '#94a3b8', fontSize: 13 }}>{c.scanDate}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td>{c.severity ? <SeverityBadge sev={c.severity} /> : <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>}</td>
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

      {/* Processing status */}
      {processing > 0 && (
        <div style={{
          marginTop: 20, padding: '14px 18px', background: '#eff6ff',
          border: '1px solid #bfdbfe', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 12, color: '#1d4ed8', fontSize: 13.5,
        }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: '#3b82f6', animation: 'pulse 1.5s infinite',
          }} />
          <strong>{processing}</strong> case{processing > 1 ? 's' : ''} currently processing. Results will appear automatically.
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
        </div>
      )}
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

function SeverityBadge({ sev }) {
  const map = {
    Normal:   'badge-green',
    Mild:     'badge-yellow',
    Moderate: 'badge-orange',
    Severe:   'badge-red',
    Critical: 'badge-red',
  };
  return (
    <span className={`badge ${map[sev] || 'badge-gray'}`}>
      <span className={`severity-dot severity-${sev?.toLowerCase()}`} />
      {sev}
    </span>
  );
}
