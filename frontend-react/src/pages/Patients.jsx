import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  Search,
  Users,
  ShieldCheck,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import AppShell from "../components/AppShell";
import CaseTable from "../components/CaseTable";
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  EmptyState,
  Metadata,
} from "../components/ui";
import { formatDate } from "../lib/format";
import { patientsApi } from "../api/patients";
import { casesApi } from "../api/cases";
import { useRemote } from "../hooks/useRemote";

const loadPatients = () => Promise.all([patientsApi.list(), casesApi.list()]);
export default function Patients() {
  const { data, loading, error, reload } = useRemote(loadPatients);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(1);
  const [patients, cases] = data || [[], []];
  const rows = patients
    .filter((p) =>
      `${p.patientCode} ${p.displayName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.displayName.localeCompare(b.displayName)
        : new Date(b.createdAt) - new Date(a.createdAt),
    );
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  return (
    <AppShell breadcrumbs={[{ label: "Patients" }]}>
      <PageHeader
        eyebrow="PATIENT MANAGEMENT"
        title="People behind the studies."
        description="A directory of de-identified research subjects and their cases."
      >
        <Link className="btn btn-primary" to="/patients/new">
          <Plus size={15} />
          Add patient
        </Link>
      </PageHeader>
      <div className="notice">
        <ShieldCheck size={16} />
        <span>
          Use pseudonymous subject labels. Keep identifying information outside
          this research workspace.
        </span>
      </div>
      <div className="filters-bar">
        <div className="search-bar">
          <Search size={15} />
          <input
            aria-label="Search patients"
            placeholder="Search subject reference or label…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="form-select filter-select"
          aria-label="Sort patients"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="newest">Newest first</option>
          <option value="name">Subject label A–Z</option>
        </select>
        <span className="text-xs text-muted">{rows.length} subjects</span>
      </div>
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject reference</th>
                  <th>Research label</th>
                  <th>Associated cases</th>
                  <th>Registered</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5}>
                      <Loading />
                    </td>
                  </tr>
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon={Users}
                        title="Your subject directory starts here"
                        description="Register a de-identified subject before creating their first case."
                      >
                        <Link className="btn btn-primary" to="/patients/new">
                          Add patient
                          <Plus size={14} />
                        </Link>
                      </EmptyState>
                    </td>
                  </tr>
                ) : (
                  rows.slice((page - 1) * 10, page * 10).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link className="table-code" to={`/patients/${p.id}`}>
                          {p.patientCode}
                        </Link>
                      </td>
                      <td>{p.displayName}</td>
                      <td>
                        {cases.filter((c) => c.patientId === p.id).length}{" "}
                        studies
                      </td>
                      <td className="text-muted">{formatDate(p.createdAt)}</td>
                      <td>
                        <Link
                          className="icon-btn"
                          to={`/patients/${p.id}`}
                          aria-label={`Open ${p.patientCode}`}
                        >
                          <ArrowUpRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>{rows.length} subjects</span>
            <div className="pagination">
              <button
                className="icon-btn"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              {page} / {pages}
              <button
                className="icon-btn"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
export function NewPatient() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
      patientCode: "",
      displayName: "",
      notes: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const patient = await patientsApi.create(form);
      navigate(`/patients/${patient.id}`);
    } catch (err) {
      setError(err.message || "Unable to save patient.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell
      breadcrumbs={[
        { label: "Patients", href: "/patients" },
        { label: "Add patient" },
      ]}
    >
      <PageHeader
        eyebrow="SUBJECT REGISTRATION"
        title="A new research subject."
        description="Start with a pseudonymous reference and a research label."
      />
      <div className="two-column">
        <Panel title="Subject information">
          <form onSubmit={submit}>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <div className="form-group">
              <label className="form-label" htmlFor="patient-code">
                Patient / subject reference
              </label>
              <input
                className="form-input"
                id="patient-code"
                required
                minLength={2}
                maxLength={50}
                value={form.patientCode}
                onChange={(e) =>
                  setForm({ ...form, patientCode: e.target.value })
                }
                placeholder="SUB-0001"
              />
              <p className="form-hint">
                A unique pseudonymous identifier, 2–50 characters.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="patient-label">
                Research label
              </label>
              <input
                className="form-input"
                id="patient-label"
                required
                maxLength={120}
                value={form.displayName}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
                placeholder="Research subject 001"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="patient-notes">
                Research notes <span className="text-muted">(optional)</span>
              </label>
              <textarea
                className="form-textarea"
                id="patient-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Relevant, de-identified context"
              />
            </div>
            <div className="page-actions">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Register subject"}
              </button>
              <Link className="btn btn-ghost" to="/patients">
                Cancel
              </Link>
            </div>
          </form>
        </Panel>
        <Panel title="Privacy by design">
          <ShieldCheck size={28} strokeWidth={1.5} />
          <p
            className="text-sm text-muted"
            style={{ lineHeight: 1.9, margin: "16px 0 0" }}
          >
            Use a research code instead of a name, hospital number, or date of
            birth. Case-specific age, modality, and study details belong in the
            associated case record.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
export function PatientDetail() {
  const { patientId } = useParams();
  const { data, loading, error, reload } = useRemote(loadPatients);
  const [patients, cases] = data || [[], []];
  const patient = patients.find((p) => String(p.id) === patientId);
  if (loading)
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  if (error)
    return (
      <AppShell>
        <ErrorState error={error} retry={reload} />
      </AppShell>
    );
  if (!patient)
    return (
      <AppShell>
        <EmptyState
          title="Subject not found"
          description="This subject is unavailable or you don’t have access."
        >
          <Link className="btn btn-ghost" to="/patients">
            Back to patients
          </Link>
        </EmptyState>
      </AppShell>
    );
  const linked = cases.filter((c) => c.patientId === patient.id);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Patients", href: "/patients" },
        { label: patient.patientCode },
      ]}
    >
      <PageHeader
        eyebrow="SUBJECT PROFILE"
        title={patient.displayName}
        description={`${patient.patientCode} · Registered ${formatDate(patient.createdAt)}`}
      >
        <Link
          className="btn btn-primary"
          to={`/cases/new?patient=${patient.id}`}
        >
          <Plus size={15} />
          Create case
        </Link>
      </PageHeader>
      <div className="two-column">
        <Panel
          title="Associated studies"
          description={`${linked.length} cases linked to this subject`}
        >
          <CaseTable cases={linked} />
        </Panel>
        <div className="stack">
          <Panel title="Subject record">
            <Metadata
              items={[
                ["Subject reference", patient.patientCode],
                ["Research label", patient.displayName],
                ["Registered", formatDate(patient.createdAt)],
                ["Associated studies", linked.length],
              ]}
            />
          </Panel>
          <Panel title="Research notes">
            <p
              className="text-sm text-muted"
              style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, margin: 0 }}
            >
              {patient.notes || "No research notes recorded."}
            </p>
          </Panel>
          <div className="notice">
            Patient record editing and longitudinal audit history are not
            available in this deployment. Case metadata can be updated from each
            case.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
