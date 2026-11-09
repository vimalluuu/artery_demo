"""Synthetic offline documents in isolated test storage/DB, never real volumes."""
from copy import deepcopy
from io import StringIO
import json
from uuid import uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from alembic import command
from alembic.config import Config
from app.models import Case, Patient
from app.models.evaluation import Evaluation, EvaluationArtifact, EvaluationModelRun, EvaluationCase
from app.services import evaluations as service


@pytest.fixture
def setup(client, account, db):
    _, headers = account("DataScientist")
    patient = Patient(patient_code=uuid4().hex, display_name="Synthetic evaluation fixture")
    db.add(patient);db.flush()
    cases = [Case(patient_id=patient.id, case_code=uuid4().hex) for _ in range(3)]
    db.add_all(cases);db.commit()
    metadata = dict(model=dict(id="synthetic-unet", architecture="SyntheticTestModel", display_name="Synthetic fixture"),
        checkpoint=dict(sha256="a"*64, training_run_id="synthetic-historical-reference", reported_training_steps=None),
        threshold=0.70, validation_split_source=dict(dataset="synthetic-only", manifest_sha256="b"*64,
                 workbook_sha256="c"*64, sheet="synthetic", split_column="fixture", split="Val"),
        metric_definitions=dict(version="binary-voxel/1.0", reference_foreground="label > 0", prediction_foreground="binary label 1", zero_denominator="null"),
        provenance=dict(source="synthetic-unit-test", evaluation_version="test/1"))
    def value(case, tp, fp, fn):
        counts=dict(tp=tp, fp=fp, fn=fn)
        ratio=lambda n,d:n/d if d else None
        return dict(case_id=case.id, dataset_case_id=f"synthetic-{case.id}", reference_sha256="d"*64, prediction_sha256="e"*64,
            confusion_counts=counts, metrics=dict(dice=ratio(2*tp,2*tp+fp+fn), iou=ratio(tp,tp+fp+fn), precision=ratio(tp,tp+fp), recall=ratio(tp,tp+fn)))
    doc=dict(schema_version="offline-evaluation/1.0", metadata=metadata, cases=[value(cases[0],1,0,1),value(cases[1],9,1,0)])
    return dict(headers=headers, cases=cases, document=doc)


def upload(client, setup, document=None, headers=None):
    return client.post("/api/v1/evaluations/artifacts",headers=headers or setup["headers"],
        files={"file":("offline.json",json.dumps(document or setup["document"]),"application/json")})


def imported(client, setup, document=None):
    doc=document or setup["document"]
    artifact=upload(client,setup,doc)
    assert artifact.status_code==201,artifact.text
    response=client.post("/api/v1/evaluations/import",headers=setup["headers"],
        json=dict(source_artifact_id=artifact.json()["id"],metadata=doc["metadata"]))
    assert response.status_code==201,response.text
    return artifact.json(),response.json()


def test_import_idempotent_real_stored_artifact(client, setup, db):
    artifact,result=imported(client,setup)
    assert db.get(EvaluationArtifact,artifact["id"]) is not None
    assert service.artifact_path(artifact["id"]).is_file()
    repeat=client.post("/api/v1/evaluations/import",headers=setup["headers"],
        json=dict(source_artifact_id=artifact["id"],metadata=setup["document"]["metadata"]))
    assert repeat.status_code==200 and repeat.json()["id"]==result["id"]
    assert db.scalar(select(func.count()).select_from(Evaluation))==1
    assert repeat.headers["cache-control"]=="no-store" and repeat.headers["x-content-type-options"]=="nosniff"
    assert "storage_path" not in artifact and "uploaded_by" not in artifact


@pytest.mark.parametrize("change",["threshold","checkpoint","split","definitions","provenance"])
def test_same_artifact_conflicting_metadata_is_409(client,setup,change):
    artifact,_=imported(client,setup)
    metadata=deepcopy(setup["document"]["metadata"])
    if change=="threshold":metadata["threshold"]=0.6
    elif change=="checkpoint":metadata["checkpoint"]["sha256"]="f"*64
    elif change=="split":metadata["validation_split_source"]["manifest_sha256"]="f"*64
    elif change=="definitions":metadata["metric_definitions"]["reference_foreground"]="label == 1"
    else:metadata["provenance"]["evaluation_version"]="test/2"
    response=client.post("/api/v1/evaluations/import",headers=setup["headers"],json=dict(source_artifact_id=artifact["id"],metadata=metadata))
    assert response.status_code==409


