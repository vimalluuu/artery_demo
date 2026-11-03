"""Synthetic XAI only; disposable PostgreSQL, no generator/model execution."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi import HTTPException
import nibabel as nib
import numpy as np
from pydantic import ValidationError
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.database.session import Base, engine
from app.models import Case, StenosisExplanationArtifact, StenosisAnalysisJob
from app.schemas.stenosis import AnalysisResult
from app.schemas.stenosis_explanations import ExplanationSubmission
from app.services import stenosis_explanations as xai, stenosis_results as results, stenosis_jobs as jobs
from app.services.stenosis_geometry import geometry_fingerprint
from app.services.stenosis_runtime import get_runtime
from test_stenosis_results import source_case, postgres_only, runtime, volume, claimed, endpoint, assert_no_result


def supplied(tmp_path,payload,*,scope="volume",signed=False,lesion=None):
    geometry=payload["provenance"]["geometry"]
    values=np.linspace(-1 if signed else 0,1,np.prod(geometry["shape"]),dtype=np.float32).reshape(geometry["shape"])
    if scope=="slice":
        values[:]=0;values[:,:,3]=.5
    path=tmp_path/(str(uuid4())+".nii.gz")
    image=nib.Nifti1Image(values,np.array(geometry["affine"]))
    image.header.set_xyzt_units("mm");image.set_sform(np.array(geometry["affine"]),2);nib.save(image,path)
    return xai.SuppliedExplanation({"contract_version":"1.0","explanation_id":str(uuid4()),"artifact_id":str(uuid4()),
        "analysis_id":payload["analysis_id"],"lesion_id":lesion,"source_sha256":payload["provenance"]["source"]["source_sha256"],
        "geometry_fingerprint":geometry_fingerprint(AnalysisResult.model_validate(payload).provenance.geometry,payload["provenance"]["source"]["source_sha256"]),"geometry":geometry,
        "method_id":"saliency" if signed else "grad_cam","method_name":"Synthetic test attribution","method_version":"test-v1","explanation_type":"attribution",
        "target":{"identifier":"synthetic-target","description":"Synthetic prediction target, never a patient result","prediction_sha256":"c"*64},
        "model_id":"synthetic-model","model_version":"test-v1","checkpoint_sha256":None,"scope":scope,
        "slice_axis":2 if scope=="slice" else None,"slice_index":3 if scope=="slice" else None,
        "values":{"value_type":"signed" if signed else "non_negative","expected_range":[-1 if signed else 0,1],"normalization":"none","normalized_for_visualization":False},
        "format":"nii.gz","content_sha256":sha256(path.read_bytes()).hexdigest(),"shape":geometry["shape"],"dtype":"float32",
        "created_at":jobs.now().isoformat(),"limitations":"Synthetic automated fixture; not medical evidence"},path)


def binding(runtime,*inputs,verify=True):
    providers=[]
    for item in inputs:
        data=item.metadata
        providers.append(SimpleNamespace(**{key:data[key] for key in ["method_id","method_version","model_id","model_version","checkpoint_sha256"]},
            verify_target=lambda target,result,lesion_id: verify and target.identifier=="synthetic-target" and target.prediction_sha256=="c"*64))
    return replace(runtime,explanations=tuple(providers))


@pytest.mark.parametrize("scope,signed",[("volume",False),("lesion",True),("slice",False),("prediction_target",True)])
def test_typed_attribution_persistence_and_protected_exact_bytes(client,db,volume,runtime,tmp_path,scope,signed):
    job,token,payload=claimed(db,volume,runtime)
    item=supplied(tmp_path,payload,scope=scope,signed=signed,lesion=payload["lesions"][0]["lesion_id"] if scope=="lesion" else None)
    original=sha256(item.path.read_bytes()).hexdigest()
    result_id=results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item])
    url=endpoint(volume,job)+"/explanations"
    response=client.get(url,headers=volume.headers)
    assert response.status_code==200,response.text
    data=response.json();assert data["status"]=="available" and len(data["items"])==1 and data["result_id"]==result_id
    assert str(item.path) not in response.text and "claim_token" not in response.text and "storage" not in response.text
    assert response.headers["cache-control"]=="no-store"
    artifact=url+f'/{item.metadata["explanation_id"]}/artifact'
    download=client.get(artifact,headers=volume.headers)
    assert download.status_code==200 and sha256(download.content).hexdigest()==original
    assert download.headers["x-content-type-options"]=="nosniff" and download.headers["cache-control"]=="no-store"
    assert "model_attribution.nii.gz" in download.headers["content-disposition"]
    assert sha256(item.path.read_bytes()).hexdigest()==original
    assert client.get(url).status_code==client.get(artifact).status_code==401
    assert client.post(url,headers=volume.headers,json=item.metadata).status_code==405
    assert client.get(url.replace(f"cases/{volume.case_id}",f"cases/{volume.case_id+20}"),headers=volume.headers).status_code==404
    assert client.get(url+f"/{uuid4()}/artifact",headers=volume.headers).status_code==404


def test_multiple_methods_and_empty_completed_explanation_states(client,db,volume,runtime,tmp_path):
    job,token,payload=claimed(db,volume,runtime)
    items=[supplied(tmp_path,payload),supplied(tmp_path,payload,signed=True,scope="lesion",lesion=payload["lesions"][0]["lesion_id"])]
    results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,*items),explanations=items)
    response=client.get(endpoint(volume,job)+"/explanations",headers=volume.headers)
    assert len(response.json()["items"])==2


def test_no_explanation_is_not_zero_attribution(client,db,volume,runtime):
    job,token,payload=claimed(db,volume,runtime)
    assert client.get(endpoint(volume,job)+"/explanations",headers=volume.headers).json()["detail"]["code"]=="analysis_not_completed"
    results.persist_completed_result(db,job.analysis_id,token,payload,runtime)
    value=client.get(endpoint(volume,job)+"/explanations",headers=volume.headers).json()
    assert value["status"]=="not_generated" and value["items"]==[] and value["unavailable_reason"]


@pytest.mark.parametrize("field,value",[("method_id","fake_cam"),("method_version",""),("scope","unknown"),("dtype","uint8"),("contract_version","2.0"),("target",{"identifier":"","description":"test","prediction_sha256":"c"*64})])
def test_metadata_contract_rejects_invalid_identifiers(db,volume,runtime,tmp_path,field,value):
    _,_,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload);item.metadata[field]=value
    with pytest.raises(ValidationError): ExplanationSubmission.model_validate(item.metadata)


@pytest.mark.parametrize("failure",["range","signed","normalization","baseline","slice","shape"])
def test_value_scope_semantics(db,volume,runtime,tmp_path,failure):
    _,_,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload)
    if failure=="range": item.metadata["values"]["expected_range"]=[1,0]
    if failure=="signed": item.metadata["values"]["value_type"]="signed"
    if failure=="normalization": item.metadata["values"]["normalized_for_visualization"]=True
    if failure=="baseline": item.metadata["method_id"]="integrated_gradients"
    if failure=="slice": item.metadata["scope"]="slice"
    if failure=="shape": item.metadata["shape"]=[1,2,3]
    with pytest.raises(ValidationError): ExplanationSubmission.model_validate(item.metadata)


@pytest.mark.parametrize("failure",["checksum","shape","affine","unknown_units","meters","nan","inf","dtype","scaling","range","negative","slice_leak","corrupt","compressed_limit","expanded_limit","source","geometry_hash","lesion","checkpoint","target","provider"])
def test_invalid_artifact_or_provenance_rolls_back_everything(db,volume,runtime,tmp_path,monkeypatch,failure):
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload,scope="slice" if failure=="slice_leak" else "volume")
    if failure in {"shape","affine","unknown_units","meters","nan","inf","dtype","scaling","range","negative","slice_leak"}:
        image=nib.load(item.path);data=np.asanyarray(image.dataobj).copy();affine=image.affine.copy();units="mm"
        if failure=="shape": data=data[:5]
        if failure=="affine": affine[0,3]+=3
        if failure=="unknown_units": units="unknown"
        if failure=="meters": units="meter"
        if failure in {"nan","inf","range","negative","slice_leak"}: data[0,0,0]={"nan":float("nan"),"inf":float("inf"),"range":1.5,"negative":-.5,"slice_leak":.5}[failure]
        image=nib.Nifti1Image(data.astype(np.uint8) if failure=="dtype" else data,affine)
        image.header.set_xyzt_units(units)
        if failure=="scaling": image.header.set_slope_inter(2,1)
        nib.save(image,item.path)
    if failure=="corrupt": item.path.write_bytes(b"not a NIfTI")
    item.metadata["content_sha256"]=sha256(item.path.read_bytes()).hexdigest()
    if failure=="checksum": item.metadata["content_sha256"]="f"*64
    if failure=="compressed_limit": monkeypatch.setattr(xai,"MAX_ARTIFACT_BYTES",1)
    if failure=="expanded_limit": monkeypatch.setattr(xai,"MAX_EXPANDED_BYTES",400)
    if failure=="source": item.metadata["source_sha256"]="f"*64
    if failure=="geometry_hash": item.metadata["geometry_fingerprint"]="f"*64
    if failure=="lesion": item.metadata["lesion_id"]=str(uuid4())
    if failure=="checkpoint": item.metadata["checkpoint_sha256"]="f"*64
    bound=binding(runtime,item,verify=failure!="target") if failure!="provider" else runtime
    with pytest.raises(HTTPException): results.persist_completed_result(db,job.analysis_id,token,payload,bound,explanations=[item])
    assert_no_result(db,job)
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisExplanationArtifact))==0
    assert not list((Path(xai.settings.OUTPUT_DIR)/"stenosis-explanations").glob(f'*/{item.metadata["explanation_id"]}/*'))


@pytest.mark.parametrize("failure",["commit","duplicate","source_after_save","lease_after_save"])
def test_late_failure_atomicity_and_owned_cleanup(db,volume,runtime,tmp_path,monkeypatch,failure):
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload);bound=binding(runtime,item)
    items=[item,item] if failure=="duplicate" else [item]
    if failure=="commit": monkeypatch.setattr(db,"commit",lambda:(_ for _ in ()).throw(RuntimeError("synthetic DB failure")))
    if failure in {"source_after_save","lease_after_save"}:
        original=xai.persist_explanation_artifact
        def persist(*args,**kwargs):
            value=original(*args,**kwargs)
            if failure=="source_after_save": volume.path.write_bytes(b"synthetic replacement")
            else:
                future=jobs.now()+timedelta(hours=1);monkeypatch.setattr(jobs,"now",lambda:future)
            return value
        monkeypatch.setattr(xai,"persist_explanation_artifact",persist)
    with pytest.raises(HTTPException): results.persist_completed_result(db,job.analysis_id,token,payload,bound,explanations=items)
    assert_no_result(db,job)
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisExplanationArtifact))==0
    assert item.path.is_file() and not list((Path(xai.settings.OUTPUT_DIR)/"stenosis-explanations").glob(f'*/{item.metadata["explanation_id"]}/*'))


def test_immutable_rows_and_cannot_append_after_completion(db,volume,runtime,tmp_path):
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload)
    results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item])
    row=db.get(StenosisExplanationArtifact,item.metadata["explanation_id"])
    copy={col.name:getattr(row,col.name) for col in row.__table__.columns};copy["id"]=str(uuid4());copy["artifact_id"]=str(uuid4())
    for statement in [sa.update(StenosisExplanationArtifact).values(metadata_json={}),sa.delete(StenosisExplanationArtifact),sa.insert(StenosisExplanationArtifact).values(**copy)]:
        with pytest.raises(IntegrityError): db.execute(statement);db.commit()
        db.rollback()


@pytest.mark.parametrize("role",["Admin","Clinician","Researcher","DataScientist"])
def test_existing_read_policy_and_session_revocation(client,db,account,volume,runtime,tmp_path,role):
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload)
    results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item])
    user,headers=account(role);url=endpoint(volume,job)+"/explanations"
    assert client.get(url,headers=headers).status_code==200
    artifact=url+f'/{item.metadata["explanation_id"]}/artifact'
    user.token_version+=1;db.commit()
    assert client.get(url,headers=headers).status_code==client.get(artifact,headers=headers).status_code==401
    user,headers=account(role);user.is_active=False;db.commit()
    assert client.get(url,headers=headers).status_code==401


def test_missing_changed_artifacts_and_stale_source_are_distinct(client,db,volume,runtime,tmp_path):
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload)
    result_id=results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item])
    url=endpoint(volume,job)+f'/explanations/{item.metadata["explanation_id"]}/artifact'
    path=xai.artifact_path(result_id,item.metadata["explanation_id"],item.metadata["artifact_id"],"nii.gz")
    original=path.read_bytes();path.write_bytes(b"replacement")
    response=client.get(url,headers=volume.headers)
    assert response.status_code==409 and response.json()["detail"]["code"]=="artifact_integrity_failure"
    path.unlink();assert client.get(url,headers=volume.headers).json()["detail"]["code"]=="artifact_unavailable"
    path.write_bytes(original);volume.path.write_bytes(b"replaced source")
    assert client.get(url,headers=volume.headers).json()["detail"]["code"]=="source_changed"


def test_migration_roundtrip_preserves_results_lesions_jobs(db,volume,runtime,tmp_path):
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload)
    result_id=results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item]);db.rollback()
    with engine.connect() as connection: assert compare_metadata(MigrationContext.configure(connection),Base.metadata)==[]
    command.downgrade(Config("alembic.ini"),"0007_stenosis_results")
    db.expire_all();assert db.get(Case,volume.case_id) and db.get(StenosisAnalysisJob,str(job.analysis_id)).status=="completed"
    assert results.SQLResultStore().load(db,result_id).lesions
    db.rollback();command.upgrade(Config("alembic.ini"),"head")
    assert xai.list_explanations(db,volume.case_id,job.analysis_id).status=="not_generated"
    with engine.connect() as connection: assert compare_metadata(MigrationContext.configure(connection),Base.metadata)==[]


def test_generation_stays_unavailable():
    assert get_runtime() is None


@pytest.mark.parametrize("replace_source",[False,True])
def test_validation_to_read_replacement_uses_snapshot_or_rejects_source(client,db,volume,runtime,tmp_path,monkeypatch,replace_source):
    from app.routers import stenosis_explanations as router
    job,token,payload=claimed(db,volume,runtime);item=supplied(tmp_path,payload)
    result_id=results.persist_completed_result(db,job.analysis_id,token,payload,binding(runtime,item),explanations=[item])
    path=xai.artifact_path(result_id,item.metadata["explanation_id"],item.metadata["artifact_id"],"nii.gz")
    expected=path.read_bytes();original=router.snapshot_source
    def snapshot(*args,**kwargs):
        assert kwargs["max_bytes"]==xai.MAX_ARTIFACT_BYTES
        handle=original(*args,**kwargs)
        (volume.path if replace_source else path).write_bytes(b"replacement after validation")
        return handle
    monkeypatch.setattr(router,"snapshot_source",snapshot)
    response=client.get(endpoint(volume,job)+f'/explanations/{item.metadata["explanation_id"]}/artifact',headers=volume.headers)
    if replace_source:
        assert response.status_code==409 and response.json()["detail"]["code"]=="source_changed"
    else:
        assert response.status_code==200 and response.content==expected


def test_snapshot_enforces_tighter_limit_on_opened_descriptor(tmp_path):
    from app.routers.segmentation import snapshot_source
    path=(tmp_path/"synthetic.bin").resolve();path.write_bytes(b"12345")
    with pytest.raises(HTTPException): snapshot_source(path,sha256(path.read_bytes()).hexdigest(),False,max_bytes=4)
