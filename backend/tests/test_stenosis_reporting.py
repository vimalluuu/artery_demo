"""Synthetic persisted fixtures, disposable PostgreSQL; no medical computation."""
from datetime import timedelta
import csv
import io
from uuid import uuid4
from uuid import UUID
from types import SimpleNamespace

from fastapi import HTTPException
import pytest
from sqlalchemy import update
from app.models import Case, Patient, SegmentationResult, StenosisAnalysisJob as Job
from app.services import stenosis_jobs as jobs, stenosis_results as results, stenosis_analytics as analytics, source_fingerprint as fingerprints
from app.services.stenosis_reporting import csv_cell
from app.schemas.stenosis_reporting import AnalyticsFilters
from test_stenosis_results import source_case, postgres_only, runtime, volume, claimed, endpoint
from test_stenosis_explanations import supplied, binding


def completed(db,volume,runtime,count=2,change=None,explanations=()):
    job,token,payload=claimed(db,volume,runtime,count=count)
    if change: change(payload)
    result_id=results.persist_completed_result(db,job.analysis_id,token,payload,runtime,explanations=explanations)
    return job,result_id


def get_summary(client,headers,params=None):
    response=client.get('/api/v1/stenosis/analytics/summary',headers=headers,params=params)
    assert response.status_code==200,response.text
    return response.json()


def test_empty_database_is_zero_with_explicit_unsupported_metrics(client,account):
    _,headers=account('Admin');value=get_summary(client,headers)
    assert value['jobs']['total']==value['current']['analyses']==value['current']['lesions']==0
    assert value['severity_distribution'] is None and value['measurement_summary_status']=='unavailable'
    assert value['execution_available'] is False


def test_counts_distinguish_jobs_results_lesions_and_generic_case_status(client,db,volume,runtime):
    db.get(Case,volume.case_id).status='complete';db.commit()
    completed(db,volume,runtime,0);completed(db,volume,runtime,2)
    queued=jobs.accepted_job(db,volume.case_id,volume.request,volume.user_id,str(uuid4()),runtime)[0]
    running=jobs.accepted_job(db,volume.case_id,volume.request,volume.user_id,str(uuid4()),runtime)[0];jobs.claim_job(db,running.analysis_id,runtime)
    failed=jobs.accepted_job(db,volume.case_id,volume.request,volume.user_id,str(uuid4()),runtime)[0];jobs.fail_job(db,failed.analysis_id,'dispatch_failed')
    value=get_summary(client,volume.headers)
    assert value['jobs']=={'total':5,'queued':1,'running':1,'completed':2,'failed':1}
    assert value['current']['analyses']==2 and value['current']['unique_cases']==value['current']['unique_patients']==1
    assert value['current']['lesions']==2 and value['current']['zero_finding_analyses']==1
    assert sum(sum(day[s] for s in ['queued','running','completed','failed']) for day in value['trends']['items'])==5


def test_stale_and_unverified_excluded_without_rehashing_any_ct(client,db,volume,runtime,monkeypatch):
    completed(db,volume,runtime)
    monkeypatch.setattr(fingerprints,'_read_digest',lambda *_:(_ for _ in ()).throw(AssertionError('Dashboard must not read CT bytes')))
    fingerprints._observed.clear()
    value=get_summary(client,volume.headers)
    assert value['quality']['unverified']==1 and value['current']['analyses']==0
    # Existing explicit result verification can warm a cold observation.
    monkeypatch.undo();fingerprints.source_sha256(volume.path)
    volume.path.write_bytes(b'changed source, same path')
    value=get_summary(client,volume.headers)
    assert value['quality']['stale']==1 and value['jobs']['completed']==1 and value['current']['lesions']==0


def test_missing_result_is_integrity_error_not_zero_findings(client,db,volume,runtime):
    job,token,_=claimed(db,volume,runtime)
    db.execute(update(Job).where(Job.id==str(job.analysis_id)).values(status='completed',result_reference=str(uuid4()),completed_at=jobs.now(),claim_token_hash=None,lease_expires_at=None));db.commit()
    value=get_summary(client,volume.headers)
    assert value['quality']['integrity_errors']==1 and value['current']['zero_finding_analyses']==0
    response=client.get(endpoint(volume,job)+'/report',headers=volume.headers)
    assert response.json()['report_state']=='integrity_error' and response.json()['result'] is None


