import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { PageHeader, Panel, Loading, ErrorState, Metadata } from "../components/ui";
import { CaseTabs } from "./CaseDetail";
import { useCase } from "../hooks/useCase";
import { useRemote } from "../hooks/useRemote";
import { stenosisApi } from "../api/stenosis";
import { capabilityError } from "../api/stenosis-contract";
import { segmentationApi } from "../api/segmentation";
import { useAuth } from "../context/AuthContext";
import { CLINICAL_WRITERS } from "../constants/permissions";
import StenosisHistory from "../components/StenosisHistory";
import { requestKey } from "../lib/analysis-tracker";

const loadCapabilities = () => stenosisApi.capabilities();
const statusLabels = {
  available: "Available", unavailable: "Unavailable",
  not_integrated: "Not integrated", disabled: "Disabled",
};

export default function StenosisCapabilities() {
  const { id } = useParams();
  return <CaseStenosis key={id} id={id} />;
}

function CaseStenosis({ id }) {
  const study = useCase();
  const capabilities = useRemote(loadCapabilities);
  const { user, isRole } = useAuth();
  const permitted = capabilities.data?.capabilities.find(item => item.id === "stenosis_detection")?.execution_permitted === true;
  const canRequest = permitted && isRole(...CLINICAL_WRITERS);
  const sources = useRemote(useCallback(() => canRequest ? segmentationApi.list(id) : Promise.resolve([]), [canRequest, id]));
  const [selected, setSelected] = useState("");
  const [submission, setSubmission] = useState({ busy: false, error: "", job: null });
  const [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentSources = (sources.data || []).filter(item => !item.stale && item.case_id === Number(id) && /^[a-f0-9]{64}$/.test(item.metadata?.source_sha256));
  const source = currentSources.find(item => item.id === selected);
  async function start() {
    if (!source || !canRequest || submitting.current) return;
    submitting.current = true;
    setSubmission({ busy: true, error: "", job: null });
    const reference = { case_id: Number(id), image_reference: "case-volume", source_sha256: source.metadata.source_sha256, parent_segmentation_result_id: source.id };
    let key;
    try { key = requestKey(sessionStorage, user.id, reference); }
    catch {
      setSubmission({ busy: false, job: null, error: "Request identity could not be saved on this device. No analysis request was sent. Allow session storage and retry." });
      submitting.current = false;
      return;
    }
    try {
      const accepted = await stenosisApi.start(id, reference, key);
      if (!mounted.current) return;
      setSubmission({ busy: false, error: "", job: accepted.job });
      setRevision(value => value + 1);
    } catch (error) {
      if (mounted.current) setSubmission({ busy: false, job: null, error: `${error.message} Refresh history before retrying. The same request key will be reused; no new acceptance is assumed.` });
    } finally { submitting.current = false; }
  }
  return (
    <AppShell breadcrumbs={[{ label: "Cases", href: "/cases" }, { label: study.data?.caseCode || id, href: `/cases/${id}` }, { label: "Stenosis" }]}>
      <PageHeader eyebrow="ANALYSIS CAPABILITIES" title="Stenosis analysis" description="Check method availability separately from experimental segmentation." />
      <CaseTabs id={id} />
      {study.loading ? <Loading label="Loading case…" /> : study.error ? <ErrorState error={study.error} retry={study.reload} /> : <div className="stack">
        <Panel title="Analysis availability" description={`${study.data.caseCode} · Subject #${study.data.patientId}`}>
          <p className="notice">{permitted ? "The API permits requests for its registered method. Select a current segmentation; the server verifies provider readiness and source freshness before acceptance." : "Stenosis analysis is not operational with the current provider configuration. Detection, measurements, severity and explanations require separate verified methods."} A saved segmentation does not establish stenosis or its absence.</p>
          {canRequest && <div className="form-group">
            <label className="form-label" htmlFor="stenosis-source">Source segmentation</label>
            {sources.loading ? <Loading label="Checking current segmentations…" /> : sources.error ? <ErrorState error={sources.error} retry={sources.reload} /> : <select id="stenosis-source" className="form-select" value={selected} onChange={event => setSelected(event.target.value)} disabled={submission.busy}>
              <option value="">Select a current segmentation</option>
              {currentSources.map(item => <option key={item.id} value={item.id}>Run {item.id.slice(0, 8)}</option>)}
            </select>}
          </div>}
          <div className="page-actions">
            <button className="btn btn-primary" disabled={!canRequest || !source || submission.busy || Boolean(capabilities.error) || capabilities.loading} onClick={start} aria-describedby="stenosis-execution-help">{submission.busy ? "Submitting request…" : "Start stenosis analysis"}</button>
            <Link className="btn btn-ghost" to={`/cases/${id}/analysis`}>Open segmentation workspace</Link>
            <Link className="btn btn-ghost" to={`/cases/${id}/stenosis/report`}>Case analytics and research reports</Link>
          </div>
          <p id="stenosis-execution-help" className="text-sm text-muted">Lifecycle infrastructure does not activate analysis. The server requires a verified provider, ready worker mechanism and result store before accepting a request. Request identities survive navigation; failed jobs are never automatically retried.</p>
          {submission.error && <p className="notice error" role="alert">{submission.error}</p>}
          {submission.job && <p className="notice" role="status">Server record {submission.job.analysis_id.slice(0, 8)}: {submission.job.status}. Refresh history for authoritative status; this does not imply a stenosis result.</p>}
        </Panel>
        {capabilities.loading ? <Loading label="Loading stenosis capabilities…" /> : capabilities.error ?
          <ErrorState error={capabilityError(capabilities.error)} retry={capabilities.reload} /> : <>
            <p className="text-xs text-muted" role="status">Capability information retrieved · Contract {capabilities.data.contract_version}. This is not an analysis result.</p>
            <div className="equal-columns">
              {capabilities.data.capabilities.map(capability => <Panel key={capability.id} title={capability.display_name} action={<span className={`badge badge-${capability.status === "available" ? "green" : "gray"}`}>{statusLabels[capability.status]}</span>}>
                <p className="text-sm">{capability.availability_reason}</p>
                <Metadata items={[
                  ["Execution permitted by API", capability.execution_permitted ? "Yes" : "No"],
                  ["Method", capability.method_id || "Not registered"],
                  ["Method version", capability.method_version || "Not registered"],
                ]} />
              </Panel>)}
            </div>
          </>}
        <StenosisHistory key={id} caseId={id} revision={revision} />
      </div>}
    </AppShell>
  );
}