@pytest.mark.parametrize("identifier,status",[("not-an-upload",422),(str(uuid4()),404)])
def test_invalid_source_artifact(client,setup,identifier,status):
    result=client.post("/api/v1/evaluations/import",headers=setup["headers"],json=dict(source_artifact_id=identifier,metadata=setup["document"]["metadata"]))
    assert result.status_code==status


@pytest.mark.parametrize("role,allowed",[("Clinician",False),("Researcher",False),("DataScientist",True),("Admin",True)])
def test_import_role_matrix_and_read_policy(client,setup,account,role,allowed):
    _,headers=account(role)
    posted=upload(client,setup,headers=headers)
    assert posted.status_code==(201 if allowed else 403)
    artifact,result=imported(client,setup)
    response=client.post("/api/v1/evaluations/import",headers=headers,json=dict(source_artifact_id=artifact["id"],metadata=setup["document"]["metadata"]))
    assert response.status_code==(200 if allowed else 403)
    assert client.get(f"/api/v1/evaluations/{result['id']}/summary",headers=headers).status_code==200


def test_authentication_all_routes(client,setup):
    artifact,result=imported(client,setup)
    for route in [f"/evaluations/{result['id']}/summary",f"/evaluations/{result['id']}/cases", "/models/synthetic-unet/runs",
                  f"/stenosis/evaluations/{result['id']}/cases/{setup['cases'][0].id}/sections",
                  f"/evaluations/compare?ids={result['id']},{uuid4()}"]:
        assert client.get("/api/v1"+route).status_code==401
    assert client.post("/api/v1/evaluations/import",json=dict(source_artifact_id=artifact["id"],metadata=setup["document"]["metadata"])).status_code==401


def test_macro_is_case_unweighted_and_pooled_is_separate(client,setup):
    _,result=imported(client,setup)
    expected=(2/3+18/19)/2
    assert result["headline_aggregation"]=="macro_unweighted_per_case"
    assert result["macro_metrics"]["dice"]==pytest.approx(expected)
    assert result["pooled_micro_metrics"]["dice"]==pytest.approx(20/22)
    assert result["macro_metrics"]["dice"]!=result["pooled_micro_metrics"]["dice"]
    details=client.get(f"/api/v1/evaluations/{result['id']}/cases",headers=setup["headers"]).json()
    assert details["metric_definitions"]["zero_denominator"]=="null"
    assert details["cases"][0]["metrics"]==setup["document"]["cases"][0]["metrics"]
    assert details["cases"][0]["reference_sha256"]=="d"*64


def test_undefined_and_excluded_cases_do_not_seed_metrics(client,setup):
    doc=deepcopy(setup["document"])
    for row in doc["cases"]:
        row["metrics"]={name:None for name in service.METRICS}
        row["confusion_counts"]=dict(tp=0,fp=0,fn=0)
    doc["cases"][1]["exclusion_reason"]="Synthetic missing annotation"
    _,result=imported(client,setup,doc)
    assert all(v is None for v in result["macro_metrics"].values())
    assert all(v is None for v in result["pooled_micro_metrics"].values())
    assert result["included_case_count"]==1 and len(result["exclusions"])==1
    assert result["macro_denominators"]["dice"]==dict(defined_cases=0,undefined_cases=1)


def test_missing_confusion_counts_does_not_fabricate_pooled_metrics(client,setup):
    doc=deepcopy(setup["document"]);doc["cases"][0].pop("confusion_counts")
    _,result=imported(client,setup,doc)
    assert result["pooled_micro_metrics"] is None
    assert result["pooled_status"].startswith("unavailable")


def test_exact_case_set_comparison(client,setup):
    _,one=imported(client,setup)
    doc=deepcopy(setup["document"]);doc["cases"].reverse();doc["metadata"]["threshold"]=0.6
    _,two=imported(client,setup,doc)
    response=client.get(f"/api/v1/evaluations/compare?ids={one['id']},{two['id']}",headers=setup["headers"])
    assert response.status_code==200
    assert len(response.json()["evaluations"])==2
    assert response.json()["evaluations"][1]["metadata"]["validation_split_source"]["manifest_sha256"]=="b"*64
    doc["cases"]=doc["cases"][:1]
    _,three=imported(client,setup,doc)
    mismatch=client.get(f"/api/v1/evaluations/compare?ids={one['id']},{three['id']}",headers=setup["headers"])
    assert mismatch.status_code==409 and "case sets" in mismatch.json()["detail"]