def test_available_zero_measurement_labels_and_explanation_metadata_counts(client,db,volume,runtime,tmp_path):
    job,token,payload=claimed(db,volume,runtime)
    payload['lesions'][0]['measurements']['reference_diameter']={'value':0,'unit':'mm','unavailable_reason':None,'method_id':'synthetic','method_version':'1'}
    payload['lesions'][0]['severity']={'category':'provider_label','unavailable_reason':None,'method_id':'synthetic','method_version':'1'}
    payload['lesions'][0]['vessel_label']='Supplied test anatomy'
    item=supplied(tmp_path,payload)
    results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item])
    value=get_summary(client,volume.headers)
    assert value['measurements'][0]=={'field':'reference_diameter','available':1,'unavailable':1}
    assert value['supplied_severity_labels']==1 and value['severity_distribution'] is None
    assert value['current']['explanation_artifacts']==value['current']['analyses_with_explanations']==1
    assert value['anatomy'][0]['label']=='Supplied test anatomy'
    result=client.get(endpoint(volume,job)+'/report',headers=volume.headers).json()
    lesion=next(item for item in result['result']['result']['lesions'] if item['lesion_id']==payload['lesions'][0]['lesion_id'])
    assert lesion['measurements']['reference_diameter']['value']==0
    assert len(result['explanations']['items'])==1


def test_date_status_method_filters_and_pagination(client,db,volume,runtime):
    old,_=completed(db,volume,runtime,0);new,_=completed(db,volume,runtime,2)
    old_date=jobs.now()-timedelta(days=60)
    db.execute(update(Job).where(Job.id==str(old.analysis_id)).values(created_at=old_date));db.commit()
    assert get_summary(client,volume.headers)['jobs']['total']==1
    assert get_summary(client,volume.headers,{'method_id':'different'})['jobs']['total']==0
    params={'start_date':old_date.date().isoformat(),'end_date':jobs.now().date().isoformat(),'status':'completed','method_id':'test-only-provider','method_version':'v1'}
    assert get_summary(client,volume.headers,params)['current']['analyses']==2
    response=client.get('/api/v1/stenosis/analytics/analyses',headers=volume.headers,params={**params,'limit':1,'offset':1})
    assert response.status_code==200,response.text
    assert response.json()['total']==2 and len(response.json()['items'])==1 and not response.json()['has_more']
    history=client.get(f'/api/v1/cases/{volume.case_id}/stenosis/analyses',headers=volume.headers,params={'status':'failed'})
    assert history.status_code==200 and history.json()['total']==0
    assert client.get('/api/v1/stenosis/analytics/trends',headers=volume.headers,params=params).status_code==200


@pytest.mark.parametrize('params',[{'start_date':'2026-12-01','end_date':'2026-01-01'},{'method_version':'v1'},{'status':'unknown'},{'case_id':0},{'start_date':'2020-01-01','end_date':'2026-01-01'}])
def test_invalid_filters_are_rejected(client,volume,params):
    assert client.get('/api/v1/stenosis/analytics/summary',headers=volume.headers,params=params).status_code==422


def test_patient_scope_and_access_are_not_widened(client,db,account,volume,runtime):
    completed(db,volume,runtime)
    pid=db.get(Case,volume.case_id).patient_id
    _,research=account('Researcher')
    value=get_summary(client,research)
    assert value['current']['unique_patients'] is None and value['current']['patient_count_reason']
    assert client.get('/api/v1/stenosis/analytics/summary',headers=research,params={'patient_id':pid}).status_code==403
    assert client.get(f'/api/v1/patients/{pid}/stenosis/analytics',headers=research).status_code==403
    assert client.get(f'/api/v1/patients/{pid}/stenosis/analytics',headers=volume.headers).status_code==200
    patient=Patient(patient_code='other-'+uuid4().hex[:8],display_name='Synthetic private label');db.add(patient);db.commit()
    response=client.get(f'/api/v1/cases/{volume.case_id}/stenosis/analytics',headers=volume.headers,params={'patient_id':patient.id})
    assert response.status_code==404
    case=db.get(Case,volume.case_id)
    report_json=client.get(f'/api/v1/cases/{volume.case_id}/stenosis/analyses/'+str(db.query(Job).first().id)+'/report',headers=research).text
    assert 'Synthetic private label' not in report_json and 'display_name' not in report_json and 'password' not in report_json


