// Synthetic operational/report fixtures only; never application seed data.
import {resultFixture} from './stenosis-results-fixtures.js';
import {jobFixture} from './stenosis-jobs-fixtures.js';
import {explanationList} from './explanation-fixtures.js';
export const reportDefinitions={jobs:'Persisted job IDs, never generic case Complete.',current:'Eligible current immutable results only.',lesions:'One stored lesion per result/UUID.',freshness:'Stat-only cached observation; cold sources are unverified.'};
export function summaryFixture({populated=false,patientAllowed=true,caseId=null}={}){
  const filters={start_date:'2026-10-01',end_date:'2026-10-31',case_id:caseId,patient_id:null,status:null,method_id:null,method_version:null};
  return {contract_version:'1.0',generated_at:'2026-10-31T00:00:00Z',filters,execution_available:false,execution_reason:'No genuine stenosis provider is registered. Counts are operational metadata.',
    jobs:{total:populated?4:0,queued:populated?1:0,running:0,completed:populated?2:0,failed:populated?1:0},
    current:{analyses:populated?2:0,unique_cases:populated?1:0,unique_patients:patientAllowed?(populated?1:0):null,patient_count_reason:patientAllowed?null:'Patient-level counts require a clinical writer.',lesions:populated?3:0,analyses_with_lesions:populated?1:0,cases_with_lesions:populated?1:0,zero_finding_analyses:populated?1:0,explanation_artifacts:0,analyses_with_explanations:0},
    quality:{stale:0,unverified:0,integrity_errors:0,freshness_policy:reportDefinitions.freshness},severity_status:'unavailable',severity_reason:'No agreed severity taxonomy/version is integrated.',severity_distribution:null,supplied_severity_labels:0,
    measurements:['reference_diameter','minimum_lumen_diameter','percentage_narrowing'].map(field=>({field,available:0,unavailable:populated?3:0})),measurement_summary_status:'unavailable',measurement_summary_reason:'No approved numerical compatibility policy; presence counts only.',anatomy:[],explanation_methods:[],
    trends:{contract_version:'1.0',generated_at:'2026-10-31T00:00:00Z',filters,timezone:'UTC',definition:'UTC job-creation day with current lifecycle status; not model latency.',items:populated?[{date:'2026-10-31',queued:1,running:0,completed:2,failed:1}]:[]},definitions:reportDefinitions};
}
export function indexFixture({populated=false,filters={},limit=10,offset=0}={}){
  const job=jobFixture('completed');return {contract_version:'1.0',filters,items:populated?[{analysis_id:job.analysis_id,case_id:1,status:'completed',created_at:job.created_at,completed_at:job.completed_at,method_id:job.provenance.method_id,method_version:job.provenance.method_version,result_id:job.result_reference,result_availability:'current'}]:[],total:populated?1:0,limit,offset,has_more:false};
}
export async function reportFixture({count=3,state='completed'}={}){
  const root=await resultFixture({count});const job=jobFixture(['failed','queued','running'].includes(state)?state:'completed');job.provenance=structuredClone(root.result.provenance);job.result_reference=state==='completed'||state==='stale'||state==='integrity_error'?root.result_id:null;job.stale=state==='stale';
  return {schema_version:'1.0',document_type:'stenosis_analysis_research_report',generated_at:'2026-10-31T00:00:00Z',case:{case_id:1,case_reference:'SYNTHETIC-CASE',patient_id:1},analysis:job,report_state:state,
    unavailable_reason:state==='completed'?null:`Synthetic ${state} report; no completed findings are available.`,result:state==='completed'?root:null,explanations:state==='completed'?explanationList(root):null,
    limitations:['Experimental research prototype; not clinically validated.','Zero candidate findings do not establish absence of stenosis.']};
}