def test_all_case_reads_reuse_existing_case_lookup(client,setup,monkeypatch):
    _,result=imported(client,setup)
    original=service.case_access.readable_cases
    monkeypatch.setattr(service.case_access,"readable_cases",
        lambda:original().where(Case.id != setup["cases"][1].id))
    for route in [f"/evaluations/{result['id']}/summary",f"/evaluations/{result['id']}/cases",
                  f"/stenosis/evaluations/{result['id']}/cases/{setup['cases'][0].id}/sections"]:
        assert client.get("/api/v1"+route,headers=setup["headers"]).status_code==404
    history=client.get("/api/v1/models/synthetic-unet/runs",headers=setup["headers"])
    assert history.status_code==200
    assert history.json()["evaluations"]==history.json()["training_runs"]==[]
    assert history.json()["pagination"]["returned_evaluations"]==0
    assert upload(client,setup).status_code==404


def test_nonexistent_and_nonmember_case_rejected(client,setup):
    doc=deepcopy(setup["document"]);doc["cases"][0]["case_id"]=2147483647
    assert upload(client,setup,doc).status_code==404
    _,result=imported(client,setup)
    assert client.get(f"/api/v1/stenosis/evaluations/{result['id']}/cases/{setup['cases'][2].id}/sections",headers=setup["headers"]).status_code==404


def test_model_history_distinguishes_checkpoint_runs(client,setup):
    _,one=imported(client,setup)
    smoke=deepcopy(setup["document"])
    smoke["metadata"]["checkpoint"]=dict(sha256="f"*64,training_run_id="synthetic-three-step-smoke",reported_training_steps=3)
    _,two=imported(client,setup,smoke)
    history=client.get("/api/v1/models/synthetic-unet/runs",headers=setup["headers"]).json()
    assert len(history["training_runs"])==2 and len(history["evaluations"])==2
    assert {r["checkpoint_sha256"] for r in history["training_runs"]}=={"a"*64,"f"*64}
    assert {r["id"] for r in history["evaluations"]}=={one["id"],two["id"]}
    assert next(r for r in history["training_runs"] if r["checkpoint_sha256"]=="a"*64)["reported_training_steps"] is None
    assert client.get("/api/v1/models/absent/runs",headers=setup["headers"]).status_code==404


def test_same_run_cannot_alias_different_weights(client,setup):
    imported(client,setup)
    doc=deepcopy(setup["document"]);doc["metadata"]["checkpoint"]["sha256"]="f"*64
    artifact=upload(client,setup,doc).json()
    result=client.post("/api/v1/evaluations/import",headers=setup["headers"],json=dict(source_artifact_id=artifact["id"],metadata=doc["metadata"]))
    assert result.status_code==409


@pytest.mark.parametrize("origin",["reference_annotation","model_prediction"])
def test_stenosis_sections_fail_closed_with_mask_provenance(client,setup,origin):
    doc=deepcopy(setup["document"]);case=doc["cases"][0]
    case["mask_provenance"]=dict(origin=origin,mask_sha256=case["reference_sha256"] if origin=="reference_annotation" else case["prediction_sha256"])
    if origin=="model_prediction":case["mask_provenance"]["model_checkpoint_sha256"]="a"*64
    case["sections"]=[dict(section_id="section-0",section_index=0,source_status="diagnostic_only")]
    _,result=imported(client,setup,doc)
    response=client.get(f"/api/v1/stenosis/evaluations/{result['id']}/cases/{case['case_id']}/sections",headers=setup["headers"])
    assert response.status_code==200
    body=response.json();assert body["measurement_status"]=="measurement_unavailable_no_validated_gate"
    assert body["mask_provenance"]["origin"]==origin and body["validated_resolution_gate"] is None
    assert body["sections"][0]["source_status"]=="diagnostic_only"
    assert body["sections"][0]["measurement_status"]==body["measurement_status"]
    assert "stenosis_percent" not in response.text and not body["quantitative_stenosis_available"]