@pytest.mark.parametrize('count',[0,2])
def test_reports_json_csv_row_semantics_and_formula_safety(client,db,volume,runtime,count):
    def modify(payload):
        if count: payload['lesions'][0]['vessel_label']=' =SUM(1,2)'
    job,_=completed(db,volume,runtime,count,modify)
    response=client.get(endpoint(volume,job)+'/report',headers=volume.headers)
    assert response.status_code==200 and response.json()['report_state']=='completed'
    assert response.json()['schema_version']=='1.0' and len(response.json()['result']['result']['lesions'])==count
    exported=client.get(endpoint(volume,job)+'/report.csv',headers=volume.headers)
    assert exported.status_code==200 and exported.headers['cache-control']=='no-store'
    assert exported.headers['x-content-type-options']=='nosniff' and str(volume.path) not in exported.text
    rows=list(csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig'))))
    assert len(rows)==count
    if count: assert any(row['vessel_label'].startswith("'=SUM") for row in rows)
    else: assert len(exported.content.decode('utf-8-sig').splitlines())==1
    assert client.get(endpoint(volume,job).replace(f'cases/{volume.case_id}',f'cases/{volume.case_id+1}')+'/report',headers=volume.headers).status_code==404


@pytest.mark.parametrize('status',['queued','running','failed','stale'])
def test_status_only_reports_never_export_completed_findings(client,db,volume,runtime,status):
    job,token,payload=claimed(db,volume,runtime)
    if status=='queued':
        db.execute(update(Job).where(Job.id==str(job.analysis_id)).values(status='queued',started_at=None,claim_token_hash=None,lease_expires_at=None));db.commit()
    if status=='failed': jobs.fail_job(db,job.analysis_id,'provider_error',token)
    if status=='stale':
        results.persist_completed_result(db,job.analysis_id,token,payload,runtime);volume.path.write_bytes(b'replaced')
    value=client.get(endpoint(volume,job)+'/report',headers=volume.headers).json()
    assert value['report_state']==status and value['result'] is None and value['unavailable_reason']
    assert client.get(endpoint(volume,job)+'/report.csv',headers=volume.headers).status_code==409


def test_authentication_revocation_and_no_query_failure_zeros(client,db,account,volume,runtime,monkeypatch):
    job,_=completed(db,volume,runtime)
    routes=['/api/v1/stenosis/analytics/summary',endpoint(volume,job)+'/report',endpoint(volume,job)+'/report.csv']
    user,headers=account('Admin')
    for path in routes: assert client.get(path).status_code==401
    user.token_version+=1;db.commit()
    for path in routes: assert client.get(path,headers=headers).status_code==401
    user,headers=account('Admin');user.is_active=False;db.commit()
    for path in routes: assert client.get(path,headers=headers).status_code==401
    monkeypatch.setattr(analytics,'summary',lambda *_:(_ for _ in ()).throw(HTTPException(503,'Analytics unavailable')))
    response=client.get('/api/v1/stenosis/analytics/summary',headers=volume.headers)
    assert response.status_code==503 and 'current' not in response.json()


def test_cohort_limit_returns_error_not_truncated_totals(client,db,volume,runtime,monkeypatch):
    completed(db,volume,runtime);monkeypatch.setattr(analytics,'MAX_COHORT',0)
    response=client.get('/api/v1/stenosis/analytics/summary',headers=volume.headers)
    assert response.status_code==413 and response.json()['detail']['code']=='analytics_scope_too_large'


def test_unique_cases_patients_and_patient_filtered_denominators(client,db,volume,runtime):
    completed(db,volume,runtime)
    original=db.get(Case,volume.case_id);parent=db.get(SegmentationResult,volume.parent_id)
    other=Patient(patient_code='second-'+uuid4().hex[:8],display_name='Synthetic second patient');db.add(other);db.commit()
    for patient_id in [original.patient_id,other.id]:
        case=Case(patient_id=patient_id,case_code='fixture-'+uuid4().hex[:8],volume_path=original.volume_path)
        db.add(case);db.flush()
        segmentation=SegmentationResult(id=str(uuid4()),case_id=case.id,source_volume_path=case.volume_path,metadata_json=parent.metadata_json)
        db.add(segmentation);db.commit()
        reference=volume.request.source.model_copy(update={'case_id':case.id,'parent_segmentation_result_id':UUID(segmentation.id)})
        fixture=SimpleNamespace(**{**vars(volume),'case_id':case.id,'parent_id':segmentation.id,'request':volume.request.model_copy(update={'source':reference})})
        completed(db,fixture,runtime)
    value=get_summary(client,volume.headers)
    assert value['current']['analyses']==3 and value['current']['unique_cases']==3 and value['current']['unique_patients']==2
    assert value['current']['lesions']==6
    patient=get_summary(client,volume.headers,{'patient_id':original.patient_id})
    assert patient['current']['unique_cases']==2 and patient['current']['unique_patients']==1


def test_basic_counts_never_load_full_result_payloads(client,db,volume,runtime,monkeypatch):
    completed(db,volume,runtime)
    monkeypatch.setattr(results.SQLResultStore,'load',lambda *_:(_ for _ in ()).throw(AssertionError('No full result/lesion loading for basic counts')))
    assert get_summary(client,volume.headers)['current']['lesions']==2


def test_csv_preserves_typed_negative_numbers_and_protects_formula_text():
    assert csv_cell(-3.5)==-3.5
    for text in ['=SUM(1,2)',' +CMD','\t@SUM(1)','-3+4']:
        assert csv_cell(text).startswith("'")
