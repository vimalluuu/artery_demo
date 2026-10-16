import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

const ROLES = ['Clinician', 'Researcher', 'DataScientist'];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirm: '', role: 'Clinician', institution: '',
  });
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    if (form.password.length < 12) { setError('Password must be at least 12 characters.'); return; }
    setError(''); setLoading(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password, role: form.role, institution: form.institution });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#fff', padding: '32px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 15, margin: '0 auto 16px',
            background: '#000',
            display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800, color: '#fff',
          }}>V</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#000', letterSpacing: '-0.8px', margin: '0 0 6px' }}>
            Create your account
          </h1>
          <p style={{ color: '#000', fontSize: 14, margin: 0 }}>Join VascuAI research platform</p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '32px' }}>
          <form id="register-form" onSubmit={submit}>
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                background: '#fff', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 10,
                color: '#000', fontSize: 13, marginBottom: 18,
              }}>
                <AlertCircle size={16} />{error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="name">Full name</label>
                <input id="name" name="name" type="text" className="form-input"
                  placeholder="Dr. Jane Smith" value={form.name} onChange={handle} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="reg-email">Email</label>
                <input id="reg-email" name="email" type="email" className="form-input"
                  placeholder="you@research.med" value={form.email} onChange={handle} required />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 14 }}>
              <label className="form-label" htmlFor="institution">Institution</label>
              <input id="institution" name="institution" type="text" className="form-input"
                placeholder="City Medical Center" value={form.institution} onChange={handle} />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="role">Role</label>
              <select id="role" name="role" className="form-select" value={form.role} onChange={handle}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <p className="form-hint">Administrator access can only be assigned by an existing administrator.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="reg-password">Password</label>
                <div style={{ position: 'relative' }}>
                  <input id="reg-password" name="password" type={showPw ? 'text' : 'password'}
                    className="form-input" placeholder="Min. 12 characters"
                    value={form.password} onChange={handle} required style={{ paddingRight: 44 }} />
                  <button type="button" onClick={() => setShowPw((s) => !s)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#000' }}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="confirm">Confirm password</label>
                <input id="confirm" name="confirm" type="password" className="form-input"
                  placeholder="Repeat password" value={form.confirm} onChange={handle} required />
              </div>
            </div>

            <div style={{ padding: '12px 14px', background: '#fff', border: '1px solid #000', borderRadius: 10, marginTop: 16, fontSize: 12, color: '#000' }}>
              ⚠ Do not upload real patient-identifiable information. De-identify all data before use.
            </div>

            <button id="register-submit-btn" type="submit" className="btn btn-primary btn-lg"
              style={{ width: '100%', justifyContent: 'center', marginTop: 20 }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', color: '#000', fontSize: 13.5, marginTop: 20 }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#000', fontWeight: 600 }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
