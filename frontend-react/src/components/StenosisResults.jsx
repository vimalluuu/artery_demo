import { lazy, Suspense, useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorState, Loading, Metadata, Panel } from "./ui";
import { stenosisApi } from "../api/stenosis";
import { useAnalysisTracker } from "../hooks/useAnalysisTracker";
import ExplanationPanel from "./ExplanationPanel";

const Viewer = lazy(() => import("./SegmentationViewer"));
const neverPoll = () => false;

function MeasurementDisplay({ name, measurement }) {
  return <div className="readiness-item"><div><strong>{name}</strong>
    <p>{measurement.value === null ? `Unavailable: ${measurement.unavailable_reason.message}` : `${measurement.value} ${measurement.unit}`}</p>
    {(measurement.method_id || measurement.method_version) && <p className="text-xs">Method {measurement.method_id || 'Not supplied'} / {measurement.method_version || 'Version not supplied'}{measurement.definition ? ` · ${measurement.definition}` : ""}{measurement.reference_region ? ` · Reference: ${measurement.reference_region}` : ""}</p>}
  </div></div>;
}

export default function StenosisResults({ caseId, job }) {
  if (job.stale) return <p className="notice">Candidate results are hidden because the source is stale or unverifiable.</p>;
  if (job.status !== "completed") return <p className="notice">No completed result is available while this analysis is {job.status}.</p>;
  return <CompletedResults key={`${caseId}-${job.analysis_id}`} caseId={caseId} analysisId={job.analysis_id} />;
}

function CompletedResults({ caseId, analysisId }) {
  const load = useCallback(signal => stenosisApi.result(caseId, analysisId, { signal }), [caseId, analysisId]);
  const state = useAnalysisTracker(load, neverPoll);
  const [params, setParams] = useSearchParams();
  const [viewing, setViewing] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const root = state.data, lesions = root?.result.lesions || [];
  const requested = params.get("lesion");
  const selectedId = requested || lesions[0]?.lesion_id || null;
  const selected = lesions.find(item => item.lesion_id === selectedId);
  const select = useCallback(id => {
    setParams(previous => {
      if (previous.get("lesion") === id) return previous;
      const next = new URLSearchParams(previous); next.set("analysis", analysisId); next.set("lesion", id); return next;
    });
  }, [setParams, analysisId]);
  return <Panel title="Persisted candidate results" description="Supplied experimental findings; not a diagnostic assessment" action={<button className="btn btn-ghost btn-sm" onClick={() => state.refresh()}>Refresh result</button>}>
    {state.error && <ErrorState error={state.error} retry={() => state.refresh()} />}
    {state.loading && !root ? <Loading label="Loading verified candidate results…" /> : root && !state.error && <div className="stack">
      <p className="notice">These are provider-supplied candidate findings, not independently verified anatomical or clinical conclusions.</p>
      <Metadata items={[["Result ID", root.result_id], ["Method", `${root.result.provenance.method_id} / ${root.result.provenance.method_version}`], ["Checkpoint fingerprint", root.result.provenance.checkpoint_sha256], ["Source fingerprint", root.result.provenance.source.source_sha256], ["Geometry fingerprint", root.geometry_fingerprint]]} />
      {!lesions.length ? <p className="notice">The completed analysis returned no candidate lesions. This is not proof that stenosis is absent.</p> : <>
        <div className="lesion-list" role="group" aria-label="Candidate lesions">
          {lesions.map(lesion => <button key={lesion.lesion_id} className={`btn btn-ghost${selectedId === lesion.lesion_id ? ' lesion-list-selected' : ''}`} aria-pressed={selectedId === lesion.lesion_id} onClick={() => select(lesion.lesion_id)} aria-label={`Select candidate ${lesion.lesion_id}`}>
            Candidate {lesion.lesion_id.slice(0, 8)} · {lesion.vessel_label || "Vessel not supplied"}
          </button>)}
        </div>
        {requested && !selected && <p className="notice" role="alert">The requested candidate does not belong to this result. Choose a candidate from this list.</p>}
        {selected && <section aria-label={`Candidate details ${selected.lesion_id}`}>
          <h3>Candidate {selected.lesion_id.slice(0, 8)}</h3>
          <Metadata items={[["Lesion ID", selected.lesion_id], ["Vessel ID", selected.vessel_id], ["Vessel label", selected.vessel_label], ["Anatomical location", selected.anatomical_location], ["Anatomical method/source", selected.anatomical_method],
            ["Original IJK voxel", selected.location?.voxel_indices.join(", ")], ["RAS position (mm)", selected.location?.world_coordinates.join(", ")], ["Original-array slice", selected.location?.slice_axis != null ? `axis ${selected.location.slice_axis}, index ${selected.location.slice_index}` : null]]} />
          {!selected.location && <p className="notice">Localization unavailable: {selected.localization_unavailable_reason.message}</p>}
          <MeasurementDisplay name="Reference vessel diameter" measurement={selected.measurements.reference_diameter} />
          <MeasurementDisplay name="Minimum lumen diameter" measurement={selected.measurements.minimum_lumen_diameter} />
          <MeasurementDisplay name="Percentage narrowing" measurement={selected.measurements.percentage_narrowing} />
          {new Set(Object.values(selected.measurements).filter(item => item.value !== null).map(item => `${item.method_id}/${item.method_version}`)).size > 1 && <p className="notice">Measurements use different methods; no combined interpretation is made.</p>}
          <p className="text-sm">Severity: {selected.severity.category || `Unavailable: ${selected.severity.unavailable_reason.message}`}{selected.severity.category ? ` (${selected.severity.method_id} / ${selected.severity.method_version})` : ""}</p>
          <p className="text-sm">Legacy explanation reference: {selected.explanation.artifact_id ? `A provider reference was supplied (${selected.explanation.method_id} / ${selected.explanation.method_version}); use the separately verified attribution panel below for renderable artifacts.` : `Unavailable: ${selected.explanation.unavailable_reason.message}`}</p>
        </section>}
      </>}
      <ExplanationPanel root={root} selectedLesionId={selectedId} onSelect={setExplanation}/>
      {root.visualization.status !== "supported" ? <p className="notice" role="alert">{root.visualization.reason}</p> : <button className="btn btn-primary" onClick={() => setViewing(value => !value)}>{viewing ? "Hide candidate CT viewer" : "View candidates on CT"}</button>}
      <Link className="text-link" to={`/cases/${caseId}/analysis`}>Open segmentation and protected downloads</Link>
      {viewing && root.visualization.status === "supported" && <Suspense fallback={<Loading label="Loading CT viewer…" />}><Viewer caseId={caseId} result={root.segmentation} localization={root} explanation={explanation} selectedLesionId={selectedId} onLesionSelect={select} onClose={() => setViewing(false)} /></Suspense>}
    </div>}
  </Panel>;
}