def test_missing_sections_are_explicitly_unavailable(client,setup):
    _,result=imported(client,setup)
    data=client.get(f"/api/v1/stenosis/evaluations/{result['id']}/cases/{setup['cases'][0].id}/sections",headers=setup["headers"]).json()
    assert data["sections"]==[] and data["mask_provenance"] is None
    assert data["section_data_status"]=="unavailable_no_section_records"


@pytest.mark.parametrize("failure",["contradictory_score","duplicate_case","testing","metric_version","bad_prediction_identity","quantitative_section"])
def test_invalid_offline_evidence_is_not_imported(client,setup,db,failure):
    doc=deepcopy(setup["document"])
    if failure=="contradictory_score":doc["cases"][0]["metrics"]["dice"]=0.924
    elif failure=="duplicate_case":doc["cases"].append(deepcopy(doc["cases"][0]))
    elif failure=="testing":doc["metadata"]["validation_split_source"]["split"]="Testing"
    elif failure=="metric_version":doc["metadata"]["metric_definitions"]["version"]="unsupported"
    elif failure=="bad_prediction_identity":doc["cases"][0]["mask_provenance"]=dict(origin="model_prediction",mask_sha256="e"*64,model_checkpoint_sha256="f"*64)
    else:
        doc["cases"][0]["mask_provenance"]=dict(origin="reference_annotation",mask_sha256="d"*64)
        doc["cases"][0]["sections"]=[dict(section_id="s",section_index=0,source_status="diagnostic",stenosis_percent=60)]
    assert upload(client,setup,doc).status_code==422
    assert db.scalar(select(func.count()).select_from(Evaluation))==0


def test_changed_stored_file_rejected(client,setup):
    artifact=upload(client,setup).json()
    service.artifact_path(artifact["id"]).write_text("{}")
    response=client.post("/api/v1/evaluations/import",headers=setup["headers"],json=dict(source_artifact_id=artifact["id"],metadata=setup["document"]["metadata"]))
    assert response.status_code==409


def test_duplicate_source_enforced_by_database(client,setup,db):
    _,result=imported(client,setup)
    row=db.get(Evaluation,result["id"])
    values={column.name:getattr(row,column.name) for column in Evaluation.__table__.columns if column.name not in {"id","created_at"}}
    db.add(Evaluation(id=str(uuid4()),**values))
    with pytest.raises(IntegrityError):db.commit()
    db.rollback()


def test_corrupt_stored_case_fails_closed(client,setup,db):
    _,result=imported(client,setup)
    row=db.get(EvaluationCase,(result["id"],setup["cases"][0].id));payload=deepcopy(row.payload_json)
    payload["reference_sha256"]="f"*64;row.payload_json=payload;db.commit()
    assert client.get(f"/api/v1/evaluations/{result['id']}/summary",headers=setup["headers"]).status_code==409


def test_migration_roundtrip_only_isolated_test_database(client,setup,db):
    artifact,_=imported(client,setup);path=service.artifact_path(artifact["id"]);db.rollback()
    from app.database.session import engine
    with engine.connect() as conn:before=conn.scalar(text("select count(*) from cases"))
    command.downgrade(Config("alembic.ini"),"0008_stenosis_explanations")
    assert "evaluations" not in inspect(engine).get_table_names() and path.exists()
    with engine.connect() as conn:assert conn.scalar(text("select count(*) from cases"))==before
    command.upgrade(Config("alembic.ini"),"head")
    with engine.connect() as conn:assert conn.scalar(text("select count(*) from evaluations"))==0


def test_postgres_migration_compiles_without_database(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,"DATABASE_URL","postgresql+psycopg://test@localhost/unused")
    stream=StringIO();cfg=Config("alembic.ini",output_buffer=stream)
    command.upgrade(cfg,"0008_stenosis_explanations:0009_evaluations",sql=True)
    ddl=stream.getvalue()
    assert "uq_evaluation_source_artifact" in ddl and "FOREIGN KEY(model_run_id, model_id, checkpoint_sha256)" in ddl


