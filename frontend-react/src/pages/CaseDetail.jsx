import { useCallback, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  FileText,
  ArrowUpRight,
  ScanLine,
  Check,
  Pencil,
  ShieldCheck,
  History,
  Layers,
  Info,
} from "lucide-react";
import AppShell from "../components/AppShell";
import UploadPanel from "../components/UploadPanel";
import { ImageMetadata, VolumeMetadata } from "../components/CaseMetadata";
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  StatusBadge,
  Metadata,
  EmptyState,
} from "../components/ui";
import { formatDate } from "../lib/format";
import { useRemote } from "../hooks/useRemote";
import { useCase } from "../hooks/useCase";
import { casesApi } from "../api/cases";
import { useAuth } from "../context/AuthContext";
import { MODALITIES, REGIONS } from "../constants/case-options";

export function CaseTabs({ id }) {
  return (
    <nav className="case-tabs" aria-label="Case sections">
      {[
        ["", "Overview"],
        ["/imaging", "Imaging & metadata"],
        ["/analysis", "Segmentation"],
        ["/stenosis", "Stenosis"],
        ["/history", "Study history"],
      ].map(([path, label]) => (
        <NavLink
          end
          key={path}
          to={`/cases/${id}${path}`}
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
export default function CaseDetail() {
  const { id } = useParams();
  const { isRole } = useAuth();
  const { data: item, loading, error, reload } = useCase();
  const [editing, setEditing] = useState(false);
  const [uploadSaved, setUploadSaved] = useState(false);
  const metadataLoader = useCallback(async () => {
    const result = await Promise.allSettled([
      casesApi.getImageMetadata(id),
      casesApi.getVolumeMetadata(id),
    ]);
    return result.map((r) =>
      r.status === "fulfilled"
        ? { data: r.value, error: null }
        : { data: null, error: r.reason },
    );
  }, [id]);
  const meta = useRemote(metadataLoader);
  function uploaded() {
    setUploadSaved(true);
    reload();
    meta.reload();
  }
  if (loading)
    return (
      <AppShell breadcrumbs={[{ label: "Cases", href: "/cases" }]}>
        <Loading />
      </AppShell>
    );
  if (error)
    return (
      <AppShell>
        <ErrorState error={error} retry={reload} />
      </AppShell>
    );
  return (
    <AppShell
      breadcrumbs={[
        { label: "Cases", href: "/cases" },
        { label: item.caseCode },
      ]}
    >
      <PageHeader
        eyebrow="STUDY WORKSPACE"
        title={item.caseCode}
        description={`${item.studyType} · Subject #${item.patientId}`}
      >
        <Link className="btn btn-ghost" to={`/reports/${id}`}>
          <FileText size={14} />
          Case summary
        </Link>
        <StatusBadge status={item.status} />
      </PageHeader>
      <CaseTabs id={id} />
      {uploadSaved && (
        <div className="notice success" role="status">
          Study upload accepted. The recorded metadata has been refreshed.
        </div>
      )}
      <div className="two-column">
        <div className="stack">
          <Panel
            title="Study intake"
            description="Upload progress and input availability"
          >
            <div className="pipeline">
              {[
                "Case created",
                "Study uploaded",
                "Metadata available",
                "Model analysis",
                "Review",
              ].map((s, i) => (
                <div
                  className={`pipeline-stage${i === 0 || (i === 1 && (item.hasImage || item.hasVolume)) || (i === 2 && meta.data?.some((m) => m.data)) ? " done" : ""}`}
                  key={s}
                >
                  <span>
                    {i === 0 ||
                    (i === 1 && (item.hasImage || item.hasVolume)) ||
                    (i === 2 && meta.data?.some((m) => m.data)) ? (
                      <Check size={12} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  <strong>{s}</strong>
                </div>
              ))}
            </div>
            <UploadPanel key={item.id} caseData={item} onUploaded={uploaded} />
          </Panel>
          <div className="equal-columns">
            <Panel
              title="2D image metadata"
              action={
                <span className="badge badge-gray">
                  {item.hasImage ? "Uploaded" : "No file"}
                </span>
              }
            >
              {meta.loading ? (
                <Loading />
              ) : meta.data?.[0].error ? (
                <ErrorState error={meta.data[0].error} retry={meta.reload} />
              ) : (
                <ImageMetadata metadata={meta.data?.[0].data} />
              )}
            </Panel>
            <Panel
              title="Volume metadata"
              action={
                <span className="badge badge-gray">
                  {item.hasVolume ? "Uploaded" : "No file"}
                </span>
              }
            >
              {meta.loading ? (
                <Loading />
              ) : meta.data?.[1].error ? (
                <ErrorState error={meta.data[1].error} retry={meta.reload} />
              ) : (
                <VolumeMetadata metadata={meta.data?.[1].data} />
              )}
            </Panel>
          </div>
          <Panel
            title="Experimental segmentation"
            action={
              <Link className="text-link" to={`/cases/${id}/analysis`}>
                Open segmentation
                <ArrowUpRight size={13} />
              </Link>
            }
          >
            <div className="notice" style={{ margin: 0 }}>
              <Layers size={18} />
              <span>
                Run experimental 3D CT artery segmentation, inspect saved runs,
                and securely download NIfTI outputs in the segmentation workspace.
                Stenosis, severity and clinical findings remain unavailable.
              </span>
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel
            title="Case record"
            action={
              isRole("Clinician", "Admin") && (
                <button
                  className="icon-btn"
                  aria-label="Edit case metadata"
                  onClick={() => setEditing(!editing)}
                >
                  <Pencil size={14} />
                </button>
              )
            }
          >
            {editing ? (
              <CaseEdit
                item={item}
                onSaved={() => {
                  setEditing(false);
                  reload();
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <Metadata
                items={[
                  ["Reference", item.caseCode],
                  ["Subject", `#${item.patientId}`],
                  ["Study type", item.studyType],
                  ["Modality", item.modality],
                  ["Anatomy", item.region],
                  [
                    "Scan date",
                    item.scanDate ? formatDate(item.scanDate) : null,
                  ],
                  ["Age", item.age != null ? `${item.age} years` : null],
                  ["Sex", { M: "Male", F: "Female", O: "Other" }[item.gender]],
                  ["Created", formatDate(item.createdAt, true)],
                ]}
              />
            )}
          </Panel>
          <Panel title="Study notes">
            <p
              className="text-sm text-muted"
              style={{ lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}
            >
              {item.notes || "No notes recorded for this study."}
            </p>
          </Panel>
          <div className="notice">
            <ShieldCheck size={17} />
            <span>
              Research use only. Check the segmentation workspace for recorded
              outputs; a completed case status does not establish a clinical finding.
            </span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
function CaseEdit({ item, onSaved, onCancel }) {
  const [form, setForm] = useState({
    studyType: item.studyType,
    modality: item.modality || "",
    region: item.region || "",
    scanDate: item.scanDate || "",
    age: item.age ?? "",
    gender: item.gender || "",
    notes: item.notes || "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (
      ["modality", "region", "scanDate", "age", "gender", "notes"].some(
        (key) =>
          item[key] != null &&
          item[key] !== "" &&
          String(form[key]).trim() === "",
      )
    ) {
      setError(
        "Existing metadata cannot be cleared in this deployment. Replace the value, or cancel to keep the current record.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await casesApi.update(item.id, form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  return (
    <form onSubmit={submit}>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="form-group">
        <label className="form-label" htmlFor="edit-study">
          Study type
        </label>
        <input
          id="edit-study"
          name="studyType"
          className="form-input"
          required
          maxLength={100}
          value={form.studyType}
          onChange={handle}
        />
      </div>
      {[
        ["modality", "Modality", MODALITIES],
        ["region", "Anatomy", REGIONS],
      ].map(([key, label, options]) => (
        <div key={key} className="form-group">
          <label className="form-label" htmlFor={`edit-${key}`}>
            {label}
          </label>
          <select
            id={`edit-${key}`}
            className="form-select"
            name={key}
            value={form[key]}
            onChange={handle}
          >
            <option value="">Not recorded</option>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      ))}
      <div className="form-group">
        <label className="form-label" htmlFor="edit-date">
          Scan date
        </label>
        <input
          id="edit-date"
          type="date"
          name="scanDate"
          className="form-input"
          value={form.scanDate}
          onChange={handle}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="edit-age">
          Age in years
        </label>
        <input
          id="edit-age"
          type="number"
          min={0}
          max={120}
          name="age"
          className="form-input"
          value={form.age}
          onChange={handle}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="edit-sex">
          Sex recorded in study
        </label>
        <select
          id="edit-sex"
          className="form-select"
          name="gender"
          value={form.gender}
          onChange={handle}
        >
          <option value="">Not recorded</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
          <option value="O">Other</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="edit-notes">
          Study notes
        </label>
        <textarea
          id="edit-notes"
          className="form-textarea"
          name="notes"
          value={form.notes}
          onChange={handle}
          maxLength={2000}
        />
      </div>
      <div className="page-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function CaseHistory() {
  const { id } = useParams();
  const { data: item, loading, error, reload } = useCase();
  const { data: volume } = useRemote(
    useCallback(() => casesApi.getVolumeMetadata(id), [id]),
  );
  return (
    <AppShell
      breadcrumbs={[
        { label: "Cases", href: "/cases" },
        { label: item?.caseCode || id, href: `/cases/${id}` },
        { label: "History" },
      ]}
    >
      <PageHeader
        eyebrow="STUDY PROVENANCE"
        title="The story of this study."
        description="Available timestamps and records for this case."
      />
      <CaseTabs id={id} />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <div className="two-column">
          <Panel title="Recorded events">
            <div className="timeline">
              <div className="timeline-event">
                <h3>Case created</h3>
                <p>
                  {formatDate(item.createdAt, true)}
                  <br />
                  {item.caseCode} linked to subject #{item.patientId}.
                </p>
              </div>
              {volume?.uploaded_at && (
                <div className="timeline-event">
                  <h3>NIfTI volume uploaded</h3>
                  <p>
                    {formatDate(volume.uploaded_at, true)}
                    <br />
                    Header metadata recorded.
                  </p>
                </div>
              )}
              {item.hasImage && (
                <div className="timeline-event">
                  <h3>2D image available</h3>
                  <p>Upload timestamp not exposed by the current image API.</p>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Analysis history">
            <EmptyState
              icon={History}
              title="Segmentation run history"
              description="Saved segmentation timestamps, model provenance and downloads are available in the segmentation workspace."
            >
              <Link className="btn btn-ghost" to={`/cases/${id}/analysis`}>View segmentation history</Link>
            </EmptyState>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
export function Imaging() {
  const { id } = useParams();
  const { data: item, loading, error, reload } = useCase();
  const meta = useRemote(
    useCallback(
      () =>
        Promise.all([
          casesApi.getImageMetadata(id),
          casesApi.getVolumeMetadata(id),
        ]),
      [id],
    ),
  );
  return (
    <AppShell
      breadcrumbs={[
        { label: "Cases", href: "/cases" },
        { label: item?.caseCode || id, href: `/cases/${id}` },
        { label: "Imaging" },
      ]}
    >
      <PageHeader
        eyebrow="IMAGING WORKSPACE"
        title="Keep the source in focus."
        description="Inspect image geometry and the spatial context of your study."
      />
      <CaseTabs id={id} />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <div className="two-column">
          <div className="stack">
            <section className="viewer-panel">
              <div className="viewer-toolbar">
                <strong>{item.caseCode} / Imaging</strong>
                <span>Metadata inspection</span>
              </div>
              <div className="viewer-canvas">
                <ScanLine size={38} strokeWidth={1} />
                <strong style={{ fontSize: 14, fontWeight: 400 }}>
                  Source metadata and visualization
                </strong>
                <p>
                  {item.hasVolume
                    ? "Your volume is stored. Open the Segmentation workspace to view the original CT with a current saved prediction. Unsupported geometry remains available through protected downloads."
                    : item.hasImage ? "Your 2D image is stored. Inspect its metadata here; standalone 2D pixel viewing is not connected."
                    : "Upload a study from the case overview to inspect its metadata."}
                </p>
                <Link className="btn btn-light" to={`/cases/${id}${item.hasVolume ? '/analysis' : ''}`}>
                  {item.hasVolume ? 'Open segmentation workspace' : 'Open study intake'}
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </section>
            <Panel title="Spatial transform">
              {meta.data?.[1]?.affine ? (
                <>
                  <p className="text-xs text-muted">
                    NIfTI header affine · 4 × 4 matrix
                  </p>
                  <div className="table-wrapper">
                    <table className="data-table">
                      <tbody>
                        {[0, 1, 2, 3].map((row) => (
                          <tr key={row}>
                            {meta.data[1].affine
                              .slice(row * 4, row * 4 + 4)
                              .map((n, col) => (
                                <td className="mono" key={col}>
                                  {Number(n).toFixed(4)}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="notice" style={{ margin: 0 }}>
                  <Info size={15} />
                  Upload a NIfTI volume to inspect its affine transform.
                  Orientation is not inferred when unavailable.
                </div>
              )}
            </Panel>
          </div>
          <div className="stack">
            {meta.error && (
              <ErrorState error={meta.error} retry={meta.reload} />
            )}
            <Panel title="Source image">
              <ImageMetadata metadata={meta.data?.[0]} />
            </Panel>
            <Panel title="Source volume">
              <VolumeMetadata metadata={meta.data?.[1]} />
            </Panel>
            <Panel title="Result layers">
              <div className="text-xs text-muted" style={{ lineHeight: 2 }}>
                <Link to={`/cases/${id}/analysis`}>Check Segmentation for saved masks and viewing</Link>
                <br />
                Centerline — not available
                <br />
                Stenosis regions — not available
                <br />
                Explanation map — not available
              </div>
            </Panel>
          </div>
        </div>
      )}
    </AppShell>
  );
}
