import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import AuthLayout from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    institution: "",
    role: "Clinician",
    password: "",
    confirm: "",
  });
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (user) return <Navigate to="/dashboard" replace />;
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const strength = [
    form.password.length >= 12,
    form.password.length >= 16,
    /[a-z]/.test(form.password) && /[A-Z]/.test(form.password),
    /[^a-zA-Z]/.test(form.password),
  ].filter(Boolean).length;
  async function submit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("Your passwords don’t match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await register(form);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Unable to create your account.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <div className="page-eyebrow">A NEW PERSPECTIVE STARTS HERE</div>
      <h2>Make room for discovery.</h2>
      <p>Create your research account.</p>
      <form id="register-form" onSubmit={submit}>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        <div className="form-grid">
          {[
            ["name", "Full name", "text", "Your name"],
            ["email", "Email address", "email", "you@institution.org"],
          ].map(([name, label, type, placeholder]) => (
            <div className="form-group" key={name}>
              <label className="form-label" htmlFor={`reg-${name}`}>
                {label}
              </label>
              <input
                id={`reg-${name}`}
                name={name}
                type={type}
                className="form-input"
                value={form[name]}
                onChange={change}
                placeholder={placeholder}
                required
                maxLength={name === "name" ? 120 : 254}
                autoComplete={name === "name" ? "name" : "email"}
              />
            </div>
          ))}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="institution">
            Institution <span className="text-muted">(optional)</span>
          </label>
          <input
            id="institution"
            name="institution"
            className="form-input"
            value={form.institution}
            onChange={change}
            placeholder="University or research center"
            maxLength={200}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="role">
            Your role
          </label>
          <select
            id="role"
            name="role"
            className="form-select"
            value={form.role}
            onChange={change}
          >
            <option value="Clinician">Radiologist / Clinician</option>
            <option value="Researcher">Medical Researcher</option>
            <option value="DataScientist">Data Scientist / ML Engineer</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="reg-password">
            Password
          </label>
          <div className="password-field">
            <input
              id="reg-password"
              name="password"
              type={show ? "text" : "password"}
              className="form-input"
              value={form.password}
              onChange={change}
              minLength={12}
              maxLength={128}
              required
              autoComplete="new-password"
              placeholder="At least 12 characters"
            />
            <button
              type="button"
              aria-label={show ? "Hide password" : "Show password"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="password-strength" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= strength ? "filled" : ""} />
            ))}
          </div>
          <p className="form-hint">
            Use a long, unique password of 12–128 characters.
          </p>
        </div>
        <div className="form-group">
          <label htmlFor="confirm" className="form-label">
            Confirm password
          </label>
          <input
            id="confirm"
            name="confirm"
            className="form-input"
            type="password"
            value={form.confirm}
            onChange={change}
            autoComplete="new-password"
            required
            maxLength={128}
          />
        </div>
        <label className="checkbox-row">
          <input type="checkbox" required />
          <span>
            I understand that this is a research prototype and will use only
            authorized, de-identified data.
          </span>
        </label>
        <button
          id="register-submit-btn"
          className="btn btn-primary btn-lg"
          disabled={busy}
        >
          {busy ? "Creating your account…" : "Create account"}
          <ArrowRight size={15} />
        </button>
      </form>
      <div className="auth-secondary">
        Already have an account? <Link to="/login">Sign in</Link>
      </div>
    </AuthLayout>
  );
}
