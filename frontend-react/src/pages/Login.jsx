import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";

export default function Login() {
  const { login, user, sessionError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const destination = location.state?.from
    ? `${location.state.from.pathname}${location.state.from.search || ""}${location.state.from.hash || ""}`
    : "/dashboard";
  if (user) return <Navigate to={destination} replace />;
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(form.email.trim(), form.password);
      navigate(destination, {
        replace: true,
      });
    } catch (err) {
      setError(err.message || "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <div className="page-eyebrow">WELCOME BACK</div>
      <h2>Good to see you again.</h2>
      <p>Sign in to continue your research.</p>
      <form id="login-form" onSubmit={submit}>
        {(error || sessionError) && (
          <div className="notice error" role="alert">
            <AlertCircle size={16} />
            {error || sessionError}
          </div>
        )}
        <div className="form-group">
          <label htmlFor="email" className="form-label">
            Email address
          </label>
          <input
            id="email"
            className="form-input"
            type="email"
            placeholder="you@institution.org"
            required
            autoComplete="username"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="form-group">
          <div className="flex-between" style={{ marginBottom: 8 }}>
            <label
              htmlFor="password"
              className="form-label"
              style={{ margin: 0 }}
            >
              Password
            </label>
            <Link to="/forgot-password" className="text-xs text-muted">
              Need help signing in?
            </Link>
          </div>
          <div className="password-field">
            <input
              id="password"
              type={show ? "text" : "password"}
              className="form-input"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button
              type="button"
              aria-label={show ? "Hide password" : "Show password"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <button
          id="login-submit-btn"
          className="btn btn-primary btn-lg"
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in to workspace"}
          <ArrowRight size={15} />
        </button>
      </form>
      <div className="auth-secondary">
        New to VascuAI? <Link to="/register">Create an account</Link>
      </div>
    </AuthLayout>
  );
}
