"""Bounded request, failure-atomic storage, exact provenance and history tests."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect, select
from fastapi import HTTPException
from starlette.formparsers import MultiPartParser

from app.core.evaluation_upload import EvaluationUploadBodyLimit, MAX_EVALUATION_BODY_BYTES
from app.main import app
from app.models import User, Case, SegmentationResult
from app.models.evaluation import Evaluation, EvaluationArtifact, EvaluationCase
from app.services import evaluations as service
from test_evaluations import setup, upload, imported


@pytest.mark.parametrize("length_header",["oversized","very_long","absent","understated"])
@pytest.mark.parametrize("suffix",["","/"])
def test_oversize_unauthenticated_never_reaches_multipart(monkeypatch,length_header,suffix):
    parser_calls=[]
    async def forbidden_parse(self):
        parser_calls.append(True)
        raise AssertionError("Multipart parsing/spooling must not start")
    monkeypatch.setattr(MultiPartParser,"parse",forbidden_parse)
    chunk=b"x"*(64*1024);chunks=100;received=[];sent=[]
    headers=[(b"content-type",b"multipart/form-data; boundary=probe")]
    if length_header=="oversized":headers.append((b"content-length",str(len(chunk)*chunks).encode()))
    elif length_header=="very_long":headers.append((b"content-length",b"9"*5000))
    elif length_header=="understated":headers.append((b"content-length",b"1"))
    else:headers.append((b"transfer-encoding",b"chunked"))
    async def receive():
        received.append(len(chunk))
        return {"type":"http.request","body":chunk,"more_body":len(received)<chunks}
    async def send(message):sent.append(message)
    scope=dict(type="http",asgi={"version":"3.0"},http_version="1.1",method="POST",scheme="http",
       path="/api/v1/evaluations/artifacts"+suffix,root_path="",query_string=b"",headers=headers,
       client=("127.0.0.1",1234),server=("test",80))
    asyncio.run(app(scope,receive,send))
    assert next(m for m in sent if m["type"]=="http.response.start")["status"]==413
    assert not parser_calls
    assert len(received)<chunks
    assert sum(received)<=MAX_EVALUATION_BODY_BYTES+len(chunk)
    if length_header in {"oversized","very_long"}:assert not received


def test_exact_supported_file_size_works(client,setup):
    raw=json.dumps(setup["document"]).encode()
    raw+=b" "*(service.MAX_ARTIFACT_BYTES-len(raw))
    response=client.post("/api/v1/evaluations/artifacts",headers=setup["headers"],files={"file":("max.json",raw,"application/json")})
    assert response.status_code==201,response.text
    assert response.json()["size_bytes"]==2*1024*1024


def test_small_body_keeps_authentication_and_role_checks(client,setup,account):
    raw=json.dumps(setup["document"])
    assert client.post("/api/v1/evaluations/artifacts",files={"file":("x.json",raw)}).status_code==401
    _,headers=account("Researcher")
    assert client.post("/api/v1/evaluations/artifacts",headers=headers,files={"file":("x.json",raw)}).status_code==403


def test_other_routes_keep_larger_volume_uploads(client,setup,account):
    import nibabel as nib
    import numpy as np
    _,headers=account("Clinician")
    raw=nib.Nifti1Image(np.zeros((128,128,80),dtype=np.int16),np.eye(4)).to_bytes()
    assert len(raw)>MAX_EVALUATION_BODY_BYTES
    response=client.post(f"/api/v1/cases/{setup['cases'][0].id}/volume",headers=headers,files={"file":("synthetic.nii",raw)})
    assert response.status_code==200,response.text


def test_asgi_limit_does_not_buffer_other_paths():
    consumed=[]
    async def downstream(scope,receive,send):
        while True:
            message=await receive();consumed.append(len(message["body"]))
            if not message["more_body"]:break
    calls=[]
    async def receive():
        calls.append(True)
        return dict(type="http.request",body=b"x"*1024**2,more_body=len(calls)<4)
    async def send(message):pass
    asyncio.run(EvaluationUploadBodyLimit(downstream,path="/api/v1/evaluations/artifacts")(
        dict(type="http",method="POST",path="/api/v1/unrelated",headers=[]),receive,send))
    assert sum(consumed)==4*1024**2


def test_asgi_coalesces_tiny_and_empty_chunks_before_parsing():
    chunks=iter([b"",b"a"]*100+[b"end"]);replayed=[]
    async def receive():
        chunk=next(chunks)
        return dict(type="http.request",body=chunk,more_body=chunk!=b"end")
    async def downstream(scope,receive,send):
        replayed.append(await receive())
    async def send(message):pass
    asyncio.run(EvaluationUploadBodyLimit(downstream,path="/api/v1/evaluations/artifacts")(
        dict(type="http",method="POST",path="/api/v1/evaluations/artifacts",headers=[]),receive,send))
    assert replayed==[dict(type="http.request",body=b"a"*100+b"end",more_body=False)]


def test_nginx_uses_exact_matching_small_limits():
    configuration=(Path(__file__).resolve().parents[2]/"deploy/nginx.conf").read_text()
    for location in ("/api/v1/evaluations/artifacts","/api/v1/evaluations/artifacts/"):
        body=configuration.split(f"location = {location} {{",1)[1].split("}",1)[0]
        assert "client_max_body_size 2112k;" in body and "proxy_pass $api_upstream;" in body
    assert "client_max_body_size 2001m;" in configuration
    assert MAX_EVALUATION_BODY_BYTES==2112*1024


@pytest.mark.parametrize("failure",["flush_before_commit","refresh_after_commit","ambiguous_committed","ambiguous_not_committed"])
def test_upload_faults_preserve_committed_or_uncertain_files(setup,db,monkeypatch,failure):
    identifier=uuid4();monkeypatch.setattr(service,"uuid4",lambda:identifier)
    path=service.artifact_path(str(identifier));user=db.scalar(select(User).where(User.role=="DataScientist"))
    raw=json.dumps(setup["document"]).encode()
    def fail(*args,**kwargs):raise RuntimeError("injected upload fault")
    original_commit=db.commit
    if failure=="flush_before_commit":monkeypatch.setattr(db,"flush",fail)
    elif failure=="refresh_after_commit":monkeypatch.setattr(db,"refresh",fail)
    elif failure=="ambiguous_committed":
        def commit_then_fail():original_commit();fail()
        monkeypatch.setattr(db,"commit",commit_then_fail)
    else:monkeypatch.setattr(db,"commit",fail)
    with pytest.raises(RuntimeError,match="injected upload fault"):service.upload(db,user,raw)
    row=db.get(EvaluationArtifact,str(identifier))
    if failure=="flush_before_commit":assert row is None and not path.exists()
    elif failure=="ambiguous_not_committed":assert row is None and path.read_bytes()==raw
    else:
        assert row is not None and path.read_bytes()==raw
        assert row.sha256==hashlib.sha256(raw).hexdigest()


@pytest.mark.parametrize("failure",[None,"case","checkpoint","threshold","mask_hash","missing_checkpoint","missing_threshold","missing_file"])
def test_exact_segmentation_provenance(client,setup,db,failure):
    doc=deepcopy(setup["document"]);case=doc["cases"][0]
    identifier=str(uuid4());directory=service.case_access.result_directory(identifier);directory.mkdir(parents=True)
    path=directory/"prediction_mask.nii.gz";path.write_bytes(b"synthetic stored prediction artifact")
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    metadata=dict(checkpoint_sha256="a"*64,threshold=.7)
    if failure=="checkpoint":metadata["checkpoint_sha256"]="f"*64
    elif failure=="missing_checkpoint":metadata.pop("checkpoint_sha256")
    elif failure=="threshold":metadata["threshold"]=.8
    elif failure=="missing_threshold":metadata.pop("threshold")
    elif failure=="missing_file":path.unlink()
    prediction=SegmentationResult(id=identifier,case_id=setup["cases"][1 if failure=="case" else 0].id,
                                  source_volume_path="synthetic.nii.gz",metadata_json=metadata)
    db.add(prediction);db.commit()
    case["prediction_sha256"]="e"*64 if failure=="mask_hash" else digest
    case["mask_provenance"]=dict(origin="model_prediction",mask_sha256=case["prediction_sha256"],
                  model_checkpoint_sha256="a"*64,segmentation_result_id=identifier)
    artifact=upload(client,setup,doc)
    if failure:assert artifact.status_code==409,artifact.text
    else:
        assert artifact.status_code==201
        body=dict(source_artifact_id=artifact.json()["id"],metadata=doc["metadata"])
        response=client.post("/api/v1/evaluations/import",headers=setup["headers"],json=body)
        assert response.status_code==201,response.text
        value=client.get(f"/api/v1/stenosis/evaluations/{response.json()['id']}/cases/{case['case_id']}/sections",headers=setup["headers"])
        assert value.status_code==200 and value.json()["mask_provenance"]["mask_sha256"]==digest
        assert value.json()["measurement_status"]=="measurement_unavailable_no_validated_gate"
        path.write_bytes(b"changed prediction bytes")
        assert client.get(f"/api/v1/evaluations/{response.json()['id']}/cases",headers=setup["headers"]).status_code==409


@pytest.fixture
def history(client,setup,db):
    # Real imported synthetic source followed by actual stored clone records, no
    # large payloads/inference. All headers have independently computed digests.
    _,first=imported(client,setup)
    original=db.get(Evaluation,first["id"])
    payloads=list(db.scalars(select(EvaluationCase).where(EvaluationCase.evaluation_id==original.id)))
    timestamp=datetime(2026,1,1,tzinfo=timezone.utc)
    original.created_at=timestamp
    identifiers=[original.id]
    source_bytes=service.artifact_path(original.source_artifact_id).read_bytes()
    for i in range(104):
        artifact=EvaluationArtifact(id=str(uuid4()),sha256=hashlib.sha256(source_bytes).hexdigest(),size_bytes=len(source_bytes))
        service.artifact_path(artifact.id).write_bytes(source_bytes)
        db.add(artifact);db.flush()
        row=Evaluation(id=str(uuid4()),source_artifact_id=artifact.id,model_id=original.model_id,model_run_id=original.model_run_id,
             checkpoint_sha256=original.checkpoint_sha256,threshold=original.threshold,metadata_json=deepcopy(original.metadata_json),
             payload_sha256=original.payload_sha256,created_at=timestamp)
        row.history_sha256=service.history_digest(row,[r.case_id for r in payloads])
        db.add(row);db.flush()
        for item in payloads:db.add(EvaluationCase(evaluation_id=row.id,case_id=item.case_id,payload_json=deepcopy(item.payload_json)))
        identifiers.append(row.id)
    db.commit()
    return sorted(identifiers)


def test_history_default_maximum_pages_and_order(client,setup,history):
    route="/api/v1/models/synthetic-unet/runs"
    def get(params):return client.get(route,headers=setup["headers"],params=params)
    first=get({}).json();second=get({"offset":20}).json()
    assert [r["id"] for r in first["evaluations"]]==history[:20]
    assert [r["id"] for r in second["evaluations"]]==history[20:40]
    assert first["pagination"]==dict(limit=20,offset=0,next_offset=20,offset_limit_reached=False,returned_evaluations=20,returned_training_runs=1)
    maximum=get({"limit":100}).json();tail=get({"limit":100,"offset":100}).json()
    assert [r["id"] for r in maximum["evaluations"]]==history[:100]
    assert [r["id"] for r in tail["evaluations"]]==history[100:]
    assert tail["pagination"]["next_offset"] is None
    assert get({"limit":101}).status_code==422 and get({"offset":-1}).status_code==422


def test_history_does_not_load_case_payloads(client,setup,history,monkeypatch,db):
    def forbidden(*args):raise AssertionError("Full evaluation reconstruction is forbidden for history")
    monkeypatch.setattr(service,"load",forbidden)
    statements=[]
    def observe(conn,cursor,statement,parameters,context,executemany):statements.append(statement.lower())
    event.listen(db.get_bind(),"before_cursor_execute",observe)
    try:response=client.get("/api/v1/models/synthetic-unet/runs?limit=2",headers=setup["headers"])
    finally:event.remove(db.get_bind(),"before_cursor_execute",observe)
    assert response.status_code==200
    assert not any("evaluation_cases.payload_json" in s for s in statements)
    assert any("from evaluations" in s and "exists" in s and "from cases" in s
               and "limit" in s and "offset" in s for s in statements)


def test_history_case_authorization_cache_is_request_local(client,setup,history,monkeypatch):
    original=service.case_access.get_case;checked=[]
    def observe(db,case_id):
        checked.append(case_id)
        return original(db,case_id)
    monkeypatch.setattr(service.case_access,"get_case",observe)
    for _ in range(2):
        before=len(checked)
        response=client.get("/api/v1/models/synthetic-unet/runs?limit=100",headers=setup["headers"])
        assert response.status_code==200
        assert sorted(checked[before:])==sorted([c.id for c in setup["cases"][:2]])


def test_history_filters_inaccessible_without_counts_or_training_source_leak(client,setup,db,monkeypatch):
    _,hidden=imported(client,setup)
    document=deepcopy(setup["document"]);document["cases"]=document["cases"][:1]
    _,visible=imported(client,setup,document)
    original=service.case_access.readable_cases
    monkeypatch.setattr(service.case_access,"readable_cases",
        lambda:original().where(Case.id != setup["cases"][1].id))
    response=client.get("/api/v1/models/synthetic-unet/runs",headers=setup["headers"])
    assert response.status_code==200
    body=response.json()
    assert [r["id"] for r in body["evaluations"]]==[visible["id"]]
    assert hidden["id"] not in response.text and hidden["source_artifact_id"] not in response.text
    assert body["training_runs"]==[] and body["pagination"]["returned_evaluations"]==1
    assert "total" not in body["pagination"]


@pytest.fixture
def limited_history(client,setup,db,monkeypatch):
    def arrange(visible):
        ids=[]
        for index,allowed in enumerate(visible):
            document=deepcopy(setup["document"])
            document["cases"]=[document["cases"][0 if allowed else 1]]
            _,value=imported(client,setup,document)
            row=db.get(Evaluation,value["id"])
            row.created_at=datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(seconds=index)
            ids.append(row.id)
        db.commit()
        original=service.case_access.readable_cases
        monkeypatch.setattr(service.case_access,"readable_cases",
            lambda:original().where(Case.id != setup["cases"][1].id))
        return ids
    return arrange


@pytest.mark.parametrize("count",[1,3])
def test_history_hidden_only_has_no_continuation(client,setup,limited_history,count):
    hidden=limited_history([False]*count)
    response=client.get("/api/v1/models/synthetic-unet/runs?limit=1",headers=setup["headers"])
    assert response.status_code==200
    body=response.json()
    assert body["evaluations"]==body["training_runs"]==[]
    assert body["pagination"]==dict(limit=1,offset=0,next_offset=None,offset_limit_reached=False,
                                   returned_evaluations=0,returned_training_runs=0)
    assert not any(identifier in response.text for identifier in hidden)


def test_history_denied_tail_does_not_create_another_page(client,setup,limited_history):
    ids=limited_history([True,False,False])
    response=client.get("/api/v1/models/synthetic-unet/runs?limit=1",headers=setup["headers"])
    assert response.status_code==200
    body=response.json()
    assert [r["id"] for r in body["evaluations"]]==ids[:1]
    assert body["pagination"]["next_offset"] is None
    assert body["pagination"]["returned_evaluations"]==1
    assert not any(identifier in response.text for identifier in ids[1:])


def test_history_mixed_access_pages_count_only_authorized_rows(client,setup,limited_history):
    ids=limited_history([False,True,False,True,False])
    for offset,expected,next_offset in [(0,[ids[1]],1),(1,[ids[3]],None),(2,[],None)]:
        response=client.get(f"/api/v1/models/synthetic-unet/runs?limit=1&offset={offset}",headers=setup["headers"])
        assert response.status_code==200
        body=response.json()
        assert [r["id"] for r in body["evaluations"]]==expected
        assert body["pagination"]["next_offset"]==next_offset
        assert body["pagination"]["returned_evaluations"]==len(expected)
        assert body["pagination"]["offset_limit_reached"] is False
        assert not any(identifier in response.text for identifier in ids[::2])


@pytest.mark.parametrize("denied_index",[0,1])
def test_history_access_change_after_sql_fails_without_pagination(client,setup,db,monkeypatch,denied_index):
    for index in range(2):
        document=deepcopy(setup["document"]);document["cases"]=[document["cases"][index]]
        _,value=imported(client,setup,document)
        db.get(Evaluation,value["id"]).created_at=datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(seconds=index)
    db.commit()
    original=service.case_access.get_case
    def deny(db,case_id):
        if case_id==setup["cases"][denied_index].id:raise HTTPException(403,"Access changed")
        return original(db,case_id)
    monkeypatch.setattr(service.case_access,"get_case",deny)
    response=client.get("/api/v1/models/synthetic-unet/runs?limit=1",headers=setup["headers"])
    assert response.status_code==403 and "pagination" not in response.json()


def test_history_continuation_at_offset_bound(client,setup,limited_history,monkeypatch):
    ids=limited_history([True,True,True])
    assert service.MAX_HISTORY_OFFSET==1000000
    maximum=client.get("/api/v1/models/synthetic-unet/runs?offset=1000000",headers=setup["headers"])
    assert maximum.status_code==200 and maximum.json()["pagination"]["next_offset"] is None
    # Exercise the real SQL/page/response path with a tiny synthetic cap instead
    # of allocating a million records. Router's production bound is checked below.
    monkeypatch.setattr(service,"MAX_HISTORY_OFFSET",1)
    first=client.get("/api/v1/models/synthetic-unet/runs?limit=1",headers=setup["headers"])
    assert first.status_code==200
    assert first.json()["pagination"]["next_offset"]==1
    assert first.json()["pagination"]["offset_limit_reached"] is False
    last=client.get("/api/v1/models/synthetic-unet/runs?limit=1&offset=1",headers=setup["headers"])
    assert last.status_code==200
    assert [r["id"] for r in last.json()["evaluations"]]==[ids[1]]
    assert last.json()["pagination"]["next_offset"] is None
    assert last.json()["pagination"]["offset_limit_reached"] is True
    parameters=app.openapi()["paths"]["/api/v1/models/{model_id}/runs"]["get"]["parameters"]
    assert next(p for p in parameters if p["name"]=="offset")["schema"]["maximum"]==1000000
    assert client.get("/api/v1/models/synthetic-unet/runs?offset=1000001",headers=setup["headers"]).status_code==422


def test_history_header_corruption_fails_closed(client,setup,db):
    _,value=imported(client,setup);row=db.get(Evaluation,value["id"])
    row.threshold=.8;db.commit()
    assert client.get("/api/v1/models/synthetic-unet/runs",headers=setup["headers"]).status_code==409


def test_history_index_in_migration(db):
    indexes=inspect(db.get_bind()).get_indexes("evaluations")
    assert next(i for i in indexes if i["name"]=="ix_evaluation_model_history")["column_names"]==["model_id","created_at","id"]
