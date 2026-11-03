import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, Loading, Metadata, Panel } from "./ui";
import { stenosisApi } from "../api/stenosis";
import { useAnalysisTracker } from "../hooks/useAnalysisTracker";
import { activeHistory, activeJob } from "../lib/analysis-tracker";
import { formatDate } from "../lib/format";
import StenosisResults from "./StenosisResults";

const colors = { queued: "yellow", running: "blue", completed: "green", failed: "red" };
const labels = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed" };

export function JobRecord({ job }) {
  return <article aria-label={`Analysis ${job.analysis_id}`} className="segmentation-record">
    <div className="segmentation-record-heading"><h3>Analysis {job.analysis_id.slice(0, 8)}</h3><span className={`badge badge-${colors[job.status]}`}>{labels[job.status]}</span></div>
    <Metadata items={[
      ["Analysis ID", job.analysis_id], ["Created", formatDate(job.created_at, true)],
      ["Last update", formatDate(job.updated_at, true)], ["Method", job.provenance.method_id],
      ["Method version", job.provenance.method_version], ["Parent segmentation", job.provenance.source.parent_segmentation_result_id],
    ]} />
    {job.stale && <p className="notice">Stale input: this analysis belongs to a changed or unverifiable source. Its result must not be treated as current.</p>}
    {job.failure && <p className="notice error">Failure ({job.failure.code}): {job.failure.message}</p>}
    {job.status === "completed" && <p className="text-sm text-muted">This history card contains lifecycle metadata only. Candidate results require a persisted completed result.</p>}
  </article>;
}

function SelectedJob({ caseId, analysisId }) {
  const load = useCallback(signal => stenosisApi.job(caseId, analysisId, { signal }), [caseId, analysisId]);
  const state = useAnalysisTracker(load, activeJob);
  return <Panel title="Selected analysis" action={<button className="btn btn-ghost btn-sm" onClick={() => state.refresh()}>Refresh status</button>}>
    {state.error && <ErrorState error={state.error} retry={() => state.refresh()} />}
    {state.loading && !state.data ? <Loading label="Loading analysis status…" /> : state.data && <JobRecord job={state.data} />}
    {state.data && !state.error && <StenosisResults caseId={caseId} job={state.data} />}
  </Panel>;
}

export default function StenosisHistory({ caseId, revision = 0 }) {
  const [params,setParams] = useSearchParams();
  const offset=Math.max(0,Number(params.get('history_offset'))||0);
  const filters=Object.fromEntries(['status','start_date','end_date','method_id','method_version'].map(key=>[key,params.get('history_'+key)]).filter(([,value])=>value));
  const filterKey=JSON.stringify(filters);
  const [draft,setDraft]=useState({key:filterKey,values:filters});
  const values=draft.key===filterKey?draft.values:filters;
  const setOffset=update=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('history_offset',String(update(offset)));return next;});
  const setFilter=(key,value)=>setDraft({key:filterKey,values:{...values,[key]:value}});
  const applyFilters=event=>{
    event.preventDefault();
    const applied=Object.fromEntries(['status','start_date','end_date','method_id','method_version'].map(key=>[key,values[key]]).filter(([,value])=>value));
    setDraft({key:JSON.stringify(applied),values:applied});
    // React Router's search-param callbacks are not queued like React setState.
    // Apply all draft fields in one URL navigation, preserving selection.
    setParams(previous=>{const next=new URLSearchParams(previous);for(const key of ['status','start_date','end_date','method_id','method_version']){if(applied[key])next.set('history_'+key,applied[key]);else next.delete('history_'+key);}next.delete('history_offset');return next;});
  };
  const selected = params.get("analysis");
  const load = useCallback(signal => stenosisApi.history(caseId, { limit: 20, offset, signal, ...JSON.parse(filterKey) }), [caseId, offset, filterKey]);
  const state = useAnalysisTracker(load, activeHistory);
  const refresh = state.refresh;
  useEffect(() => { if (revision) refresh({ afterCurrent: true }); }, [revision, refresh]);
  return <div className="stack">
    <Panel title="Stenosis analysis history" description="Persisted execution records, not lesion counts or negative findings" action={<button className="btn btn-ghost btn-sm" disabled={state.loading} onClick={() => state.refresh()}>Refresh history</button>}>
      <form className="analytics-filters" onSubmit={applyFilters}>
        <label>History status<select aria-label="History status" className="form-select" value={values.status||''} onChange={event=>setFilter('status',event.target.value)}><option value="">All history statuses</option>{['queued','running','completed','failed'].map(s=><option key={s}>{s}</option>)}</select></label>
        {['start_date','end_date','method_id','method_version'].map(key=><label key={key}>{({start_date:'History start date (UTC)',end_date:'History end date (UTC)',method_id:'History method',method_version:'History method version'})[key]}<input className="form-input" type={key.includes('date')?'date':'text'} value={values[key]||''} onChange={event=>setFilter(key,event.target.value)}/></label>)}
        <button className="btn btn-ghost" type="submit">Apply history filters</button>
      </form>
      {state.error && <ErrorState error={state.error} retry={() => state.refresh()} />}
      {state.loading && !state.data ? <Loading label="Loading stenosis analysis history…" /> : state.data && <>
        {state.loading && <p role="status">Refreshing analysis history…</p>}
        {!state.data.items.length ? <EmptyState title={state.data.total ? "No records on this page" : Object.keys(filters).length ? "No analyses match these history filters." : "No analyses have been performed for this case."} description="An empty history is not a negative stenosis finding." /> : <div className="stack">
          {state.data.items.map(job => <div key={job.analysis_id} className="stack"><JobRecord job={job} /><Link className="text-link" to={`?${new URLSearchParams({...Object.fromEntries(params),analysis:job.analysis_id})}`}>Inspect analysis {job.analysis_id.slice(0, 8)}</Link><Link className="text-link" to={`/cases/${caseId}/stenosis/report/${job.analysis_id}`}>{job.status==='completed'?'Research findings report':'Research status report'}</Link></div>)}
        </div>}
        <div className="page-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" disabled={!offset || state.loading} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous analyses</button>
          <span className="text-sm">{state.data.total} analysis records</span>
          <button className="btn btn-ghost btn-sm" disabled={!state.data.has_more || state.loading} onClick={() => setOffset(value => value + 20)}>Next analyses</button>
        </div>
      </>}
    </Panel>
    {selected && <SelectedJob key={`${caseId}-${selected}`} caseId={caseId} analysisId={selected} />}
  </div>;
}
