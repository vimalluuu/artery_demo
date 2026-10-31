import {useCallback,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import AppShell from '../components/AppShell';
import {PageHeader,Loading,ErrorState,Metadata} from '../components/ui';
import {stenosisApi} from '../api/stenosis';
import {useAnalysisTracker} from '../hooks/useAnalysisTracker';
import {reportJsonBlob} from '../lib/exports';
import {saveArtifact} from '../lib/segmentation';
import StenosisAnalytics from '../components/StenosisAnalytics';

const neverPoll=()=>false;
export default function StenosisReportPage(){const{id,analysisId}=useParams();return <Report key={`${id}-${analysisId}`} caseId={id} analysisId={analysisId}/>;}
function Report({caseId,analysisId}){
  const load=useCallback(signal=>analysisId?stenosisApi.report(caseId,analysisId,{signal}):Promise.resolve(null),[caseId,analysisId]);
  const state=useAnalysisTracker(load,neverPoll),[latest,setLatest]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const report=latest||state.data;
  async function exportReport(format){setBusy(true);setError('');try{
    if(format==='csv'){saveArtifact({blob:await stenosisApi.reportCsv(caseId,analysisId),filename:`vascuai-stenosis-${analysisId}.csv`});}
    else{const fresh=await stenosisApi.report(caseId,analysisId);setLatest(fresh);if(format==='json')saveArtifact({blob:reportJsonBlob(fresh),filename:`vascuai-stenosis-${analysisId}.json`});else requestAnimationFrame(()=>window.print());}
  }catch(failure){setError(failure.message);}finally{setBusy(false);}}
  return <AppShell breadcrumbs={[{label:'Reports',href:'/reports'},{label:`Case ${caseId}`,href:`/cases/${caseId}`},{label:'Stenosis research report'}]}>
    <PageHeader eyebrow="RESEARCH REPORT" title="Stenosis analysis report" description="On-demand snapshot of authorized persisted analysis records">
      {report&&<><button className="btn btn-ghost" disabled={busy} onClick={()=>exportReport('json')}>Download report JSON</button><button className="btn btn-ghost" disabled={busy||report.report_state!=='completed'} onClick={()=>exportReport('csv')}>Download findings CSV</button><button className="btn btn-primary" disabled={busy} onClick={()=>exportReport('print')}>Print / Save as PDF</button></>}
    </PageHeader>
    <div className="no-print page-actions"><Link to={`/cases/${caseId}/stenosis`}>Open stenosis workspace and history</Link><Link to={`/cases/${caseId}/analysis`}>Open protected segmentation workspace</Link></div>
    {!analysisId?<><p className="notice">No analysis selected. Analysis execution is unavailable without a genuine provider. Select an existing analysis below; an empty history means not performed, not a negative finding.</p><StenosisAnalytics caseId={caseId}/></>:<>
      {state.loading&&!report&&<Loading label="Loading research report…"/>}{state.error&&<ErrorState error={state.error} retry={()=>state.refresh()}/>}{error&&<p className="notice error" role="alert">{error}</p>}
      {report&&!state.error&&<article className="card report-sheet stenosis-report">
        <h2>VascuAI — stenosis analysis research snapshot</h2>
        <p className="notice">Experimental research prototype. Not a clinically validated diagnosis. Zero candidate findings do not establish absence of stenosis.</p>
        <Metadata items={[["Report schema",report.schema_version],["Generated (UTC)",report.generated_at],["Case",report.case.case_reference],["Case ID",report.case.case_id],["Subject ID",report.case.patient_id],["Analysis ID",report.analysis.analysis_id],["Report state",report.report_state],["Analysis lifecycle",report.analysis.status],["Method",`${report.analysis.provenance.method_id} / ${report.analysis.provenance.method_version}`],["Created",report.analysis.created_at],["Started",report.analysis.started_at],["Completed",report.analysis.completed_at],["Checkpoint",report.analysis.provenance.checkpoint_sha256],["Source SHA-256",report.analysis.provenance.source.source_sha256],["Parent segmentation",report.analysis.provenance.source.parent_segmentation_result_id]]}/>
        {report.report_state!=='completed'?<p className="notice">{report.unavailable_reason} No completed findings are presented.</p>:<>
          <Metadata items={[["Result ID",report.result.result_id],["Geometry fingerprint",report.result.geometry_fingerprint],["Stored lesion records",report.result.result.lesions.length]]}/>
          {report.result.visualization.status!=='supported'&&<p className="notice">{report.result.visualization.reason}</p>}
          {!report.result.result.lesions.length?<p className="notice">The completed analysis returned no candidate lesions. This is not proof that stenosis is absent. CSV will contain column headers only; use JSON for analysis-level context.</p>:report.result.result.lesions.map(lesion=><section className="report-lesion" key={lesion.lesion_id}>
            <h3>Candidate {lesion.lesion_id}</h3><Metadata items={[["Vessel",lesion.vessel_label],["Anatomical location",lesion.anatomical_location],["Anatomical method",lesion.anatomical_method],["Original IJK",lesion.location?.voxel_indices.join(', ')],["RAS mm",lesion.location?.world_coordinates.join(', ')],["Localization unavailable",lesion.localization_unavailable_reason?.message]]}/>
            <div className="table-wrapper" tabIndex={0} role="region" aria-label={`Measurements for ${lesion.lesion_id}`}><table className="data-table"><caption>Supplied measurements for candidate {lesion.lesion_id.slice(0,8)}</caption><thead><tr><th>Measurement</th><th>Value / units or reason</th><th>Method / definition</th></tr></thead><tbody>{Object.entries(lesion.measurements).map(([field,item])=><tr key={field}><th scope="row">{field.replaceAll('_',' ')}</th><td>{item.value===null?`Unavailable: ${item.unavailable_reason.message}`:`${item.value} ${item.unit}`}</td><td>{item.method_id||item.method_version?`${item.method_id||'Method not supplied'} / ${item.method_version||'Version not supplied'}`:'Not supplied'}{item.definition?` · ${item.definition}`:''}{item.reference_region?` · ${item.reference_region}`:''}</td></tr>)}</tbody></table></div>
            <p>Supplied severity: {lesion.severity.category?`${lesion.severity.category} (${lesion.severity.method_id} / ${lesion.severity.method_version})`:`Unavailable: ${lesion.severity.unavailable_reason.message}`}. No category or narrowing is derived by this report.</p>
          </section>)}
          <h3>Explanation metadata</h3>{!report.explanations.items.length?<p>{report.explanations.unavailable_reason.message}</p>:report.explanations.items.map(item=><p key={item.explanation_id}>{item.method_name} / {item.method_version}; target {item.target.identifier}; model {item.model_id} / {item.model_version}; scope {item.scope}; artifact {item.artifact_id}; SHA-256 {item.content_sha256}. {item.limitations}</p>)}
        </>}
        <h3>Limitations</h3>{report.limitations.map(note=><p key={note}>{note}</p>)}
      </article>}
    </>}
  </AppShell>;
}
