"""Cross-phase checks on disposable PostgreSQL; never execute a medical model."""
from copy import deepcopy
from datetime import date
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.database.session import Base, engine
from app.main import app
from app.models import (Case, Patient, User, SegmentationResult, StenosisAnalysisJob as Job,
                        StenosisAnalysisResult as Result, StenosisLesion as Lesion,
                        StenosisExplanationArtifact as Explanation)
from app.routers.segmentation import UPLOAD_DIR, VOLUME_DIR, result_directory
from app.schemas.stenosis import AnalysisResult
from app.services import stenosis_jobs as jobs, stenosis_results as results
from app.services.source_fingerprint import source_sha256, _observed, _cache_lock
from app.services.stenosis_geometry import geometry_fingerprint
from app.services.stenosis_runtime import ExecutionRuntime, get_runtime
from test_stenosis_results import (source_case, postgres_only, volume, runtime, claimed,
                                   write_volume, endpoint)
from test_stenosis_explanations import supplied, binding


@pytest.mark.parametrize("end", ["0001-01-01", "9999-12-31"])
def test_analytics_calendar_boundaries_do_not_become_server_errors(client, volume, end):
    response = client.get("/api/v1/stenosis/analytics/summary", headers=volume.headers,
                          params={"end_date": end})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["jobs"]["total"] == 0
    assert date.fromisoformat(data["filters"]["start_date"]) <= date.fromisoformat(end)


def test_history_maximum_calendar_date_does_not_overflow(client, volume):
    response = client.get(f"/api/v1/cases/{volume.case_id}/stenosis/analyses",
                          headers=volume.headers, params={"end_date": "9999-12-31"})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 0


@pytest.mark.parametrize("field",["method_id","method_version"])
def test_unavailable_measurement_optional_metadata_is_valid_public_contract(client,db,volume,runtime,field):
    job,token,payload=claimed(db,volume,runtime,count=1)
    payload["lesions"][0]["measurements"]["reference_diameter"][field]="supplied-optional"
    results.persist_completed_result(db,job.analysis_id,token,payload,runtime)
    response=client.get(endpoint(volume,job)+"/report",headers=volume.headers)
    assert response.status_code==200,response.text
    measurement=response.json()["result"]["result"]["lesions"][0]["measurements"]["reference_diameter"]
    assert measurement[field]=="supplied-optional" and measurement["value"] is None and measurement["unavailable_reason"]


def completed_fixture(db, volume, runtime, folder, *, count=2, artifacts=False):
    """Reuse trusted test writers; no provider execute/generate method is called."""
    job, token, payload = claimed(db, volume, runtime, count=count)
    payload["provenance"]["method_version"] = runtime.provider.method_version
    regions, maps = {}, []
    if artifacts:
        path = folder / "synthetic-region.nii.gz"
        write_volume(path, mask=True, value=1)
        geometry = AnalysisResult.model_validate(payload).provenance.geometry
        region = {"artifact_id": str(uuid4()), "format": "nii.gz", "sha256": sha256(path.read_bytes()).hexdigest(),
                  "source_sha256": volume.request.source.source_sha256, "geometry": geometry.model_dump(mode="json"),
                  "geometry_fingerprint": geometry_fingerprint(geometry, volume.request.source.source_sha256)}
        payload["lesions"][0]["candidate_region"] = region
        regions[region["artifact_id"]] = path
        maps = [supplied(folder, payload), supplied(folder, payload, signed=True,
                scope="lesion", lesion=payload["lesions"][0]["lesion_id"])]
    result_id = results.persist_completed_result(db, job.analysis_id, token, payload,
                     binding(runtime, *maps) if maps else runtime, regions, explanations=maps)
    return SimpleNamespace(job=job, result_id=result_id, payload=payload, maps=maps)


