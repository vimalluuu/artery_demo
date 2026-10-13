import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DEMO_USERS } from '../api/auth';
import { Eye, EyeOff, AlertCircle, ShieldAlert } from 'lucide-react';

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 0.9fr) minmax(400px, 1.1fr)', minHeight: '100vh' }}>

      {/* Left brand panel */}
      <section style={{
        background: 'linear-gradient(145deg, #0d1b2a 0%, #0f2744 55%, #142e52 100%)',
        padding: 'clamp(36px,5vw,72px)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'linear-gradient(135deg, #14b8a6, #3b82f6)',
            display: 'grid', placeItems: 'center',
            fontSize: 22, fontWeight: 800, color: '#fff',
          }}>V</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>
              Vascu<span style={{ color: '#5eead4' }}>AI</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.7)' }}>Medical Research Platform</div>
          </div>
        </div>

        {/* Hero copy */}
        <div style={{ maxWidth: 440, margin: '40px auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.8px', color: '#5eead4', textTransform: 'uppercase', marginBottom: 16 }}>
            AI-Powered Medical Research
          </div>
          <h1 style={{ fontSize: 'clamp(38px,4.5vw,60px)', fontWeight: 800, letterSpacing: '-2.5px', lineHeight: 1.05, margin: '0 0 20px', color: '#fff' }}>
            See beyond<br />the scan.
          </h1>
          <p style={{ color: '#9eb5cc', fontSize: 15, lineHeight: 1.85, margin: 0 }}>
            Advanced deep learning for artery segmentation and stenosis analysis,
            designed to support medical imaging research.
          </p>

          <div style={{ marginTop: 36, display: 'grid', gap: 16 }}>
            {['AI-assisted artery segmentation', 'Structured stenosis analysis', 'Research-focused model evaluation'].map((f) => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#dce8f4', fontSize: 13.5 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'rgba(94,234,212,0.12)',
                  border: '1px solid rgba(94,234,212,0.3)',
                  display: 'grid', placeItems: 'center',
                  color: '#5eead4', fontSize: 12, flexShrink: 0,
                }}>✓</div>
                {f}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#7fa3c0', fontSize: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#5eead4' }} />
          Academic research prototype — authorised accounts only
        </div>
      </section>

      {/* Right login panel */}
      <section style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '48px clamp(24px,5vw,80px) 28px', background: '#f7f9fc',
      }}>
        <div style={{ width: '100%', maxWidth: 420 }}>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#2563eb', marginBottom: 10 }}>
              WELCOME BACK
            </div>
            <h2 style={{ fontSize: 'clamp(26px,3vw,34px)', fontWeight: 800, color: '#0f172a', letterSpacing: '-1px', margin: '0 0 8px' }}>
              Sign in to your workspace
            </h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>Enter your research credentials to continue.</p>
          </div>

          {/* Quick Demo Credentials */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                ⚡ Quick Demo Accounts
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Click to auto-fill</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button
                type="button"
                id="demo-admin-btn"
                onClick={() => setForm({ email: 'admin@research.med', password: 'adminpassword123' })}
                style={{
                  padding: '8px 6px',
                  borderRadius: 8,
                  border: form.email === 'admin@research.med' ? '1.5px solid #dc2626' : '1px solid #fee2e2',
                  background: form.email === 'admin@research.med' ? '#fef2f2' : '#fff5f5',
                  color: '#991b1b',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                👑 Admin
              </button>
              <button
                type="button"
                id="demo-clinician-btn"
                onClick={() => setForm({ email: 'aisha.patel@research.med', password: 'clinicianpassword123' })}
                style={{
                  padding: '8px 6px',
                  borderRadius: 8,
                  border: form.email === 'aisha.patel@research.med' ? '1.5px solid #2563eb' : '1px solid #dbeafe',
                  background: form.email === 'aisha.patel@research.med' ? '#eff6ff' : '#f0f7ff',
                  color: '#1e40af',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                🩺 Clinician
              </button>
              <button
                type="button"
                id="demo-scientist-btn"
                onClick={() => setForm({ email: 'liu.wei@research.med', password: 'scientistpassword123' })}
                style={{
                  padding: '8px 6px',
                  borderRadius: 8,
                  border: form.email === 'liu.wei@research.med' ? '1.5px solid #7c3aed' : '1px solid #ede9fe',
                  background: form.email === 'liu.wei@research.med' ? '#f5f3ff' : '#faf5ff',
                  color: '#6d28d9',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                🔬 Scientist
              </button>
            </div>
          </div>

          <form id="login-form" onSubmit={submit}>
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                color: '#dc2626', fontSize: 13, marginBottom: 18,
              }}>
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="email">Email address</label>
              <input
                id="email" name="email" type="email"
                className="form-input" placeholder="you@research.med"
                value={form.email} onChange={handle}
                autoComplete="username" required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password" name="password" type={showPw ? 'text' : 'password'}
                  className="form-input" placeholder="Enter your password"
                  value={form.password} onChange={handle}
                  autoComplete="current-password" required
                  style={{ paddingRight: 46 }}
                />
                <button
                  type="button" aria-label={showPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPw((s) => !s)}
                  style={{
                    position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0,
                  }}
                >{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13.5, marginTop: 28 }}>
            New to VascuAI?{' '}
            <Link to="/register" style={{ color: '#2563eb', fontWeight: 600 }}>Create an account</Link>
          </p>

          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11.5, marginTop: 20 }}>
            ⓘ Use only authorised research accounts. All activity is logged.
          </p>
        </div>

        <footer style={{ marginTop: 48, textAlign: 'center', maxWidth: 380 }}>
          <p style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.7 }}>
            AI-generated outputs are for research purposes only and require qualified clinical review.
          </p>
          <span style={{ color: '#cbd5e1', fontSize: 10 }}>© 2026 VascuAI · Medical Imaging Research</span>
        </footer>
      </section>
    </div>
  );
}
