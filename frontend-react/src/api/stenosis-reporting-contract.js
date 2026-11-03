import { StenosisContractError } from './stenosis-contract.js';
import { validateJob } from './stenosis-jobs-contract.js';
import { validateResultResponse } from './stenosis-results-contract.js';
import { validateExplanations } from './stenosis-explanations-contract.js';
import { isUUID } from '../lib/stenosis-results.js';

const fail=()=>{throw new StenosisContractError('Analytics or report data could not be verified. No totals or findings were assumed.');};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const text=n=>typeof n==='string'&&n.trim().length>0;
const date=n=>typeof n==='string'&&Number.isFinite(Date.parse(n));
export function validateSummary(data) {
  if(data?.contract_version!=='1.0'||!date(data.generated_at)||!data.filters||typeof data.execution_available!=='boolean'||!text(data.execution_reason)||!data.definitions)fail();
  const jobs=data.jobs,current=data.current,quality=data.quality;
  if(!jobs||!current||!quality||Object.values(jobs).some(n=>!count(n))||jobs.total!==jobs.queued+jobs.running+jobs.completed+jobs.failed)fail();
  for(const field of ['analyses','unique_cases','lesions','analyses_with_lesions','cases_with_lesions','zero_finding_analyses','explanation_artifacts','analyses_with_explanations'])if(!count(current[field]))fail();
  if(current.unique_patients!==null&&!count(current.unique_patients))fail();
  if(current.unique_patients===null&&!text(current.patient_count_reason))fail();
  if(['stale','unverified','integrity_errors'].some(field=>!count(quality[field]))||!text(quality.freshness_policy)
    ||current.analyses+quality.stale+quality.unverified+quality.integrity_errors!==jobs.completed
    ||current.analyses_with_lesions+current.zero_finding_analyses!==current.analyses||current.unique_cases>current.analyses||current.cases_with_lesions>current.unique_cases||current.lesions<current.analyses_with_lesions)fail();
  if(data.severity_status!=='unavailable'||data.severity_distribution!==null||!text(data.severity_reason)||!count(data.supplied_severity_labels)||data.measurement_summary_status!=='unavailable'||!text(data.measurement_summary_reason))fail();
  const fields=['reference_diameter','minimum_lumen_diameter','percentage_narrowing'];
  if(!Array.isArray(data.measurements)||data.measurements.length!==3||new Set(data.measurements.map(x=>x.field)).size!==3)fail();
  for(const item of data.measurements)if(!fields.includes(item.field)||!count(item.available)||!count(item.unavailable)||item.available+item.unavailable!==current.lesions)fail();
  for(const field of ['anatomy','explanation_methods']){if(!Array.isArray(data[field]))fail();for(const item of data[field])if(!text(item.label)||!text(item.method_id)||!text(item.method_version)||!count(item.count))fail();}
  if(data.trends?.contract_version!=='1.0'||data.trends.timezone!=='UTC'||!Array.isArray(data.trends.items)||!text(data.trends.definition))fail();
  for(const row of data.trends.items)if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||['queued','running','completed','failed'].some(field=>!count(row[field])))fail();
  return data;
}
export function validateIndex(data) {
  if(data?.contract_version!=='1.0'||!Array.isArray(data.items)||!count(data.total)||!count(data.offset)||!count(data.limit)||data.limit<1||data.limit>100||data.items.length>data.limit||data.has_more!==(data.offset+data.items.length<data.total))fail();
  const ids=new Set();for(const row of data.items){if(!isUUID(row.analysis_id)||ids.has(row.analysis_id)||!Number.isSafeInteger(row.case_id)||row.case_id<1||!date(row.created_at)
    ||!['queued','running','completed','failed'].includes(row.status)||!['not_completed','current','stale','unverified','integrity_error'].includes(row.result_availability)||!text(row.method_id)||!text(row.method_version))fail();ids.add(row.analysis_id);}
  return data;
}
export async function validateReport(data,caseId,analysisId) {
  if(data?.schema_version!=='1.0'||data.document_type!=='stenosis_analysis_research_report'||!date(data.generated_at)||data.case?.case_id!==Number(caseId)||!text(data.case.case_reference)
    ||!Number.isSafeInteger(data.case.patient_id)||data.case.patient_id<1||!Array.isArray(data.limitations)||!data.limitations.length||data.limitations.some(s=>!text(s)))fail();
  validateJob(data.analysis,caseId);if(!isUUID(analysisId)||data.analysis.analysis_id!==analysisId.toLowerCase())fail();
  if(data.report_state==='completed') {
    if(data.analysis.status!=='completed'||data.analysis.stale||data.unavailable_reason!==null)fail();
    await validateResultResponse(data.result,caseId,analysisId);if(data.result.result_id!==data.analysis.result_reference)fail();
    await validateExplanations(data.explanations,data.result);
  }else if(!['queued','running','failed','stale','integrity_error'].includes(data.report_state)||data.result!==null||data.explanations!==null||!text(data.unavailable_reason)
    ||(['queued','running','failed'].includes(data.report_state)&&data.analysis.status!==data.report_state))fail();
  return data;
}
function reportPath(caseId,analysisId) {
  if(!Number.isSafeInteger(Number(caseId))||Number(caseId)<1||!isUUID(analysisId))throw new Error('Invalid report identity.');
  return `/cases/${Number(caseId)}/stenosis/analyses/${analysisId.toLowerCase()}/report`;
}
function decode(error) {let data=error.response?.data;if(data?.detail?.message){error.code=data.detail.code;error.message=data.detail.message;}return error;}
export function createStenosisReportingApi(api) {
  return {
    async analytics(filters={}, {signal}={}) {try{const response=await api.get(filters.case_id?`/cases/${filters.case_id}/stenosis/analytics`:'/stenosis/analytics/summary',{params:filters,signal});if(response.status!==200)fail();return validateSummary(response.data);}catch(error){throw decode(error);}},
    async analysisIndex(filters={}, {signal,limit=10,offset=0}={}) {try{const response=await api.get('/stenosis/analytics/analyses',{params:{...filters,limit,offset},signal});if(response.status!==200)fail();return validateIndex(response.data);}catch(error){throw decode(error);}},
    async report(caseId,analysisId,{signal}={}) {try{const response=await api.get(reportPath(caseId,analysisId),{signal});if(response.status!==200)fail();return await validateReport(response.data,caseId,analysisId);}catch(error){throw decode(error);}},
    async reportCsv(caseId,analysisId,{signal}={}) {
      try{const response=await api.get(reportPath(caseId,analysisId)+'.csv',{signal,responseType:'blob'});
        if(response.status!==200||!(response.data instanceof Blob)||!response.data.size||!/^text\/csv\b/i.test(response.headers?.['content-type']||response.data.type))throw new Error('The server did not return a CSV findings report.');
        return response.data;
      }catch(error){if(error.response?.data instanceof Blob){try{error.response.data=JSON.parse(await error.response.data.text());}catch{/* keep HTTP failure */}}throw decode(error);}
    },
  };
}
