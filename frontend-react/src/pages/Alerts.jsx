import { useState } from 'react';
import { Bell, AlertTriangle, Info, CheckCircle, XCircle, Filter } from 'lucide-react';
import AppShell from '../components/AppShell';

const MOCK_ALERTS = [
  { id: 'ALT-001', level: 'critical', title: 'Critical stenosis detected', message: 'CASE-1040: >70% narrowing in LAD Proximal. Immediate clinical review recommended.', time: '2026-10-07T09:05:00Z', read: false },
  { id: 'ALT-002', level: 'warning',  title: 'Low model confidence',       message: 'CASE-1038: Confidence score 58.2% — below threshold of 70%. Results may be unreliable.', time: '2026-10-05T11:20:00Z', read: false },
  { id: 'ALT-003', level: 'warning',  title: 'Image quality issue',        message: 'CASE-1038: Motion artefacts detected. Consider re-acquisition.', time: '2026-10-05T11:21:00Z', read: true },
  { id: 'ALT-004', level: 'error',    title: 'Processing failed',          message: 'CASE-1038: Segmentation pipeline error. Please re-upload the scan.', time: '2026-10-05T12:00:00Z', read: true },
  { id: 'ALT-005', level: 'info',     title: 'Model updated',              message: 'VascuNet upgraded from v2.0 to v2.1. Dice score improved from 0.88 → 0.92.', time: '2026-10-01T08:00:00Z', read: true },
  { id: 'ALT-006', level: 'success',  title: 'Analysis complete',          message: 'CASE-1043: Analysis finished successfully. Findings ready for review.', time: '2026-10-10T14:32:00Z', read: true },
];

const LEVEL_CONFIG = {
  critical: { icon: <XCircle size={18} />,     color: '#dc2626', bg: '#fef2f2', border: '#fecaca',  label: 'Critical' },
  warning:  { icon: <AlertTriangle size={18} />,color: '#d97706', bg: '#fffbeb', border: '#fde68a',  label: 'Warning' },
  error:    { icon: <XCircle size={18} />,     color: '#dc2626', bg: '#fef2f2', border: '#fecaca',  label: 'Error' },
  info:     { icon: <Info size={18} />,         color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe',  label: 'Info' },
  success:  { icon: <CheckCircle size={18} />,  color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0',  label: 'Success' },
};

export default function Alerts() {
  const [alerts, setAlerts]     = useState(MOCK_ALERTS);
  const [filter, setFilter]     = useState('All');

  const LEVELS = ['All', 'critical', 'warning', 'error', 'info', 'success'];
  const unread  = alerts.filter((a) => !a.read).length;

  const shown = filter === 'All' ? alerts : alerts.filter((a) => a.level === filter);

  const markRead = (id) => setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, read: true } : a));
  const markAllRead = () => setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  const dismiss = (id) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  return (
    <AppShell breadcrumbs={[{ label: 'Alerts' }]}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">System</div>
          <h1 className="page-title">
            Alerts
            {unread > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: '50%', background: '#ef4444', color: '#fff',
                fontSize: 13, fontWeight: 700, marginLeft: 12, verticalAlign: 'middle',
              }}>{unread}</span>
            )}
          </h1>
          <p className="page-subtitle">System notifications, model alerts, and clinical flags.</p>
        </div>
        {unread > 0 && (
          <button className="btn btn-secondary" id="mark-all-read-btn" onClick={markAllRead}>
            <CheckCircle size={15} /> Mark all read
          </button>
        )}
      </div>

      {/* Level filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {LEVELS.map((l) => (
          <button key={l} id={`alert-filter-${l}`}
            className={`btn btn-sm ${filter === l ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(l)}>
            {l.charAt(0).toUpperCase() + l.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon"><Bell size={26} /></div>
            <div className="empty-title">No alerts</div>
            <div className="empty-sub">All clear — no {filter !== 'All' ? filter : ''} alerts.</div>
          </div>
        )}
        {shown.map((a) => {
          const cfg = LEVEL_CONFIG[a.level];
          return (
            <div key={a.id}
              id={`alert-${a.id}`}
              style={{
                display: 'flex', gap: 14, padding: '16px 18px',
                background: a.read ? '#fff' : cfg.bg,
                border: `1px solid ${a.read ? '#e2e8f0' : cfg.border}`,
                borderLeft: `4px solid ${cfg.color}`,
                borderRadius: 12, cursor: 'pointer', transition: 'background 0.15s',
              }}
              onClick={() => markRead(a.id)}
            >
              <div style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }}>{cfg.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: a.read ? 600 : 700, color: '#0f172a' }}>{a.title}</span>
                    {!a.read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />}
                  </div>
                  <span style={{ fontSize: 11.5, color: '#94a3b8', flexShrink: 0, marginLeft: 12 }}>
                    {new Date(a.time).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6 }}>{a.message}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                id={`dismiss-alert-${a.id}`}
                onClick={(e) => { e.stopPropagation(); dismiss(a.id); }}
                aria-label="Dismiss alert"
                style={{ flexShrink: 0 }}
              >✕</button>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
