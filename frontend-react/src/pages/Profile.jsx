import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Building2, CheckCircle, AlertCircle } from 'lucide-react';
import AppShell from '../components/AppShell';

export default function Profile() {
  const { user, logout, updateProfile, changePassword } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab]   = useState('details');
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  const [details, setDetails] = useState({
    name: user?.name || '',
    email: user?.email || '',
    institution: user?.institution || '',
    department: user?.department || '',
  });

  const saveDetails = async (e) => {
    e.preventDefault();
    setProfileError('');
    try { await updateProfile(details); }
    catch (err) { setProfileError(err.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const changePw = async (e) => {
    e.preventDefault();
    if (!pwForm.current) { setPwError('Enter current password.'); return; }
    if (pwForm.newPw.length < 12) { setPwError('New password must be at least 12 characters.'); return; }
    if (pwForm.newPw !== pwForm.confirm) { setPwError('Passwords do not match.'); return; }
    setPwError('');
    try { await changePassword(pwForm.current, pwForm.newPw); }
    catch (err) { setPwError(err.message); return; }
    setPwSuccess(true);
    setPwForm({ current: '', newPw: '', confirm: '' });
    setTimeout(() => setPwSuccess(false), 3000);
  };

  const TABS = [
    { id: 'details', label: 'Profile Details', icon: <User size={15} /> },
    { id: 'password', label: 'Change Password', icon: <Lock size={15} /> },
  ];

  return (
    <AppShell breadcrumbs={[{ label: 'Profile' }]}>
      <div className="page-header">
        <div className="page-eyebrow">Account</div>
        <h1 className="page-title">Profile &amp; Settings</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24 }}>
        {/* Left sidebar — avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%', margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'grid', placeItems: 'center',
              fontSize: 28, fontWeight: 800, color: '#fff',
            }}>
              {user?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2) || 'U'}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{user?.name}</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4 }}>{user?.role}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{user?.email}</div>
            <div className="divider" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 12, color: '#475569' }}>
              <Building2 size={13} /> {user?.institution || ''}
            </div>
          </div>

          {TABS.map((t) => (
            <button key={t.id}
              className={`nav-item${tab === t.id ? ' active' : ''}`}
              style={{ background: tab === t.id ? '#eff6ff' : '#fff', color: tab === t.id ? '#1d4ed8' : '#334155', border: '1px solid #e2e8f0', borderRadius: 10, justifyContent: 'flex-start' }}
              onClick={() => setTab(t.id)}>
              {t.icon}{t.label}
            </button>
          ))}

          <button className="btn btn-danger" onClick={async () => { await logout(); navigate('/login'); }}>
            Sign out
          </button>
        </div>

        {/* Main content */}
        <div className="card">
          {tab === 'details' && (
            <>
              <div className="card-header"><h2 className="card-title">Profile Details</h2></div>
              <div className="card-body">
                {profileError && <p role="alert">{profileError}</p>}
                {saved && (
                  <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#15803d', fontSize: 13, marginBottom: 18 }}>
                    <CheckCircle size={16} /> Profile updated successfully.
                  </div>
                )}
                <form id="profile-form" onSubmit={saveDetails}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-name">Full name</label>
                      <input id="profile-name" className="form-input" value={details.name}
                        onChange={(e) => setDetails({ ...details, name: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-email">Email</label>
                      <input id="profile-email" className="form-input" type="email" value={details.email} disabled
                        onChange={(e) => setDetails({ ...details, email: e.target.value })} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-institution">Institution</label>
                    <input id="profile-institution" className="form-input" value={details.institution}
                      onChange={(e) => setDetails({ ...details, institution: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-department">Department</label>
                    <input id="profile-department" className="form-input" value={details.department}
                      onChange={(e) => setDetails({ ...details, department: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <input className="form-input" value={user?.role || 'Clinician'} disabled
                      style={{ background: '#f8fafc', color: '#64748b' }} />
                    <p className="form-hint">Role is assigned by an administrator — contact admin to change.</p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button id="save-profile-btn" type="submit" className="btn btn-primary">Save changes</button>
                  </div>
                </form>
              </div>
            </>
          )}

          {tab === 'password' && (
            <>
              <div className="card-header"><h2 className="card-title">Change Password</h2></div>
              <div className="card-body">
                {pwError && (
                  <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#dc2626', fontSize: 13, marginBottom: 18 }}>
                    <AlertCircle size={16} />{pwError}
                  </div>
                )}
                {pwSuccess && (
                  <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#15803d', fontSize: 13, marginBottom: 18 }}>
                    <CheckCircle size={16} /> Password changed successfully.
                  </div>
                )}
                <form id="change-password-form" onSubmit={changePw} style={{ maxWidth: 440 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="current-pw">Current password</label>
                    <input id="current-pw" type="password" className="form-input"
                      value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="new-pw">New password</label>
                    <input id="new-pw" type="password" className="form-input" placeholder="Min. 12 characters"
                      value={pwForm.newPw} onChange={(e) => setPwForm({ ...pwForm, newPw: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="confirm-pw">Confirm new password</label>
                    <input id="confirm-pw" type="password" className="form-input"
                      value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} required />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button id="change-password-btn" type="submit" className="btn btn-primary">Update password</button>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
