import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, ArrowRight, ChevronUp, ChevronDown, AlertTriangle, ImageIcon, Info } from 'lucide-react';
import AppShell from '../components/AppShell';
import { casesApi } from '../api/cases';

const STATUS_OPTIONS = ['All', 'Complete', 'Processing', 'Pending', 'Failed'];

function StatusBadge({ status }) {
  const map = { Complete: 'badge-green', Processing: 'badge-blue', Pending: 'badge-yellow', Failed: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}



export default function Cases() {
  const navigate = useNavigate();
  const [cases, setCases]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch]   = useState('');
  const [statusF, setStatusF] = useState('All');
  const [sort, setSort]       = useState({ key: 'createdAt', dir: 'desc' });
  const [page, setPage]       = useState(1);
  const PER_PAGE = 8;

  useEffect(() => {
    casesApi.list()
      .then((d) => { setCases(d); setLoading(false); })
      .catch((err) => {
        setLoading(false);
        if (err.response?.status === 403) {
          setLoadError('You do not have permission to view cases.');
        } else {
          setLoadError(err.message || 'Failed to load cases.');
        }
      });
  }, []);

  // Filter by search (case_code, study_type) and status
  let filtered = cases.filter((c) => {
    const q = search.toLowerCase();
    const matchQ = !q
      || String(c.id).includes(q)
      || c.caseCode?.toLowerCase().includes(q)
      || c.studyType?.toLowerCase().includes(q);
    const matchS = statusF === 'All' || c.status === statusF;
    return matchQ && matchS;
  });

  // Sort by supported real fields
  filtered = [...filtered].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (a[sort.key] < b[sort.key]) return -dir;
    if (a[sort.key] > b[sort.key]) return dir;
    return 0;
  });

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const toggleSort = (key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const SortIcon = ({ col }) =>
    sort.key === col
      ? sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
      : <span style={{ opacity: 0.3 }}><ChevronDown size={13} /></span>;

  return (
    <AppShell breadcrumbs={[{ label: 'Cases' }]}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Case Management</div>
          <h1 className="page-title">Cases</h1>
          <p className="page-subtitle">{loading ? '…' : `${filtered.length} of ${cases.length} cases`}</p>
        </div>
        <button id="new-case-btn" className="btn btn-primary" onClick={() => navigate('/cases/new')}>
          <Plus size={16} /> New Case
        </button>
      </div>

      {/* Error state */}
      {loadError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          color: '#dc2626', fontSize: 13.5, marginBottom: 20,
        }}>
          <AlertTriangle size={16} />{loadError}
        </div>
      )}

      {/* Unsupported fields notice */}
      {!loadError && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 16px',
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          fontSize: 12.5, color: '#6b7280', marginBottom: 16,
        }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Modality, region, scan date, severity, and confidence are not yet stored by the backend. Columns show real persisted data only.</span>
        </div>
      )}

      {/* Filters bar */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ paddingTop: 16, paddingBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar">
            <Search size={16} />
            <input
              id="cases-search"
              type="search"
              placeholder="Search by case code or study type…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label="Search cases"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={15} style={{ color: '#94a3b8' }} />
            <select
              id="status-filter"
              className="form-select"
              style={{ width: 160, padding: '8px 12px', fontSize: 13 }}
              value={statusF}
              onChange={(e) => { setStatusF(e.target.value); setPage(1); }}
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          {(search || statusF !== 'All') && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusF('All'); setPage(1); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  { key: 'id',        label: 'ID' },
                  { key: 'caseCode',  label: 'Case Code' },
                  { key: 'studyType', label: 'Study Type' },
                  { key: 'status',    label: 'Status' },
                  { key: 'createdAt', label: 'Created' },
                ].map(({ key, label }) => (
                  <th key={key} onClick={() => toggleSort(key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {label} <SortIcon col={key} />
                    </span>
                  </th>
                ))}
                <th>Image</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1,2,3,4].map((i) => (
                  <tr key={i}>
                    {[...Array(7)].map((_, j) => (
                      <td key={j}><div style={{ height: 16, background: '#f1f5f9', borderRadius: 6, width: '80%' }} /></td>
                    ))}
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-icon"><Search size={26} /></div>
                      <div className="empty-title">{cases.length === 0 ? 'No cases yet' : 'No cases match your search'}</div>
                      <div className="empty-sub">
                        {cases.length === 0
                          ? 'Create your first case to get started.'
                          : 'Try adjusting your search or filters.'}
                      </div>
                      <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>
                        <Plus size={15} /> Create first case
                      </button>
                    </div>
                  </td>
                </tr>
              ) : paged.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cases/${c.id}`)}>
                  <td><code style={{ fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>#{c.id}</code></td>
                  <td><code style={{ fontFamily: 'monospace', fontSize: 13, color: '#1d4ed8', fontWeight: 600 }}>{c.caseCode}</code></td>
                  <td style={{ color: '#475569', fontSize: 13 }}>{c.studyType}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td style={{ color: '#94a3b8', fontSize: 13 }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'center' }}>
                    {c.hasImage
                      ? <ImageIcon size={14} style={{ color: '#22c55e' }} title="Image uploaded" />
                      : <span style={{ color: '#e2e8f0' }}>—</span>}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" id={`case-detail-btn-${c.id}`}
                      onClick={(e) => { e.stopPropagation(); navigate(`/cases/${c.id}`); }}>
                      <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>
              Page {page} of {totalPages} · {filtered.length} cases
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              {[...Array(totalPages)].map((_, i) => (
                <button key={i} className={`btn btn-sm ${page === i + 1 ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPage(i + 1)}>{i + 1}</button>
              ))}
              <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
