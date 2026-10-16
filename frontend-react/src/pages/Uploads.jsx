import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ArrowUpRight, ScanLine } from "lucide-react";
import AppShell from "../components/AppShell";
import UploadPanel from "../components/UploadPanel";
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  EmptyState,
} from "../components/ui";
import { casesApi } from "../api/cases";
import { useRemote } from "../hooks/useRemote";
import { useAuth } from "../context/AuthContext";

export default function Uploads() {
  const { isRole } = useAuth();
  const { data, loading, error, reload } = useRemote(casesApi.list);
  const [selected, setSelected] = useState("");
  const [uploadSaved, setUploadSaved] = useState(false);
  const item = data?.find((c) => String(c.id) === selected);
  return (
    <AppShell breadcrumbs={[{ label: "Upload center" }]}>
      <PageHeader
        eyebrow="STUDY INTAKE"
        title="Good research starts with good input."
        description="Add a study to an existing case, then inspect its metadata."
      >
        {isRole("Clinician", "Admin") && (
          <Link className="btn btn-ghost" to="/cases/new">
            Create a case first
            <ArrowUpRight size={14} />
          </Link>
        )}
      </PageHeader>
      {uploadSaved && (
        <div className="notice success" role="status">
          Study upload accepted. Open the case to inspect the recorded metadata.
        </div>
      )}
      <div className="two-column">
        <Panel
          title="Upload a study"
          description="One file per upload, associated with a case."
        >
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} retry={reload} />
          ) : !data.length ? (
            <EmptyState
              icon={ScanLine}
              title="Create a case to get started"
              description="Each study file needs an associated case record."
            >
              {isRole("Clinician", "Admin") && (
                <Link className="btn btn-primary" to="/cases/new">
                  Create case
                </Link>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="upload-case">
                  Select a case
                </label>
                <select
                  className="form-select"
                  id="upload-case"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose a case…</option>
                  {data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.caseCode} · {c.modality || c.studyType}
                    </option>
                  ))}
                </select>
              </div>
              {item ? (
                <>
                  <UploadPanel
                    key={item.id}
                    caseData={item}
                    onUploaded={() => {
                      setUploadSaved(true);
                      reload();
                    }}
                  />
                  <Link
                    className="text-link"
                    to={`/cases/${item.id}`}
                    style={{ marginTop: 20 }}
                  >
                    Inspect case & metadata
                    <ArrowUpRight size={13} />
                  </Link>
                </>
              ) : (
                <EmptyState
                  icon={ScanLine}
                  title="Choose the home for your study"
                  description="Select a case above to add its imaging file."
                />
              )}
            </>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Format guide">
            <dl className="metadata-list">
              <div>
                <dt>2D images</dt>
                <dd>
                  PNG, JPEG, TIFF
                  <br />
                  20 MB maximum
                </dd>
              </div>
              <div>
                <dt>Raw NIfTI</dt>
                <dd>
                  .nii
                  <br />
                  2,000 MB maximum
                </dd>
              </div>
              <div>
                <dt>Compressed NIfTI</dt>
                <dd>
                  .nii.gz
                  <br />
                  512 MB maximum
                </dd>
              </div>
              <div>
                <dt>Medical volumes</dt>
                <dd>3D and 4D metadata</dd>
              </div>
              <div>
                <dt>DICOM</dt>
                <dd>Not supported</dd>
              </div>
            </dl>
          </Panel>
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              De-identify filenames, image content, and embedded metadata before
              uploading.
            </span>
          </div>
          <Panel title="A note on validation">
            <p
              className="text-sm text-muted"
              style={{ lineHeight: 1.9, margin: 0 }}
            >
              A successful upload confirms input acceptance. It does not
              establish diagnostic quality or model compatibility. Review the
              recorded geometry and metadata before downstream research.
            </p>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
