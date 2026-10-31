import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS,CategoryScale,LinearScale,BarElement,Tooltip,Legend } from 'chart.js';
import { stenosisApi } from '../api/stenosis';
import { useAnalysisTracker } from '../hooks/useAnalysisTracker';
import { useAuth } from '../context/AuthContext';
import { Panel,Loading,ErrorState,Metadata } from './ui';
ChartJS.register(CategoryScale,LinearScale,BarElement,Tooltip,Legend);
const neverPoll=()=>false;

export default function StenosisAnalytics({caseId=null}) {
  const [params]=useSearchParams();
  const filterIdentity=JSON.stringify([...params].filter(([key])=>key.startsWith('sa_')&&key!=='sa_offset').sort());
  return <AnalyticsSession key={`${caseId}:${filterIdentity}`} caseId={caseId}/>;
}
function AnalyticsSession({caseId}) {
  const {isRole}=useAuth();const patientAllowed=isRole('Admin','Clinician');
  const [params,setParams]=useSearchParams();
  const filters=Object.fromEntries(['start_date','end_date','status','method_id','method_version',...patientAllowed?['patient_id']:[],...caseId?[]:['case_id']].map(key=>[key,params.get('sa_'+key)]).filter(([,v])=>v));
  if(caseId)filters.case_id=Number(caseId);
  const offset=Math.max(0,Number(params.get('sa_offset'))||0),identity=JSON.stringify(filters);
  const load=useCallback(async signal=>{
    const filter=JSON.parse(identity);
    const [summary,index]=await Promise.all([stenosisApi.analytics(filter,{signal}),stenosisApi.analysisIndex(filter,{signal,offset})]);return {summary,index};
  },[identity,offset]);
  const state=useAnalysisTracker(load,neverPoll);const data=state.data?.summary,index=state.data?.index;
  const [draft,setDraft]=useState(filters);
  const apply=event=>{event.preventDefault();setParams(previous=>{const next=new URLSearchParams(previous);for(const key of ['start_date','end_date','status','method_id','method_version','case_id','patient_id']){if(!patientAllowed&&key==='patient_id')continue;if(caseId&&key==='case_id')continue;if(draft[key])next.set('sa_'+key,draft[key]);else next.delete('sa_'+key);}next.delete('sa_offset');return next;});};
  const page=change=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('sa_offset',String(Math.max(0,offset+change)));return next;});
  const columns=[['Total analysis jobs',data?.jobs.total],['Completed lifecycle jobs',data?.jobs.completed],['Eligible completed results',data?.current.analyses],['Stored lesion records',data?.current.lesions],['Unique analyzed cases',data?.current.unique_cases],['Completed zero-finding analyses',data?.current.zero_finding_analyses]];
  return <section className="stack stenosis-analytics" aria-label="Stenosis analytics">
    <Panel title={caseId?'Case stenosis analytics':'Stenosis analytics'} description="Server-authoritative operational records; separate from case workflow status" action={<button className="btn btn-ghost btn-sm" onClick={()=>state.refresh()}>Refresh stenosis analytics</button>}>
      <form className="analytics-filters" onSubmit={apply}>
        {['start_date','end_date',...caseId?[]:['case_id'],...patientAllowed?['patient_id']:[],'method_id','method_version'].map(key=><label key={key}>{({start_date:'Start date (UTC)',end_date:'End date (UTC)',case_id:'Case ID',patient_id:'Patient ID',method_id:'Analysis method',method_version:'Method version'})[key]}<input className="form-input" type={key.includes('date')?'date':key.endsWith('_id')&&['case_id','patient_id'].includes(key)?'number':'text'} min={['case_id','patient_id'].includes(key)?'1':undefined} value={draft[key]||''} onChange={event=>setDraft(previous=>({...previous,[key]:event.target.value}))}/></label>)}
        <label>Analysis status<select aria-label="Analysis status" className="form-select" value={draft.status||''} onChange={event=>setDraft(previous=>({...previous,status:event.target.value}))}><option value="">All analysis statuses</option>{['queued','running','completed','failed'].map(s=><option key={s}>{s}</option>)}</select></label>
        <button className="btn btn-primary" type="submit">Apply stenosis filters</button>
      </form>
      {state.loading&&<Loading label="Loading stenosis analytics…"/>}{state.error&&<ErrorState error={state.error} retry={()=>state.refresh()}/>}
      {data&&!state.error&&<div className="stack">
        <p className="notice">{data.execution_reason}</p>
        <p className="text-sm">Window: {data.filters.start_date} through {data.filters.end_date} inclusive (UTC). Completed job status does not by itself establish a valid current result.</p>
        {!data.jobs.total&&<p className="notice">No stenosis analyses are recorded in this filter window. This is not a negative medical finding.</p>}
        <div className="stats-grid">{columns.map(([label,value])=><div className="stat-card" key={label}><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong></div>)}</div>
        <Metadata items={[["Queued jobs",data.jobs.queued],["Running jobs",data.jobs.running],["Failed jobs",data.jobs.failed],["Cases containing findings",data.current.cases_with_lesions],["Unique patients",data.current.unique_patients??data.current.patient_count_reason],["Excluded stale results",data.quality.stale],["Excluded unverified sources",data.quality.unverified],["Result integrity errors",data.quality.integrity_errors],["Explanation artifact records",data.current.explanation_artifacts],["Analyses with explanation records",data.current.analyses_with_explanations]]}/>
        <p className="notice">{data.quality.freshness_policy} Open a case's verified result/report to perform explicit source verification; refresh analytics afterwards.</p>
        <p className="notice">Severity analytics unavailable: {data.severity_reason}</p>
        <p className="notice">Measurement summaries unavailable: {data.measurement_summary_reason}</p>
        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Measurement availability table"><table className="data-table"><caption>Measurement availability per eligible lesion; zero is an available value</caption><thead><tr><th>Measurement</th><th>Available</th><th>Unavailable</th></tr></thead><tbody>{data.measurements.map(m=><tr key={m.field}><th scope="row">{m.field.replaceAll('_',' ')}</th><td>{m.available}</td><td>{m.unavailable}</td></tr>)}</tbody></table></div>
        {data.jobs.total>0&&<div className="chart-wrap"><Bar role="img" aria-label={`Analysis job status counts: queued ${data.jobs.queued}, running ${data.jobs.running}, completed ${data.jobs.completed}, failed ${data.jobs.failed}.`} data={{labels:['Queued','Running','Completed','Failed'],datasets:[{label:'Job count',data:[data.jobs.queued,data.jobs.running,data.jobs.completed,data.jobs.failed],backgroundColor:'#68775c'}]}} options={{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}}/></div>}
        <p className="text-sm">{data.trends.definition}</p>
        {!data.trends.items.length?<p>No job-creation trend records in this window.</p>:<div className="table-wrapper" tabIndex={0} role="region" aria-label="Analysis trend table"><table className="data-table"><caption>Analysis creation cohorts by UTC day</caption><thead><tr><th>Date</th><th>Queued</th><th>Running</th><th>Completed</th><th>Failed</th></tr></thead><tbody>{data.trends.items.map(day=><tr key={day.date}><th scope="row">{day.date}</th>{['queued','running','completed','failed'].map(s=><td key={s}>{day[s]}</td>)}</tr>)}</tbody></table></div>}
        {[['Supplied anatomy labels by analysis method',data.anatomy],['Recorded attribution methods (metadata counts only)',data.explanation_methods]].map(([title,rows])=><div key={title}><h3>{title}</h3>{!rows.length?<p>No supplied records in the eligible cohort.</p>:<div className="table-wrapper" tabIndex={0} role="region" aria-label={title}><table className="data-table"><thead><tr><th>Label</th><th>Method/version</th><th>Records</th></tr></thead><tbody>{rows.map(row=><tr key={`${row.label}-${row.method_id}-${row.method_version}`}><td>{row.label}</td><td>{row.method_id} / {row.method_version}</td><td>{row.count}</td></tr>)}</tbody></table></div>}</div>)}
        <details><summary>Metric definitions and denominators</summary>{Object.entries(data.definitions).map(([key,definition])=><p key={key}><strong>{key}:</strong> {definition}</p>)}</details>
      </div>}
    </Panel>
    {index&&!state.error&&<Panel title="Filtered analysis records" description="Each row is one persisted job; result eligibility is checked separately">
      {!index.items.length?<p>No analysis records on this page.</p>:<div className="table-wrapper"><table className="data-table"><thead><tr><th>Analysis</th><th>Case</th><th>Status</th><th>Method</th><th>Result availability</th><th>Research report</th></tr></thead><tbody>{index.items.map(item=><tr key={item.analysis_id}><td><Link to={`/cases/${item.case_id}/stenosis?analysis=${item.analysis_id}`}>{item.analysis_id.slice(0,8)}</Link></td><td><Link to={`/cases/${item.case_id}`}>{item.case_id}</Link></td><td>{item.status}</td><td>{item.method_id} / {item.method_version}</td><td>{item.result_availability}</td><td><Link to={`/cases/${item.case_id}/stenosis/report/${item.analysis_id}`}>{item.status==='completed'?'Open findings report':'Open status report'}</Link></td></tr>)}</tbody></table></div>}
      <div className="page-actions"><button className="btn btn-ghost" disabled={!offset||state.loading} onClick={()=>page(-10)}>Previous records</button><span>{index.total} jobs match</span><button className="btn btn-ghost" disabled={!index.has_more||state.loading} onClick={()=>page(10)}>Next records</button></div>
    </Panel>}
  </section>;
}
