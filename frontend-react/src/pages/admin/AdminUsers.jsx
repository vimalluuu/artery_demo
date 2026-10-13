import { useState } from 'react';
import { Users, Search, Plus, Shield, UserCheck, UserX, ChevronDown } from 'lucide-react';
import AppShell from '../../components/AppShell';

const MOCK_USERS = [
  { id: 'u-001', name: 'Dr. Aisha Patel',  email: 'aisha.patel@research.med',   role: 'Clinician',     status: 'Active',   lastLogin: '2026-10-13' },
  { id: 'u-002', name: 'Dr. James Osei',   email: 'james.osei@research.med',    role: 'Researcher',    status: 'Active',   lastLogin: '2026-10-12' },
  { id: 'u-003', name: 'Dr. Liu Wei',      email: 'liu.wei@research.med',       role: 'DataScientist', status: 'Active',   lastLogin: '2026-10-10' },
  { id: 'u-004', name: 'Prof. Sara Khan',  email: 'sara.khan@research.med',     role: 'Admin',         status: 'Active',   lastLogin: '2026-10-13' },
  { id: 'u-005', name: 'Dr. Tom Rivera',   email: 'tom.rivera@research.med',    role: 'Clinician',     status: 'Inactive', lastLogin: '2026-09-15' },
  { id: 'u-006', name: 'Dr. Yuki Tanaka',  email: 'yuki.tanaka@research.med',   role: 'Researcher',    status: 'Active',   lastLogin: '2026-10-11' },
];

const ROLES = ['Clinician', 'Researcher', 'DataScientist', 'Admin'];
const ROLE_BADGE = { Clinician: 'badge-blue', Researcher: 'badge-teal', DataScientist: 'badge-purple', Admin: 'badge-red' };

export default function AdminUsers() {
  const [users, setUsers]     = useState(MOCK_USERS);
  const [search, setSearch]   = useState('');
  const [editId, setEditId]   = useState(null);
  const [editRole, setEditRole] = useState('');
  const [confirm, setConfirm]   = useState(null);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const applyRole = (id) => {
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, role: editRole } : u));
    setEditId(null);
  };

  const toggleStatus = (id) => {
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, status: u.status === 'Active' ? 'Inactive' : 'Active' } : u));
    setConfirm(null);
  };

  return (
    <AppShell breadcrumbs={[{ label: 'Admin' }, { label: 'Users' }]}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">{users.filter((u) => u.status === 'Active').length} active of {users.length} total users</p>
        </div>
        <button id="invite-user-btn" className="btn btn-primary" onClick={() => alert('[Demo] Invite user flow — connect to POST /auth/register')}>
          <Plus size={15} /> Invite User
        </button>
      </div>

      {/* Note: backend enforces roles */}
      <div className="ai-disclaimer" style={{ marginBottom: 20, background: '#eff6ff', borderColor: '#bfdbfe' }}>
        <Shield size={15} />
        <span>Role changes here are UI-convenience only. The backend enforces all permissions independently.</span>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {ROLES.map((r) => (
          <div key={r} className="stat-card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{r}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', letterSpacing: '-1px' }}>
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
                  <th>Last login</th>
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
                          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                          display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 700,
                        }}>
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                        <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 13.5 }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ color: '#64748b', fontSize: 13 }}>{u.email}</td>
                    <td>
                      {editId === u.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select className="form-select" style={{ padding: '5px 10px', fontSize: 12, width: 140 }}
                            value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                            {ROLES.map((r) => <option key={r}>{r}</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" onClick={() => applyRole(u.id)}>Save</button>
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
                    <td style={{ fontSize: 12.5, color: '#94a3b8' }}>{u.lastLogin}</td>
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
                            onClick={() => toggleStatus(u.id)}>
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
                <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>Deactivate user?</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  <strong>{confirm.name}</strong> will lose access to VascuAI immediately.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button id="confirm-deactivate-btn" className="btn btn-danger" onClick={() => toggleStatus(confirm.id)}>
                <UserX size={14} /> Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
