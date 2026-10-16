import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ShieldCheck, UserPlus, ScanLine } from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Panel, ErrorState, Loading } from "../components/ui";
import { useRemote } from "../hooks/useRemote";
import { patientsApi } from "../api/patients";
import { casesApi } from "../api/cases";
import { MODALITIES, REGIONS } from "../constants/case-options";

export default function NewCase() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const {
    data: patients,
    loading,
    error: loadError,
    reload,
  } = useRemote(patientsApi.list);
  const [form, setForm] = useState({
    patientId: params.get("patient") || "",
    caseCode: "",
    studyType: "Coronary Artery Analysis",
    modality: "",
    region: "",
    scanDate: "",
    age: "",
    gender: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const item = await casesApi.create(form);
      navigate(`/cases/${item.id}`);
    } catch (err) {
      setError(err.message || "Unable to create your case.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell
      breadcrumbs={[{ label: "Cases", href: "/cases" }, { label: "New case" }]}
    >
      <PageHeader
        eyebrow="A NEW STUDY"
        title="Give your study a home."
        description="Link a subject, record the context, then add your study files."
      />
      <div className="two-column">
        <Panel
          title="Case information"
          description="Required fields are marked with an asterisk."
        >
          {loadError ? (
            <ErrorState error={loadError} retry={reload} />
          ) : loading ? (
            <Loading label="Loading research subjects…" />
          ) : (
            <form id="new-case-form" onSubmit={submit}>
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="case-patient">
                  Research subject *
                </label>
                <select
                  className="form-select"
                  id="case-patient"
                  name="patientId"
                  value={form.patientId}
                  onChange={handle}
                  required
                >
                  <option value="">Select an existing subject</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.patientCode} · {p.displayName}
                    </option>
                  ))}
                </select>
                <Link
                  className="text-link"
                  style={{ marginTop: 10 }}
                  to="/patients/new"
                >
                  <UserPlus size={12} />
                  Register a new subject
                </Link>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="case-code">
                    Case reference *
                  </label>
                  <input
                    id="case-code"
                    name="caseCode"
                    className="form-input"
                    required
                    minLength={2}
                    maxLength={50}
                    placeholder="CASE-0001"
                    value={form.caseCode}
                    onChange={handle}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="study-type">
                    Study type *
                  </label>
                  <input
                    id="study-type"
                    name="studyType"
                    className="form-input"
                    required
                    maxLength={100}
                    value={form.studyType}
                    onChange={handle}
                  />
                </div>
              </div>
              <hr className="form-divider" />
              <h3 className="form-section-title">
                Study context <span className="text-muted">/ optional</span>
              </h3>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="modality" className="form-label">
                    Imaging modality
                  </label>
                  <select
                    id="modality"
                    name="modality"
                    className="form-select"
                    value={form.modality}
                    onChange={handle}
                  >
                    <option value="">Not recorded</option>
                    {MODALITIES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="region" className="form-label">
                    Anatomical region
                  </label>
                  <select
                    id="region"
                    name="region"
                    className="form-select"
                    value={form.region}
                    onChange={handle}
                  >
                    <option value="">Not recorded</option>
                    {REGIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="scan-date" className="form-label">
                    Scan date
                  </label>
                  <input
                    id="scan-date"
                    name="scanDate"
                    className="form-input"
                    type="date"
                    value={form.scanDate}
                    onChange={handle}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="age" className="form-label">
                    Age in years
                  </label>
                  <input
                    id="age"
                    name="age"
                    className="form-input"
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    value={form.age}
                    onChange={handle}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="sex" className="form-label">
                    Sex recorded in study
                  </label>
                  <select
                    id="sex"
                    name="gender"
                    className="form-select"
                    value={form.gender}
                    onChange={handle}
                  >
                    <option value="">Not recorded</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="case-notes">
                  Study notes
                </label>
                <textarea
                  id="case-notes"
                  name="notes"
                  className="form-textarea"
                  maxLength={2000}
                  value={form.notes}
                  onChange={handle}
                  placeholder="Relevant, de-identified study context"
                />
              </div>
              <div className="page-actions">
                <button
                  className="btn btn-primary"
                  id="create-case-btn"
                  disabled={busy || !patients.length}
                >
                  {busy ? "Creating case…" : "Create case & continue"}
                  <ArrowRight size={14} />
                </button>
                <Link className="btn btn-ghost" to="/cases">
                  Cancel
                </Link>
              </div>
            </form>
          )}
        </Panel>
        <div className="stack">
          <Panel title="What happens next?">
            <div className="timeline">
              {[
                [
                  "Create your case",
                  "A persistent record, linked to your research subject.",
                ],
                ["Add study files", "Upload a 2D image or a NIfTI volume."],
                [
                  "Inspect your input",
                  "Review format, dimensions, and spatial metadata.",
                ],
              ].map(([t, d]) => (
                <div className="timeline-event" key={t}>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </Panel>
          <div className="notice">
            <ShieldCheck size={17} />
            <span>
              Keep names, birth dates, and identifying metadata out of study
              notes and uploaded files.
            </span>
          </div>
          <Panel title="Supported input">
            <ScanLine size={23} strokeWidth={1.5} />
            <p
              className="text-sm text-muted"
              style={{ lineHeight: 1.9, margin: "14px 0" }}
            >
              PNG, JPEG, TIFF
              <br />
              NIfTI (.nii and .nii.gz)
            </p>
            <Link className="text-link" to="/help#uploads">
              View upload guidance
              <ArrowRight size={13} />
            </Link>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
