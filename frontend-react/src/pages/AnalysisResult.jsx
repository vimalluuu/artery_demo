import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Layers, LoaderCircle, Play, RefreshCw } from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Panel, Loading, ErrorState, EmptyState, Metadata } from "../components/ui";
import { CaseTabs } from "./CaseDetail";
import { useCase } from "../hooks/useCase";
import { useRemote } from "../hooks/useRemote";
import { useAuth } from "../context/AuthContext";
import { CLINICAL_WRITERS } from "../constants/permissions";
import { casesApi } from "../api/cases";
import { segmentationApi } from "../api/segmentation";
import { parseThreshold } from "../api/segmentation-contract";
import { saveArtifact, segmentationEligibility, segmentationError } from "../lib/segmentation";
import { formatDate } from "../lib/format";

export default function AnalysisResult() {
  const { id, analysisId } = useParams();
  const { data: item, loading, error, reload } = useCase();
  return (
    <AppShell breadcrumbs={[{ label: "Cases", href: "/cases" }, { label: item?.caseCode || id, href: `/cases/${id}` }, { label: "Segmentation" }]}>
      <PageHeader eyebrow="EXPERIMENTAL SEGMENTATION" title="Segmentation workspace" description="Run the trained artery model and retrieve its recorded outputs." />
      <CaseTabs id={id} />
      {loading ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> :
        <SegmentationWorkspace key={item.id} item={item} requestedId={analysisId} refreshCase={reload} />}
    </AppShell>
  );
}