def clone_volume(db, original, *, patient_id=None):
    case = db.get(Case, original.case_id)
    path = VOLUME_DIR / (uuid4().hex + ".nii")
    path.write_bytes(original.path.read_bytes())
    clone = Case(patient_id=patient_id or case.patient_id, case_code="SYN-"+uuid4().hex[:12],
                 volume_path=path.relative_to(UPLOAD_DIR).as_posix(), modality="CTA", status="complete")
    db.add(clone); db.flush()
    parent = SegmentationResult(id=str(uuid4()), case_id=clone.id, source_volume_path=clone.volume_path,
        metadata_json=deepcopy(db.get(SegmentationResult, original.parent_id).metadata_json), created_by=original.user_id)
    db.add(parent); db.commit()
    request = original.request.model_copy(update={"source": original.request.source.model_copy(update={
        "case_id": clone.id, "parent_segmentation_result_id": UUID(parent.id)})})
    return SimpleNamespace(case_id=clone.id, parent_id=parent.id, path=path, request=request,
                           user_id=original.user_id, headers=original.headers)


def test_cross_phase_totals_reports_and_histories_agree(client, db, volume, runtime, tmp_path):
    multi = completed_fixture(db, volume, runtime, tmp_path, artifacts=True)
    completed_fixture(db, volume, runtime, tmp_path, count=0)
    second = clone_volume(db, volume)
    other = ExecutionRuntime(SimpleNamespace(method_id=runtime.provider.method_id, method_version="v2", checkpoint_sha256=None,
        execute=runtime.provider.execute), runtime.dispatcher, runtime.results)
    completed_fixture(db, second, other, tmp_path, count=1)
    patient = Patient(patient_code="P-"+uuid4().hex[:12], display_name="Synthetic excluded-source fixture")
    db.add(patient); db.commit()
    stale, cold, missing = [clone_volume(db, volume, patient_id=patient.id) for _ in range(3)]
    completed_fixture(db, stale, runtime, tmp_path, count=1)
    completed_fixture(db, cold, runtime, tmp_path, count=1)
    stale.path.write_bytes(b"synthetic replaced source")
    with _cache_lock: _observed.pop(str(cold.path.resolve()), None)
    bad, _, _ = claimed(db, missing, runtime)
    db.execute(sa.update(Job).where(Job.id==str(bad.analysis_id)).values(status="completed", result_reference=str(uuid4()),
        completed_at=jobs.now(), claim_token_hash=None, lease_expires_at=None)); db.commit()
    for state in ("queued", "running", "failed"):
        job = jobs.accepted_job(db, volume.case_id, volume.request, volume.user_id, str(uuid4()), runtime)[0]
        if state=="running": jobs.claim_job(db, job.analysis_id, runtime)
        if state=="failed": jobs.fail_job(db, job.analysis_id, "dispatch_failed")
    # Record bounded-query observations, not a production load benchmark.
    import json
    import os
    import time
    statements=[]
    def observe(_connection,_cursor,statement,*_args): statements.append(statement)
    sa.event.listen(engine,"before_cursor_execute",observe)
    started=time.perf_counter()
    try: response = client.get("/api/v1/stenosis/analytics/summary", headers=volume.headers)
    finally: sa.event.remove(engine,"before_cursor_execute",observe)
    elapsed=(time.perf_counter()-started)*1000
    if os.environ.get("VASCUAI_ACCEPTANCE_OUTPUT"):
        destination=Path(os.environ["VASCUAI_ACCEPTANCE_OUTPUT"]);destination.mkdir(parents=True,exist_ok=True)
        (destination/"synthetic-summary-observation.json").write_text(json.dumps({"jobs":9,"completed_jobs":6,
            "source_shape":[10,20,30],"statement_count":len(statements),"select_count":sum(s.lstrip().upper().startswith("SELECT") for s in statements),
            "elapsed_ms":elapsed,"scope":"Single TestClient request on disposable PostgreSQL; not production throughput"},indent=2),encoding="utf-8")
    assert response.status_code==200, response.text
    summary = response.json()
    assert summary["jobs"]==dict(total=9, queued=1, running=1, failed=1, completed=6)
    assert {k:summary["quality"][k] for k in ("stale","unverified","integrity_errors")}==dict(stale=1,unverified=1,integrity_errors=1)
    expected = dict(analyses=3,unique_cases=2,unique_patients=1,lesions=3,analyses_with_lesions=2,
                    cases_with_lesions=2,zero_finding_analyses=1,explanation_artifacts=2,analyses_with_explanations=1)
    assert {k:summary["current"][k] for k in expected}==expected
    assert summary["severity_distribution"] is None and summary["measurement_summary_status"]=="unavailable"
    history = client.get(f"/api/v1/cases/{volume.case_id}/stenosis/analyses",headers=volume.headers).json()
    assert history["total"]==5 and sum(item["status"]=="completed" for item in history["items"])==2
    filtered = client.get("/api/v1/stenosis/analytics/summary",headers=volume.headers,
        params={"method_id":other.provider.method_id,"method_version":"v2"}).json()
    assert filtered["jobs"]["total"]==filtered["current"]["lesions"]==1
    report = client.get(endpoint(volume,multi.job)+"/report",headers=volume.headers).json()
    assert report["result"]["result_id"]==multi.result_id and len(report["result"]["result"]["lesions"])==2
    assert len(report["explanations"]["items"])==2
    for suffix in ("/result","/report","/report.csv","/explanations"):
        assert client.get(endpoint(volume,multi.job)+suffix).status_code==401
        assert client.get(endpoint(volume,multi.job).replace(f"cases/{volume.case_id}",f"cases/{second.case_id}")+suffix,
                          headers=volume.headers).status_code==404


