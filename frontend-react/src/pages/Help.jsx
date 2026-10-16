import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, BookOpen } from "lucide-react";
import AppShell from "../components/AppShell";
import Brand from "../components/Brand";
import { PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";

const sections = [
  ["start", "Getting started"],
  ["uploads", "Study uploads"],
  ["imaging", "Imaging & metadata"],
  ["research", "Research methodology"],
  ["exports", "Reports & exports"],
  ["access", "Roles & access"],
  ["troubleshooting", "Troubleshooting"],
  ["limitations", "Intended use"],
];
export default function Help() {
  const { user } = useAuth();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  const body = (
    <>
      <PageHeader
        eyebrow="THE RESEARCH HANDBOOK"
        title="A little context goes a long way."
        description="A practical guide to the workspace and its current capabilities."
      />
      <div className="help-layout">
        <nav className="help-index" aria-label="Documentation sections">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div>
          <section className="help-section" id="start">
            <h2>01 / Getting started</h2>
            <p>
              VascuAI organizes de-identified studies and their research
              context. Create an account or sign in, register a research
              subject, then create a case. A Clinician or Administrator can add
              study files and update case metadata. Researchers and Data
              Scientists can inspect case records and metadata.
            </p>
            <Link className="text-link" to={user ? "/dashboard" : "/register"}>
              {user ? "Open workspace" : "Create an account"}
              <ArrowRight size={13} />
            </Link>
          </section>
          <section className="help-section" id="uploads">
            <h2>02 / Study uploads</h2>
            <ul>
              <li>
                2D images: PNG, JPEG, or TIFF; up to 20 MB and 8,192 pixels per
                side.
              </li>
              <li>Raw NIfTI: .nii files up to 2,000 MB.</li>
              <li>
                Compressed NIfTI: .nii.gz files up to 512 MB, with a 2,000 MB
                decompression limit.
              </li>
              <li>
                NIfTI ingestion supports 3D and 4D header metadata. It preserves
                the volume instead of converting it to a screenshot.
              </li>
              <li>
                DICOM files and DICOM series are not supported. Convert using an
                appropriate research workflow before upload.
              </li>
            </ul>
            <p>
              The upload center checks file extension and size in your browser.
              The server validates the actual file. Upload progress reports
              bytes transferred; server validation may continue after transfer
              reaches 100%. Cancelling a browser transfer does not roll back a
              file already received by the server.
            </p>
            <p>
              Replacing a study file requires an explicit acknowledgement.
              Previous upload versions are not retained by the current backend.
            </p>
          </section>
          <section className="help-section" id="imaging">
            <h2>03 / Imaging & metadata</h2>
            <p>
              Image metadata includes format, dimensions, channels, and data
              type. NIfTI metadata includes dimensions, spacing, spatial units,
              affine transform, and header codes. Missing metadata is shown as
              unavailable.
            </p>
            <p>
              2D upload preprocessing includes grayscale conversion, denoising,
              enhancement, and normalization on the server. These
              transformations do not run a segmentation model. NIfTI ingestion
              reads the header without performing volumetric preprocessing or
              loading voxel data into the interface.
            </p>
            <p>
              A protected pixel-serving API and a medical viewer are required
              for axial, coronal, sagittal, and 3D viewing. This deployment
              provides metadata inspection rather than simulated scan images.
            </p>
          </section>
          <section className="help-section" id="research">
            <h2>04 / Research methodology</h2>
            <p>
              Segmentation, stenosis detection, severity classification, and
              model explanation are distinct capabilities. Each requires
              suitable data, an implemented method, and recorded evaluation
              evidence.
            </p>
            <p>
              A reproducible run should preserve the input study, preprocessing
              settings, model artifact, code version, inference parameters,
              timestamp, and output artifacts. A meaningful comparison uses the
              same dataset split, reference annotations, and evaluation
              protocol.
            </p>
            <p>
              Segmentation evaluation may include Dice, IoU, precision, recall,
              Hausdorff distance, and surface distance. Detection and
              classification metrics belong in separate evaluations. No such
              scores are available from the current API.
            </p>
            <p>
              Dataset registration, train / validation / test manifests, model
              registry, training jobs, and evaluation runs are not connected. No
              dataset source, model architecture, or performance is assumed.
            </p>
          </section>
          <section className="help-section" id="exports">
            <h2>05 / Reports & exports</h2>
            <p>
              The export center generates case metadata summaries on demand.
              JSON and CSV exports include selected case fields. Open a summary
              and choose Print / save PDF to use your browser’s print dialog.
            </p>
            <p>
              Exported summaries do not contain inference findings or clinical
              measurements. The preparation date is an export timestamp, not an
              analysis timestamp. Server storage paths are excluded.
            </p>
          </section>
          <section className="help-section" id="access">
            <h2>06 / Roles & access</h2>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Clinician</th>
                    <th>Researcher</th>
                    <th>Data Scientist</th>
                    <th>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Read cases & metadata", "Yes", "Yes", "Yes", "Yes"],
                    [
                      "Register patients / create & edit cases",
                      "Yes",
                      "No",
                      "No",
                      "Yes",
                    ],
                    ["Upload study files", "Yes", "No", "No", "Yes"],
                    ["Research readiness screens", "No", "Yes", "Yes", "Yes"],
                    ["Manage users & audit events", "No", "No", "No", "Yes"],
                  ].map((row) => (
                    <tr key={row[0]}>
                      {row.map((value, i) => (
                        <td key={i}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 16 }}>
              Server checks control data access. Frontend navigation reflects
              these permissions. Public registration cannot grant administrator
              access. Profile updates and password changes use the authenticated
              account API.
            </p>
          </section>
          <section className="help-section" id="troubleshooting">
            <h2>07 / Troubleshooting</h2>
            <details>
              <summary>My study upload was rejected.</summary>
              <p>
                Check the file extension, size, and validity. Renaming a file
                does not convert it. Inspect the error returned by the server. A
                TIFF may be accepted without a browser preview.
              </p>
            </details>
            <details>
              <summary>
                I can’t see patient management or upload controls.
              </summary>
              <p>
                These actions require Clinician or Administrator permissions.
                Researchers and Data Scientists have read access to case records
                and study metadata.
              </p>
            </details>
            <details>
              <summary>My case has no analysis results.</summary>
              <p>
                This deployment does not connect an inference service. A
                successful upload or a Complete case status is not evidence of
                an AI result.
              </p>
            </details>
            <details>
              <summary>I forgot my password.</summary>
              <p>
                Self-service password reset is not implemented. Contact your
                workspace administrator. If signed in, change your password
                through Account settings.
              </p>
            </details>
          </section>
          <section className="help-section" id="limitations">
            <h2>08 / Intended use & limitations</h2>
            <p>
              VascuAI is a medical imaging research prototype, not an autonomous
              diagnostic system. Use public or de-identified data. Clinical
              findings, calibrated confidence, measurement accuracy, and
              regulatory approval are not claimed.
            </p>
            <p>
              Authentication, patient registration, case management, study
              ingestion, metadata reads, and audit events are backed by server
              APIs. Case summaries and activity notifications are assembled in
              your browser from accessible case records. Display preferences and
              notification read states are stored on this device.
            </p>
          </section>
        </div>
      </div>
    </>
  );
  return user ? (
    <AppShell breadcrumbs={[{ label: "Documentation" }]}>{body}</AppShell>
  ) : (
    <>
      <header className="public-nav">
        <Brand />
        <Link className="btn btn-primary" to="/login">
          Sign in
          <ArrowRight size={14} />
        </Link>
      </header>
      <main className="public-section" style={{ paddingTop: 35 }}>
        {body}
      </main>
      <footer className="public-footer">
        <span>VascuAI / Research documentation</span>
        <span>
          <BookOpen size={13} style={{ display: "inline", marginRight: 5 }} />
          Research prototype · Qualified review required
        </span>
      </footer>
    </>
  );
}
