import { useState } from 'react';
import { Cpu, CheckCircle, RotateCcw, Star, TrendingUp } from 'lucide-react';
import AppShell from '../../components/AppShell';

const MOCK_MODELS = [
  {
    id: 'mdl-003', name: 'VascuNet v2.1', version: '2.1.0', status: 'Active',
    dice: 0.924, iou: 0.887, precision: 0.931, recall: 0.918,
    deployedAt: '2026-10-01', trainedOn: '12,400 cases',
    description: 'Improved carotid & coronary segmentation with augmented dataset.',
  },
  {
    id: 'mdl-002', name: 'VascuNet v2.0', version: '2.0.0', status: 'Archived',
    dice: 0.881, iou: 0.842, precision: 0.895, recall: 0.868,
    deployedAt: '2026-07-15', trainedOn: '9,800 cases',
    description: 'Baseline multi-vessel segmentation model.',
  },
  {
    id: 'mdl-001', name: 'VascuNet v1.5', version: '1.5.2', status: 'Archived',
    dice: 0.847, iou: 0.810, precision: 0.862, recall: 0.833,
    deployedAt: '2026-03-01', trainedOn: '7,200 cases',
    description: 'Initial production model — single-vessel coronary only.',
  },
];

const METRIC_LABEL = { dice: 'Dice Score', iou: 'IoU', precision: 'Precision', recall: 'Recall' };

function MetricBar({ value, label }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#000', marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontWeight: 700, color: '#000' }}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{
          width: `${value * 100}%`,
          background: '#000',
        }} />
      </div>
    </div>
  );
}

export default function AdminModels() {
  const [models, setModels] = useState(MOCK_MODELS);
  const [rollbackTarget, setRollback] = useState(null);

  const setActive = (id) => {
    setModels((prev) => prev.map((m) => ({
      ...m,
      status: m.id === id ? 'Active' : m.status === 'Active' ? 'Archived' : m.status,
    })));
    setRollback(null);
  };

  return (
    <AppShell breadcrumbs={[{ label: 'Admin' }, { label: 'Models' }]}>
      <div className="page-header">
        <div className="page-eyebrow">Administration</div>
        <h1 className="page-title">Model Management</h1>
        <p className="page-subtitle">View model versions, metrics, and manage active deployment.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {models.map((m) => (
          <div key={m.id} className="card" style={{
            borderColor: m.status === 'Active' ? '#000' : 'rgba(0,0,0,0.18)',
            borderWidth: m.status === 'Active' ? 2 : 1,
          }}>
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 12,
                  background: m.status === 'Active' ? '#000' : '#fff',
                  display: 'grid', placeItems: 'center',
                  color: m.status === 'Active' ? '#fff' : '#000',
                }}>
                  <Cpu size={20} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#000' }}>{m.name}</span>
                    {m.status === 'Active' && (
                      <span className="badge badge-green" style={{ fontSize: 11 }}>
                        <Star size={10} /> Active
                      </span>
                    )}
                    {m.status === 'Archived' && (
                      <span className="badge badge-gray" style={{ fontSize: 11 }}>Archived</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#000' }}>
                    v{m.version} · Deployed {m.deployedAt} · Trained on {m.trainedOn}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {m.status === 'Archived' && (
                  <button
                    id={`rollback-${m.id}-btn`}
                    className="btn btn-secondary btn-sm"
                    onClick={() => setRollback(m)}>
                    <RotateCcw size={13} /> Set Active
                  </button>
                )}
              </div>
            </div>

            <div className="card-body">
              <p style={{ fontSize: 13.5, color: '#000', marginBottom: 20 }}>{m.description}</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                {Object.entries(METRIC_LABEL).map(([key, label]) => (
                  <MetricBar key={key} value={m[key]} label={label} />
                ))}
              </div>

              {m.status === 'Active' && (
                <div style={{ marginTop: 16, padding: '10px 14px', background: '#fff', borderRadius: 10, fontSize: 12.5, color: '#000', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <CheckCircle size={14} />
                  This model is currently serving all live analysis requests.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Rollback confirmation */}
      {rollbackTarget && (
        <div className="modal-backdrop" onClick={() => setRollback(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#000' }}>Switch active model?</div>
                <div style={{ fontSize: 13.5, color: '#000', marginTop: 6 }}>
                  Set <strong>{rollbackTarget.name}</strong> as the active model.
                  All new analysis requests will use this version.
                </div>
              </div>
            </div>
            <div className="modal-body">
              <div style={{ padding: '12px 14px', background: '#fff', border: '1px solid #000', borderRadius: 10, fontSize: 12.5, color: '#000' }}>
                <strong>Note:</strong> Existing analysis results are not affected. Only new requests will use the new model.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRollback(null)}>Cancel</button>
              <button id="confirm-rollback-btn" className="btn btn-primary" onClick={() => setActive(rollbackTarget.id)}>
                <TrendingUp size={14} /> Confirm Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