def test_populated_migration_chain_and_rollback_preservation(db, volume, runtime, tmp_path):
    config = Config("alembic.ini")
    chain = [r.revision for r in reversed(list(ScriptDirectory.from_config(config).walk_revisions()))]
    assert chain == ["0001_main","0002_auth","0003_case_meta","0004_volume_ingestion","0005_segmentation_results",
                     "0006_stenosis_jobs","0007_stenosis_results","0008_stenosis_explanations","0009_evaluations"]
    item = completed_fixture(db,volume,runtime,tmp_path,artifacts=True)
    # Snapshot all pre-stenosis domain rows; compare exact values after rollback.
    protected = [User.__table__,Patient.__table__,Case.__table__,SegmentationResult.__table__]
    def rows():
        with engine.connect() as connection:
            return {t.name:[tuple(r) for r in connection.execute(sa.select(t).order_by(*t.primary_key))] for t in protected}
    before = rows(); original = sha256(volume.path.read_bytes()).hexdigest()
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection),Base.metadata)==[]
    for table in (Result,Lesion,Explanation):
        for action in (sa.delete(table),sa.update(table).values(**({"finding_count":0} if table is Result else {"payload_json":{}} if table is Lesion else {"metadata_json":{}}))):
            with pytest.raises(IntegrityError): db.execute(action); db.commit()
            db.rollback()
    db.rollback()
    command.downgrade(config,"0007_stenosis_results")
    assert "stenosis_explanation_artifacts" not in sa.inspect(engine).get_table_names()
    assert rows()==before
    with engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(Result))==1
        assert connection.scalar(sa.select(sa.func.count()).select_from(Lesion))==2
    command.upgrade(config,"head")
    command.downgrade(config,"0005_segmentation_results")
    assert not any(name.startswith("stenosis_") for name in sa.inspect(engine).get_table_names())
    assert rows()==before and sha256(volume.path.read_bytes()).hexdigest()==original
    command.upgrade(config,"head")
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection),Base.metadata)==[]
        for table in (Job,Result,Lesion,Explanation): assert connection.scalar(sa.select(sa.func.count()).select_from(table))==0
    assert get_runtime() is None


