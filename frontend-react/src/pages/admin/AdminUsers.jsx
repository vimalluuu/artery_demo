import { useState, useEffect } from 'react';
import { Search, Shield, UserCheck, UserX, ChevronDown } from 'lucide-react';
import AppShell from '../../components/AppShell';
import api from '../../api/client';
import { toUser } from '../../api/auth-contract';

const ROLES = ['Clinician', 'Researcher', 'DataScientist', 'Admin'];
const ROLE_BADGE = { Clinician: 'badge-blue', Researcher: 'badge-teal', DataScientist: 'badge-purple', Admin: 'badge-red' };

export default function AdminUsers() {
  const [users, setUsers]     = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const asRow = (u) => ({ ...toUser(u), status: u.is_active ? 'Active' : 'Inactive' });
  useEffect(() => {
    api.get('/admin/users?limit=500').then(({ data }) => setUsers(data.map(asRow)))
      .catch((err) => setError(err.message));
  }, []);
  const [search, setSearch]   = useState('');
  const [editId, setEditId]   = useState(null);
  const [editRole, setEditRole] = useState('');
  const [confirm, setConfirm]   = useState(null);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const saveAccess = async (id, role, is_active) => {
    setError(''); setBusy(true);
    try {
      const { data } = await api.patch(`/admin/users/${id}`, { role, is_active });
      setUsers((prev) => prev.map((u) => u.id === id ? asRow(data) : u));
      setEditId(null); setConfirm(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const applyRole = (id) => saveAccess(id, editRole, users.find((u) => u.id === id).is_active);
  const toggleStatus = (id) => {
    const user = users.find((u) => u.id === id);
    return saveAccess(id, user.role, !user.is_active);
  };

  return (
    <AppShell breadcrumbs={[{ label: 'Admin' }, { label: 'Users' }]}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">{users.filter((u) => u.status === 'Active').length} active of {users.length} total users</p>
        </div>

      </div>

      {/* Note: backend enforces roles */}
      <div className="ai-disclaimer" style={{ marginBottom: 20, background: '#fff', borderColor: 'rgba(0,0,0,0.18)' }}>
        <Shield size={15} />
        <span>Role and status changes are saved to the server and revoke sessions for that account. Showing up to 500 accounts.</span>
      </div>

      {error && <p role="alert">{error}</p>}
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {ROLES.map((r) => (
          <div key={r} className="stat-card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11.5, color: '#000', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{r}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#000', letterSpacing: '-1px' }}>
              {users.filter((u) => u.role === r && u.status === 'Active').length}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Users</h2>
          <div className="search-bar">
            <Search size={15} />
            <input id="user-search" type="search" placeholder="Search by name, email, role…"
              value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
          </div>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: '#000',
                          display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 700,
                        }}>
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                        <span style={{ fontWeight: 600, color: '#000', fontSize: 13.5 }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ color: '#000', fontSize: 13 }}>{u.email}</td>
                    <td>
                      {editId === u.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select className="form-select" style={{ padding: '5px 10px', fontSize: 12, width: 140 }}
                            value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                            {ROLES.map((r) => <option key={r}>{r}</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => applyRole(u.id)}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className={`badge ${ROLE_BADGE[u.role] || 'badge-gray'}`}>{u.role}</span>
                          <button className="btn btn-ghost btn-sm"
                            id={`edit-role-${u.id}-btn`}
                            onClick={() => { setEditId(u.id); setEditRole(u.role); }}
                            title="Change role">
                            <ChevronDown size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={u.status === 'Active' ? 'badge badge-green' : 'badge badge-gray'}>
                        {u.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {u.status === 'Active' ? (
                          <button className="btn btn-danger btn-sm"
                            id={`deactivate-${u.id}-btn`}
                            onClick={() => setConfirm(u)}>
                            <UserX size={13} /> Deactivate
                          </button>
                        ) : (
                          <button className="btn btn-secondary btn-sm"
                            id={`activate-${u.id}-btn`}
                            disabled={busy} onClick={() => toggleStatus(u.id)}>
                            <UserCheck size={13} /> Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#000' }}>Deactivate user?</div>
                <div style={{ fontSize: 13, color: '#000', marginTop: 4 }}>
                  <strong>{confirm.name}</strong> will lose access to VascuAI immediately.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button id="confirm-deactivate-btn" className="btn btn-danger" disabled={busy} onClick={() => toggleStatus(confirm.id)}>
                <UserX size={14} /> Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
