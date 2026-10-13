import { useState } from 'react';
import { Download, FileText, FileJson, Table2, Eye, Filter } from 'lucide-react';
import AppShell from '../components/AppShell';

const MOCK_REPORTS = [
  { id: 'RPT-001', caseId: 'CASE-1043', generatedAt: '2026-10-10T15:00:00Z', model: 'VascuNet v2.1', severity: 'Moderate', format: ['PDF', 'JSON', 'CSV'] },
  { id: 'RPT-002', caseId: 'CASE-1041', generatedAt: '2026-10-08T11:00:00Z', model: 'VascuNet v2.1', severity: 'Mild',     format: ['PDF', 'JSON'] },
  { id: 'RPT-003', caseId: 'CASE-1040', generatedAt: '2026-10-07T10:00:00Z', model: 'VascuNet v2.1', severity: 'Severe',   format: ['PDF', 'JSON', 'CSV'] },
];

const FMT_ICON = { PDF: <FileText size={14} />, JSON: <FileJson size={14} />, CSV: <Table2 size={14} /> };
const SEV_BADGE = { Normal: 'badge-green', Mild: 'badge-yellow', Moderate: 'badge-orange', Severe: 'badge-red' };

export default function Reports() {
  const [preview, setPreview] = useState(null);

  const fakeDownload = (rptId, fmt) => {
    alert(`[Demo] Download ${rptId}.${fmt.toLowerCase()} — connect to backend POST /cases/{id}/report?format=${fmt}`);
  };

  return (
    <AppShell breadcrumbs={[{ label: 'Reports' }]}>
      <div className="page-header">
        <div className="page-eyebrow">Output</div>
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Download analysis reports in PDF, JSON, or CSV format.</p>
      </div>

      {/* Disclaimer */}
      <div className="ai-disclaimer" style={{ marginBottom: 24 }}>
        ⚠ All exported reports must include the disclaimer: "AI-assisted research analysis — not a clinical diagnosis."
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: preview ? '1fr 420px' : '1fr', gap: 20 }}>
        <div className="card">
          <div className="card-header" style={{ paddingBottom: 0 }}>
            <h2 className="card-title">Generated Reports</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm"><Filter size={14} /> Filter</button>
            </div>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Report ID</th>
                    <th>Case</th>
                    <th>Generated</th>
                    <th>Model</th>
                    <th>Severity</th>
                    <th>Download</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_REPORTS.map((r) => (
                    <tr key={r.id}>
                      <td><code style={{ fontFamily: 'monospace', fontSize: 12, color: '#1d4ed8' }}>{r.id}</code></td>
                      <td><code style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.caseId}</code></td>
                      <td style={{ fontSize: 12.5, color: '#64748b' }}>{new Date(r.generatedAt).toLocaleDateString()}</td>
                      <td style={{ fontSize: 12.5, color: '#475569' }}>{r.model}</td>
                      <td><span className={`badge ${SEV_BADGE[r.severity] || 'badge-gray'}`}>{r.severity}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {r.format.map((fmt) => (
                            <button key={fmt} className="btn btn-ghost btn-sm"
                              id={`download-${r.id}-${fmt.toLowerCase()}-btn`}
                              onClick={() => fakeDownload(r.id, fmt)}
                              title={`Download as ${fmt}`}>
                              {FMT_ICON[fmt]} {fmt}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => setPreview(r)}>
                          <Eye size={14} /> Preview
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Preview panel */}
        {preview && (
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-header">
              <h2 className="card-title">Preview — {preview.id}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>✕ Close</button>
            </div>
            <div className="card-body">
              <div style={{ padding: '20px', background: '#f8fafc', borderRadius: 10, fontSize: 13, lineHeight: 1.7, color: '#334155' }}>
                <div style={{ textAlign: 'center', marginBottom: 16, padding: '10px', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>VascuAI Analysis Report</strong><br />
                  <span style={{ fontSize: 11, color: '#64748b' }}>{preview.id} · {preview.caseId}</span>
                </div>

                <div style={{ padding: '10px 14px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11.5, color: '#92400e', marginBottom: 16 }}>
                  ⚠ <strong>DISCLAIMER:</strong> AI-assisted research analysis. Not a clinical diagnosis. Requires qualified clinical review before any clinical use.
                </div>

                {[
                  ['Model',     preview.model],
                  ['Case ID',   preview.caseId],
                  ['Date',      new Date(preview.generatedAt).toLocaleString()],
                  ['Severity',  preview.severity],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginBottom: 6 }}>
                    <span style={{ color: '#64748b', fontSize: 12 }}>{k}</span>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{v}</span>
                  </div>
                ))}

                <div style={{ marginTop: 12, fontSize: 12.5 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: '#0f172a' }}>Findings Summary</div>
                  <div style={{ color: '#475569' }}>LAD Proximal: 43.8% narrowing — Moderate severity (confidence 91.3%)</div>
                  <div style={{ color: '#475569', marginTop: 4 }}>RCA Mid: 30.0% narrowing — Mild severity (confidence 88.2%)</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                {preview.format.map((fmt) => (
                  <button key={fmt} className="btn btn-primary btn-sm"
                    onClick={() => fakeDownload(preview.id, fmt)}>
                    <Download size={13} /> {fmt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