@pytest.mark.parametrize("identity", ["anonymous","revoked","inactive","Admin","Clinician","Researcher","DataScientist"])
def test_cross_phase_authorization_matrix(client,db,account,volume,runtime,tmp_path,identity):
    item=completed_fixture(db,volume,runtime,tmp_path,artifacts=True)
    base=endpoint(volume,item.job)
    region=item.payload["lesions"][0]["candidate_region"]
    routes=["/api/v1/stenosis/capabilities",base.rsplit("/",1)[0],base,base+"/result",
            base+"/lesions/"+item.payload["lesions"][0]["lesion_id"],
            base+"/lesions/"+item.payload["lesions"][0]["lesion_id"]+"/regions/"+region["artifact_id"],
            base+"/explanations",base+"/explanations/"+item.maps[0].metadata["explanation_id"]+"/artifact",
            "/api/v1/stenosis/analytics/summary","/api/v1/stenosis/analytics/trends","/api/v1/stenosis/analytics/analyses",
            f"/api/v1/cases/{volume.case_id}/stenosis/analytics",base+"/report",base+"/report.csv"]
    headers={}
    if identity in {"revoked","inactive"}:
        user=db.get(User,volume.user_id)
        if identity=="revoked": user.token_version+=1
        else: user.is_active=False
        db.commit();headers=volume.headers
    elif identity!="anonymous": _,headers=account(identity)
    for route in routes:
        response=client.get(route,headers=headers)
        assert response.status_code==(401 if identity in {"anonymous","revoked","inactive"} else 200),route
        if response.status_code==200:
            assert str(UPLOAD_DIR).encode() not in response.content and b"claim_token" not in response.content
    patient_id=db.get(Case,volume.case_id).patient_id
    for route in [f"/api/v1/patients/{patient_id}/stenosis/analytics",
                  f"/api/v1/stenosis/analytics/summary?patient_id={patient_id}"]:
        response=client.get(route,headers=headers)
        assert response.status_code==(401 if identity in {"anonymous","revoked","inactive"} else 200 if identity in {"Admin","Clinician"} else 403)