function SegmentationWorkspace({ item, requestedId, refreshCase }) {
  const { isRole } = useAuth();
  const canRun = isRole(...CLINICAL_WRITERS);
  const history = useRemote(useCallback(() => segmentationApi.list(item.id), [item.id]));
  const volume = useRemote(useCallback(() => item.hasVolume ? casesApi.getVolumeMetadata(item.id) : Promise.resolve(null), [item.id, item.hasVolume]));
  const [threshold, setThreshold] = useState("0.70");
  const [thresholdError, setThresholdError] = useState("");
  const [run, setRun] = useState({ active: false, success: false, error: "" });
  const [download, setDownload] = useState({ key: "", error: "", success: "" });
  const submitting = useRef(false);
  const downloading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inputReason = volume.loading && item.hasVolume ? "Checking volume dimensions…" : volume.error ? "The input check failed. Retry loading volume metadata before running." : segmentationEligibility(item, volume.data);
  const inaccessible = history.error?.response?.status === 403;

  async function runSegmentation(event) {
    event.preventDefault();
    if (submitting.current || !canRun || inputReason || inaccessible) return;
    let selected;
    try { selected = parseThreshold(threshold); }
    catch (error) { setThresholdError(error.message); return; }
    setThresholdError("");
    submitting.current = true;
    setRun({ active: true, success: false, error: "" });
    try {
      await segmentationApi.run(item.id, selected);
      if (!mounted.current) return;
      setRun({ active: false, success: true, error: "" });
      history.reload(); // Read authoritative history; never insert the POST body.
    } catch (error) {
      if (mounted.current) setRun({ active: false, success: false, error: segmentationError(error) });
    } finally { submitting.current = false; }
  }

  async function downloadResult(result, artifact) {
    if (downloading.current || result.stale) return;
    downloading.current = true;
    const token = localStorage.getItem("vascuai_token");
    setDownload({ key: `${result.id}-${artifact}`, error: "", success: "" });
    try {
      const file = await segmentationApi.download(item.id, result.id, artifact);
      if (!mounted.current) return;
      if (token !== localStorage.getItem("vascuai_token")) throw new Error("Your session changed. Request the download again.");
      saveArtifact(file);
      setDownload({ key: "", error: "", success: "Download handed to your browser." });
    } catch (error) {
      if (mounted.current) {
        setDownload({ key: "", error: segmentationError(error, "download"), success: "" });
        if (error.response?.status === 409) history.reload();
      }
    } finally { downloading.current = false; }
  }

  return (
    <div className="stack segmentation-workspace">
      <div className="notice"><Layers size={18} aria-hidden="true" /><span>Experimental research outputs; not clinically validated. Stenosis detection, severity estimation, calibrated confidence and clinical findings are not implemented.</span></div>
      <div className="two-column">
        <Panel title="Run segmentation" description="SmallUNet3D · three-dimensional CT only">
          {volume.loading && item.hasVolume ? <Loading label="Checking volume dimensions…" /> : volume.error ? <ErrorState error={volume.error} retry={volume.reload} /> :
            <p className="text-sm text-muted">{inputReason || "A 3D CT NIfTI volume is recorded. Model and input availability are checked when a run starts."}</p>}
          <div className="segmentation-input-links">
            <Link className="text-link" to={`/cases/${item.id}/imaging`}>Inspect input metadata</Link>
            {canRun && <Link className="text-link" to={`/cases/${item.id}`}>Update case or upload</Link>}
            <button className="btn btn-ghost btn-sm" disabled={volume.loading || run.active} onClick={volume.reload}>Refresh input check</button>
          </div>
          {canRun ? <form onSubmit={runSegmentation} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="segmentation-threshold">Segmentation threshold</label>
              <input id="segmentation-threshold" className="form-input" type="number" min="0" max="1" step="any" required value={threshold} disabled={run.active} aria-invalid={Boolean(thresholdError)} aria-describedby={`threshold-help${thresholdError ? " threshold-error" : ""}`} onChange={(event) => { setThreshold(event.target.value); setThresholdError(""); }} />
              <p id="threshold-help" className="text-xs text-muted">Range 0–1; default 0.70. Foreground is probability ≥ threshold. This is not clinical confidence.</p>
              {thresholdError && <p id="threshold-error" className="notice error" role="alert">{thresholdError}</p>}
            </div>
            <button className="btn btn-primary" type="submit" disabled={run.active || Boolean(inputReason) || inaccessible}>
              {run.active ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {run.active ? "Segmentation running…" : "Run segmentation"}
            </button>
          </form> : <p className="notice">Your role can inspect history and download outputs. Only Clinician and Admin accounts can run segmentation.</p>}
          {run.active && <p role="status" className="text-sm">Segmentation running… This synchronous request may take several minutes. No live progress is available. Leaving this page does not cancel server processing.</p>}
          {run.success && <p className="notice success" role="status">Segmentation completed and saved.{history.loading ? " Refreshing server history…" : ""}</p>}
          {run.error && <p className="notice error" role="alert">{run.error}</p>}
        </Panel>
        <Panel title="Outputs & limitations">
          <p className="text-sm text-muted">Each saved run provides a binary NIfTI mask and a float32 probability volume in the source study geometry. Downloads require your current signed-in session.</p>
          <p className="text-sm text-muted">Interactive 3D visualization remains future work. No voxel data is displayed here. Use a suitable medical-volume viewer to inspect the downloaded files.</p>
          <p className="text-sm text-muted">The probability volume is model output, not calibrated clinical confidence. Segmentation alone does not establish a diagnosis.</p>
          <p className="text-sm text-muted">A stale result belongs to a replaced, changed, missing or unverifiable input. Its downloads are blocked; check the current study before running again.</p>
          <button className="btn btn-ghost btn-sm" disabled={run.active} onClick={refreshCase}>Refresh case details</button>
        </Panel>
      </div>
      <Panel title="Segmentation history" description="Saved runs retrieved from the server" action={<button className="btn btn-ghost btn-sm" onClick={history.reload} disabled={history.loading || run.active}><RefreshCw size={14} aria-hidden="true" /> Refresh history</button>}>
        {download.error && <p className="notice error" role="alert">{download.error}</p>}
        {download.success && <p className="notice success" role="status">{download.success}</p>}
        {history.loading ? <Loading label="Loading segmentation history…" /> : history.error ? <ErrorState error={history.error} retry={history.reload} /> : !history.data?.length ?
          <EmptyState icon={Layers} title="No segmentation runs recorded" description="This case has no saved segmentation results. Upload a compatible 3D CT volume and have a Clinician or Admin start a run." /> : <>
            {requestedId && !history.data.some((result) => result.id === requestedId) && <p className="notice">The requested run is not in this case’s segmentation history. Available runs are listed below.</p>}
            <div className="stack">
              {history.data.map((result) => <SegmentationRecord key={result.id} result={result} highlighted={result.id === requestedId} download={download} onDownload={downloadResult} />)}
            </div>
          </>}
      </Panel>
    </div>
  );
}

function SegmentationRecord({ result, highlighted, download, onDownload }) {
  const metadata = result.metadata || {};
  return (
    <article className={`segmentation-record${highlighted ? " segmentation-record-selected" : ""}`} aria-label={`Segmentation ${result.id}`}>
      <div className="segmentation-record-heading">
        <div><h3>Run {result.id.slice(0, 8)}</h3><p className="text-xs text-muted">Created {formatDate(result.created_at, true)}</p></div>
        <span className={`badge badge-${result.stale ? "yellow" : "green"}`}>{result.stale ? "Stale input" : "Current input"}</span>
      </div>
      <Metadata items={[
        ["Run ID", result.id], ["Threshold", metadata.threshold], ["Model", metadata.architecture],
        ["Checkpoint step", metadata.checkpoint_step], ["Volume dimensions", Array.isArray(metadata.shape) ? metadata.shape.join(" × ") : null],
        ["Patch / stride", Array.isArray(metadata.patch_size) && metadata.stride != null ? `${metadata.patch_size.join(" × ")} / ${metadata.stride}` : null],
        ["Runtime", metadata.duration_seconds != null ? `${metadata.duration_seconds} seconds` : null],
        ["Input SHA-256", metadata.source_sha256], ["Checkpoint SHA-256", metadata.checkpoint_sha256],
      ]} />
      {result.stale && <p className="notice">Downloads unavailable: the source input has changed or cannot be verified. Refresh the case inputs and run a new segmentation when eligible.</p>}
      <div className="segmentation-downloads">
        {["mask", "probabilities"].map((artifact) => <button key={artifact} className="btn btn-ghost btn-sm" disabled={result.stale || Boolean(download.key)} onClick={() => onDownload(result, artifact)} aria-label={`Download ${artifact === "mask" ? "mask" : "probabilities"} for run ${result.id}`}>
          {download.key === `${result.id}-${artifact}` ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
          {download.key === `${result.id}-${artifact}` ? "Downloading…" : artifact === "mask" ? "Download mask" : "Download probabilities"}
        </button>)}
      </div>
    </article>
  );
}