def test_excluded_defined_scores_are_not_averaged(client,setup):
    doc=deepcopy(setup["document"]);doc["cases"][1]["exclusion_reason"]="Synthetic excluded scan"
    _,result=imported(client,setup,doc)
    assert result["case_count"]==2 and result["included_case_count"]==1
    assert result["macro_metrics"]["dice"]==pytest.approx(2/3)
    assert result["pooled_micro_metrics"]["dice"]==pytest.approx(2/3)


def test_per_metric_undefined_denominators(client,setup):
    doc=deepcopy(setup["document"])
    doc["cases"][0]["confusion_counts"]=dict(tp=0,fp=0,fn=1)
    doc["cases"][0]["metrics"]=dict(dice=0.,iou=0.,precision=None,recall=0.)
    _,result=imported(client,setup,doc)
    assert result["macro_metrics"]["precision"]==pytest.approx(.9)
    assert result["macro_metrics"]["recall"]==pytest.approx(.5)
    assert result["macro_denominators"]["precision"]==dict(defined_cases=1,undefined_cases=1)


def test_oversized_and_duplicate_key_artifacts_rejected(client,setup):
    response=client.post("/api/v1/evaluations/artifacts",headers=setup["headers"],files={"file":("x.json",b"x"*(service.MAX_ARTIFACT_BYTES+1))})
    assert response.status_code==413
    response=client.post("/api/v1/evaluations/artifacts",headers=setup["headers"],files={"file":("x.json",b'{"metadata":{},"metadata":{}}')})
    assert response.status_code==422


def test_nonfinite_provenance_rejected(client,setup):
    doc=deepcopy(setup["document"]);doc["metadata"]["provenance"]["bad"]=float("nan")
    assert upload(client,setup,doc).status_code==422


def test_import_rechecks_member_cases_after_upload(client,setup,monkeypatch,db):
    artifact=upload(client,setup).json()
    def inaccessible(*args):raise HTTPException(404,"Case not found")
    monkeypatch.setattr(service.case_access,"get_case",inaccessible)
    response=client.post("/api/v1/evaluations/import",headers=setup["headers"],json=dict(source_artifact_id=artifact["id"],metadata=setup["document"]["metadata"]))
    assert response.status_code==404
    assert db.scalar(select(func.count()).select_from(Evaluation))==0


def test_prediction_cannot_reference_another_case_segmentation(client,setup,db):
    from app.models import SegmentationResult
    prediction=SegmentationResult(id=str(uuid4()),case_id=setup["cases"][1].id,source_volume_path="synthetic.nii.gz",metadata_json={"checkpoint_sha256":"a"*64})
    db.add(prediction);db.commit()
    doc=deepcopy(setup["document"])
    doc["cases"][0]["mask_provenance"]=dict(origin="model_prediction",mask_sha256="e"*64,model_checkpoint_sha256="a"*64,segmentation_result_id=prediction.id)
    assert upload(client,setup,doc).status_code==409


def test_postgres_concurrent_repeat_is_idempotent(client,setup,db,monkeypatch):
    if db.get_bind().dialect.name!="postgresql":pytest.skip("Requires disposable PostgreSQL for concurrent transactions")
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    artifact=upload(client,setup).json()
    body=dict(source_artifact_id=artifact["id"],metadata=setup["document"]["metadata"])
    barrier=Barrier(2,timeout=15);lock=Lock();lookups={"absent":0,"recovery":0}
    lookup=service.find_existing_evaluation
    def synchronized(db,artifact_id):
        row=lookup(db,artifact_id)
        if row is None:
            with lock:lookups["absent"]+=1
            barrier.wait()
        else:
            with lock:lookups["recovery"]+=1
        return row
    monkeypatch.setattr(service,"find_existing_evaluation",synchronized)
    def post():return client.post("/api/v1/evaluations/import",headers=setup["headers"],json=body)
    with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:post(),range(2)))
    assert sorted(r.status_code for r in responses)==[200,201]
    assert len({r.json()["id"] for r in responses})==1
    assert {r.json()["source_artifact_id"] for r in responses}=={artifact["id"]}
    assert db.scalar(select(func.count()).select_from(Evaluation))==1
    assert db.scalar(select(Evaluation.source_artifact_id))==artifact["id"]
    assert db.scalar(select(func.count()).select_from(EvaluationModelRun))==1
    assert lookups["absent"]==2 and lookups["recovery"]==1
