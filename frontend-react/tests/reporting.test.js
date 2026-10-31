import test from 'node:test';
import assert from 'node:assert/strict';
import {createStenosisReportingApi,validateSummary,validateReport,validateIndex} from '../src/api/stenosis-reporting-contract.js';
import {reportJsonBlob} from '../src/lib/exports.js';
import {summaryFixture,indexFixture,reportFixture} from './reporting-fixtures.js';

test('server-derived zero and populated summaries preserve unavailable metrics',()=>{
  for(const populated of [false,true]){const data=summaryFixture({populated});assert.equal(validateSummary(data),data);assert.equal(data.severity_distribution,null);}
});
for(const kind of ['missing','sum','quality','missing_measurements','unknown_severity','patients'])test(`malformed analytics ${kind} is not a zero success`,()=>{
  const data=summaryFixture({populated:true});if(kind==='missing')delete data.jobs;if(kind==='sum')data.jobs.total=99;if(kind==='quality')data.quality.unverified=99;if(kind==='missing_measurements')data.measurements.pop();if(kind==='unknown_severity')data.severity_distribution=[];if(kind==='patients')data.current.unique_patients='unknown';
  assert.throws(()=>validateSummary(data));
});
test('index identity and pagination are checked',()=>{assert.ok(validateIndex(indexFixture({populated:true})));const data=indexFixture();data.has_more=true;assert.throws(()=>validateIndex(data));});
for(const state of ['completed','failed','queued','running','stale','integrity_error'])test(`typed ${state} report preserves findings availability`,async()=>{
  const report=await reportFixture({state});assert.equal(await validateReport(report,1,report.analysis.analysis_id),report);if(state!=='completed')assert.equal(report.result,null);
});
test('zero-finding completed report remains a genuine typed result',async()=>{const report=await reportFixture({count:0});await validateReport(report,1,report.analysis.analysis_id);assert.equal(report.result.result.lesions.length,0);});
test('cross-case and fabricated completed reports fail closed',async()=>{
  const report=await reportFixture();await assert.rejects(validateReport(report,2,report.analysis.analysis_id));report.result=null;await assert.rejects(validateReport(report,1,report.analysis.analysis_id));
});
test('shared authenticated adapter passes filters and cancellation without deriving counts',async()=>{
  const calls=[],controller=new AbortController(),data=summaryFixture();const api=createStenosisReportingApi({get:async(...args)=>{calls.push(args);return{status:200,data};}});
  await api.analytics({case_id:1,status:'completed'},{signal:controller.signal});assert.deepEqual(calls,[[ '/cases/1/stenosis/analytics',{params:{case_id:1,status:'completed'},signal:controller.signal} ]]);
});
test('HTTP errors stay errors and Blob error bodies never download as CSV',async()=>{
  const report=await reportFixture(),failure=Object.assign(new Error('HTTP 409'),{response:{data:new Blob([JSON.stringify({detail:{contract_version:'1.0',code:'source_changed',message:'Source changed'}})],{type:'application/json'})}});
  const api=createStenosisReportingApi({get:async()=>{throw failure;}});
  await assert.rejects(api.reportCsv(1,report.analysis.analysis_id),{code:'source_changed',message:'Source changed'});
  await assert.rejects(createStenosisReportingApi({get:async()=>({status:200,data:new Blob(['<html>'],{type:'text/html'})})}).reportCsv(1,report.analysis.analysis_id),/CSV findings/);
});
test('versioned JSON export allowlists top-level report fields',async()=>{
  const report=await reportFixture();report.worker_token='must not export';const body=JSON.parse(await reportJsonBlob(report).text());assert.equal(body.schema_version,'1.0');assert.equal(body.worker_token,undefined);assert.equal(body.result.result.lesions.length,3);
});

test('report identifiers use the same UUID case semantics as jobs and results',async()=>{
  const report=await reportFixture(),canonical=report.analysis.analysis_id,upper=canonical.toUpperCase();
  assert.notEqual(upper,canonical);
  assert.equal(await validateReport(report,1,upper),report);
  const paths=[];
  const api=createStenosisReportingApi({get:async path=>{paths.push(path);return {status:200,data:report};}});
  await api.report(1,upper);
  assert.deepEqual(paths,[`/cases/1/stenosis/analyses/${canonical}/report`]);
});

test('unavailable measurements preserve independently optional method metadata',async()=>{
  for(const field of ['method_id','method_version']){
    const report=await reportFixture(),measurement=report.result.result.lesions[0].measurements.reference_diameter;
    measurement[field]='supplied-optional';
    assert.equal(measurement.value,null);
    assert.equal(await validateReport(report,1,report.analysis.analysis_id),report);
    measurement[field]='invalid method with spaces';
    await assert.rejects(validateReport(report,1,report.analysis.analysis_id));
  }
});