def test_live_react_fastapi_postgres_workflow(client, db, volume, runtime, tmp_path):
    """Opt-in browser integration, using real loopback HTTP and the normal app.

    Explicit opt-in prevents a routine backend run from assuming an installed
    browser/Node runtime. The Phase-6 run enables and executes it, not a mock.
    """
    import json
    import os
    import shutil
    import socket
    import subprocess
    import threading
    import time
    import uvicorn
    if os.environ.get("VASCUAI_LIVE_ACCEPTANCE") != "1":
        pytest.skip("Opt-in: VASCUAI_LIVE_ACCEPTANCE=1 plus installed Node/Chrome")
    assert engine.dialect.name=="postgresql" and os.environ.get("TEST_DATABASE_URL")
    root = Path(__file__).resolve().parents[2]
    output = Path(os.environ.get("VASCUAI_ACCEPTANCE_OUTPUT", tmp_path))
    output.mkdir(parents=True,exist_ok=True)
    # Exercise actual NIfTI ingestion before attaching a clearly synthetic saved
    # segmentation fixture. No segmentation endpoint/provider is executed.
    upload = client.post(f"/api/v1/cases/{volume.case_id}/volume",headers=volume.headers,
                          files={"file":("synthetic-ct.nii",volume.path.read_bytes(),"application/octet-stream")})
    assert upload.status_code==200, upload.text
    db.expire_all()
    volume.path=UPLOAD_DIR/upload.json()["volume_path"]
    parent=db.get(SegmentationResult,volume.parent_id)
    parent.source_volume_path=upload.json()["volume_path"]
    parent.metadata_json={**parent.metadata_json,"source_sha256":source_sha256(volume.path)}
    db.commit()
    directory=result_directory(volume.parent_id);directory.mkdir(parents=True)
    write_volume(directory/"prediction_mask.nii.gz",mask=True,value=1)
    multi=completed_fixture(db,volume,runtime,tmp_path,artifacts=True)
    zero=completed_fixture(db,volume,runtime,tmp_path,count=0)
    user=db.get(User,volume.user_id)
    manifest={"synthetic_only":True,"case_id":volume.case_id,"analysis_id":str(multi.job.analysis_id),
              "zero_analysis_id":str(zero.job.analysis_id),"result_id":multi.result_id,"source":volume.request.source.model_dump(mode="json"),
              "lesion_ids":[p["lesion_id"] for p in multi.payload["lesions"]],
              "explanation_ids":[p.metadata["explanation_id"] for p in multi.maps],"email":user.email}
    fixture=output/"live-fixture.json";fixture.write_text(json.dumps(manifest),encoding="utf-8")
    # The server uses the unmodified runtime composition. Test bindings were used
    # solely as explicit arguments to trusted setup writers above.
    app.dependency_overrides.pop(get_runtime,None)
    assert not app.dependency_overrides and get_runtime() is None
    listener=socket.socket();listener.bind(("127.0.0.1",0));listener.listen()
    api_port=listener.getsockname()[1]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1",0));web_port=probe.getsockname()[1]
    api=f"http://127.0.0.1:{api_port}"
    vite=output/"vite-live.config.mjs"
    vite.write_text("import existing from "+json.dumps((root/"frontend-react/vite.config.js").as_uri())+";\nexport default {...existing,root:"
        +json.dumps((root/"frontend-react").as_posix())+",server:{host:'127.0.0.1',port:"+str(web_port)
        +",strictPort:true,proxy:{'/api':{target:"+json.dumps(api)+",changeOrigin:true},'/health':{target:"+json.dumps(api)+",changeOrigin:true}}}};\n",encoding="utf-8")
    config={"testDir":str(root/"frontend-react/tests/e2e"),"testMatch":"stenosis-live.spec.js","workers":1,"timeout":90000,
        "expect":{"timeout":15000},"outputDir":str(output/"live-browser-results"),"reporter":[["list"]],
        "use":{"baseURL":f"http://127.0.0.1:{web_port}","viewport":{"width":1440,"height":1000},
               "reducedMotion":"reduce","launchOptions":{"args":["--enable-unsafe-swiftshader"]}},
        "webServer":{"command":"node "+json.dumps((root/"frontend-react/node_modules/vite/bin/vite.js").as_posix())+" --config "+json.dumps(vite.as_posix()),
                     "cwd":str(output),"url":f"http://127.0.0.1:{web_port}","reuseExistingServer":False,"timeout":60000}}
    chrome=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
    if chrome: config["use"]["launchOptions"]["executablePath"]=chrome
    config_path=output/"playwright-live.config.cjs"
    config_path.write_text("module.exports = "+json.dumps(config)+";\n",encoding="utf-8")
    server=uvicorn.Server(uvicorn.Config(app,host="127.0.0.1",port=api_port,log_level="error",access_log=False))
    thread=threading.Thread(target=server.run,kwargs={"sockets":[listener]},daemon=True)
    try:
        thread.start();deadline=time.monotonic()+15
        while not server.started and thread.is_alive() and time.monotonic()<deadline: time.sleep(.05)
        assert server.started,"Isolated API failed to start"
        env={**os.environ,"VASCUAI_LIVE_FIXTURE":str(fixture),"VITE_API_URL":"/api/v1","VITE_HEALTH_URL":"/health"}
        with (output/"live-browser.log").open("w",encoding="utf-8") as log:
            run=subprocess.run([shutil.which("node") or "node",str(root/"frontend-react/node_modules/@playwright/test/cli.js"),
                                "test","--config",str(config_path)],cwd=output,env=env,stdout=log,stderr=log,timeout=240)
        assert run.returncode==0,(output/"live-browser.log").read_text(encoding="utf-8")
        assert get_runtime() is None and not app.dependency_overrides
        assert db.scalar(sa.select(sa.func.count()).select_from(Job))==2
    finally:
        server.should_exit=True
        thread.join(timeout=15);listener.close()
        assert not thread.is_alive(),"Isolated API thread did not stop"
