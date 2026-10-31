"""Synthetic Phase-3 fixtures, real disposable PostgreSQL; no medical inference."""
from copy import deepcopy
from datetime import timedelta
import hashlib
from types import SimpleNamespace
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi import HTTPException
import nibabel as nib
import numpy as np
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.database.session import engine
from app.main import app
from app.models import Case, SegmentationResult, StenosisAnalysisJob, StenosisAnalysisResult, StenosisLesion
from app.schemas.stenosis import AnalysisResult
from app.services import stenosis_jobs as jobs, stenosis_results as results
from app.services.source_fingerprint import source_sha256
from app.services.stenosis_geometry import geometry_fingerprint
from app.services.stenosis_runtime import ExecutionRuntime, get_runtime
from test_stenosis_jobs import source_case, postgres_only, accept, stored_result, NeverExecutedProvider


@pytest.fixture
def runtime():
    binding = ExecutionRuntime(NeverExecutedProvider(), SimpleNamespace(accepting_jobs=lambda: True), results.SQLResultStore())
    old = app.dependency_overrides.copy()
    app.dependency_overrides[get_runtime] = lambda: binding
    yield binding
    app.dependency_overrides.clear(); app.dependency_overrides.update(old)


def write_volume(path, *, affine=None, units="mm", mask=False, value=0):
    affine = np.array(affine if affine is not None else np.diag([1., 2., 3., 1.]))
    image = nib.Nifti1Image(np.full((10, 20, 30), value, dtype=np.uint8 if mask else np.int16), affine)
    image.header.set_xyzt_units(units)
    image.set_sform(affine, code=2)
    nib.save(image, path)
    return image


@pytest.fixture
def volume(db, source_case):
    write_volume(source_case.path)
    metadata = deepcopy(db.get(SegmentationResult, source_case.parent_id).metadata_json)
    metadata.update(source_sha256=source_sha256(source_case.path), affine=nib.load(source_case.path).affine.tolist())
    db.get(SegmentationResult, source_case.parent_id).metadata_json = metadata
    db.commit()
    source_case.request = source_case.request.model_copy(update={"source": source_case.request.source.model_copy(update={"source_sha256": metadata["source_sha256"]})})
    return source_case


def lesion(ijk=(2, 3, 4), affine=None):
    affine = affine or np.diag([1., 2., 3., 1.]).tolist()
    reason = {"code": "not_provided", "message": "Synthetic fixture: method did not supply this value"}
    return {"lesion_id": str(uuid4()), "location": {"coordinate_convention": "array_ijk_and_RAS_mm", "voxel_indices": list(ijk),
        "world_coordinates": (np.array(affine) @ np.array([*ijk, 1]))[:3].tolist(), "slice_axis": 2, "slice_index": ijk[2]},
        "localization_unavailable_reason": None,
        "measurements": {field: {"value": None, "unit": unit, "unavailable_reason": reason} for field, unit in
            [("reference_diameter", "mm"), ("minimum_lumen_diameter", "mm"), ("percentage_narrowing", "percent")]},
        "severity": {"category": None, "unavailable_reason": reason}, "explanation": {"artifact_id": None, "unavailable_reason": reason}}


def claimed(db, volume, runtime, *, count=2):
    job = accept(db, volume, runtime)
    token = jobs.claim_job(db, job.analysis_id, runtime)
    payload = stored_result(volume, job)
    payload["provenance"]["geometry"]["affine"] = nib.load(volume.path).affine.tolist()
    payload["lesions"] = [lesion((i+1, i+2, i+3), payload["provenance"]["geometry"]["affine"]) for i in range(count)]
    return job, token, payload


def endpoint(volume, job):
    return f"/api/v1/cases/{volume.case_id}/stenosis/analyses/{job.analysis_id}"


def assert_no_result(db, job):
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisResult)) == 0
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisLesion)) == 0
    row = db.get(StenosisAnalysisJob, str(job.analysis_id), populate_existing=True)
    assert row.status != "completed" and row.result_reference is None


@pytest.mark.parametrize("count", [0, 2])
def test_atomic_completed_result_and_typed_authorized_reads(client, db, volume, runtime, count):
    job, token, payload = claimed(db, volume, runtime, count=count)
    result_id = results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    row = db.get(StenosisAnalysisJob, str(job.analysis_id))
    assert row.status == "completed" and row.result_reference == result_id
    response = client.get(endpoint(volume, job) + "/result", headers=volume.headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["result"]["lesions"]) == count and data["result"]["state"] == "completed"
    assert response.headers["cache-control"] == "no-store"
    assert data["visualization"]["status"] == "supported"
    assert str(volume.path) not in response.text and "claim_token" not in response.text
    if count:
        first = payload["lesions"][0]
        detail = client.get(endpoint(volume, job) + "/lesions/" + first["lesion_id"], headers=volume.headers)
        assert detail.status_code == 200 and detail.json()["lesion"]["location"] == first["location"]
        assert detail.json()["lesion"]["measurements"]["reference_diameter"]["value"] is None
    assert client.get(endpoint(volume, job) + "/result").status_code == 401
    assert client.post(endpoint(volume, job) + "/result", headers=volume.headers, json=payload).status_code == 405
    assert client.get(endpoint(volume, job) + f"/lesions/{uuid4()}", headers=volume.headers).status_code == 404
    assert client.get(endpoint(volume, job).replace(f"cases/{volume.case_id}", f"cases/{volume.case_id+100}") + "/result", headers=volume.headers).status_code == 404


@pytest.mark.parametrize("role,status", [("Admin", 200), ("Clinician", 200), ("Researcher", 200), ("DataScientist", 200)])
def test_existing_case_reader_policy(client, db, account, volume, runtime, role, status):
    job, token, payload = claimed(db, volume, runtime)
    results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    user, headers = account(role)
    assert client.get(endpoint(volume, job) + "/result", headers=headers).status_code == status
    user.is_active = False; db.commit()
    assert client.get(endpoint(volume, job) + "/result", headers=headers).status_code == 401


@pytest.mark.parametrize("state", ["queued", "running", "failed"])
def test_incomplete_results_are_not_empty_success(client, db, volume, runtime, state):
    job = accept(db, volume, runtime)
    if state == "running": jobs.claim_job(db, job.analysis_id, runtime)
    if state == "failed": jobs.fail_job(db, job.analysis_id, "dispatch_failed")
    response = client.get(endpoint(volume, job) + "/result", headers=volume.headers)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "analysis_not_completed"
    assert "lesions" not in response.json()


def test_missing_completed_store_is_integrity_error(client, db, volume, runtime):
    job, token, payload = claimed(db, volume, runtime)
    row = db.get(StenosisAnalysisJob, str(job.analysis_id))
    row.status, row.result_reference, row.completed_at = "completed", str(uuid4()), jobs.now()
    row.claim_token_hash, row.lease_expires_at = None, None
    db.commit()
    response = client.get(endpoint(volume, job) + "/result", headers=volume.headers)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "result_integrity_failure"


@pytest.mark.parametrize("failure", ["wrong_case", "wrong_parent", "wrong_hash", "wrong_method", "outside", "world", "singular", "nan", "duplicates", "too_many"])
def test_invalid_payload_never_persists(db, volume, runtime, failure):
    job, token, payload = claimed(db, volume, runtime)
    if failure == "wrong_case": payload["provenance"]["source"]["case_id"] += 100
    if failure == "wrong_parent": payload["provenance"]["source"]["parent_segmentation_result_id"] = str(uuid4())
    if failure == "wrong_hash": payload["provenance"]["source"]["source_sha256"] = "f"*64
    if failure == "wrong_method": payload["provenance"]["method_version"] = "other"
    if failure == "outside": payload["lesions"][0]["location"]["voxel_indices"][0] = 10
    if failure == "world": payload["lesions"][0]["location"]["world_coordinates"][0] += 1
    if failure == "singular": payload["provenance"]["geometry"]["affine"][0][0] = 0
    if failure == "nan": payload["lesions"][0]["location"]["world_coordinates"][0] = float("nan")
    if failure == "duplicates": payload["lesions"][1]["lesion_id"] = payload["lesions"][0]["lesion_id"]
    if failure == "too_many": payload["lesions"] = [lesion() for _ in range(201)]
    with pytest.raises(HTTPException): results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    assert_no_result(db, job)


@pytest.mark.parametrize("failure", ["commit", "flush", "source_after_insert", "expiry_after_insert"])
def test_late_failure_rolls_back_rows_and_completion(db, volume, runtime, monkeypatch, failure):
    job, token, payload = claimed(db, volume, runtime)
    if failure == "commit": monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("synthetic commit failure")))
    if failure == "flush":
        original = db.flush
        def flush(*args, **kwargs):
            if any(isinstance(item, StenosisLesion) for item in db.new): raise RuntimeError("synthetic lesion flush failure")
            return original(*args, **kwargs)
        monkeypatch.setattr(db, "flush", flush)
    if failure in {"source_after_insert", "expiry_after_insert"}:
        original = jobs.complete_job
        def complete(*args, **kwargs):
            if failure == "source_after_insert": volume.path.write_bytes(b"synthetic source replacement")
            else:
                future = jobs.now() + timedelta(hours=1)
                monkeypatch.setattr(jobs, "now", lambda: future)
            return original(*args, **kwargs)
        monkeypatch.setattr(jobs, "complete_job", complete)
    with pytest.raises(HTTPException): results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    assert_no_result(db, job)


def test_wrong_worker_token_rejected(db, volume, runtime):
    job, token, payload = claimed(db, volume, runtime)
    with pytest.raises(HTTPException): results.persist_completed_result(db, job.analysis_id, "wrong-token", payload, runtime)
    assert_no_result(db, job)


def test_stale_result_hidden_after_same_path_replacement(client, db, volume, runtime):
    job, token, payload = claimed(db, volume, runtime)
    results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    write_volume(volume.path, value=25)
    response = client.get(endpoint(volume, job) + "/result", headers=volume.headers)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "source_changed"


@pytest.mark.parametrize("affine,supported", [
    ([[-1,0,0,9],[0,2,0,-5],[0,0,3,2],[0,0,0,1]], True),
    ([[0,-2,0,10],[-1,0,0,12],[0,0,3,2],[0,0,0,1]], True),
    ([[1,.1,0,0],[0,2,0,0],[0,0,3,0],[0,0,0,1]], False)])
def test_flipped_permuted_and_unsupported_geometry(db, volume, runtime, affine, supported):
    write_volume(volume.path, affine=affine)
    parent = db.get(SegmentationResult, volume.parent_id)
    parent.metadata_json = {**parent.metadata_json, "affine": nib.load(volume.path).affine.tolist(), "source_sha256": source_sha256(volume.path)}
    db.commit()
    volume.request = volume.request.model_copy(update={"source": volume.request.source.model_copy(update={"source_sha256": parent.metadata_json["source_sha256"]})})
    job, token, payload = claimed(db, volume, runtime)
    results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    response = results.retrieve_result(db, volume.case_id, job.analysis_id)
    assert (response.visualization.status == "supported") == supported


def test_unknown_source_units_rejected(db, volume, runtime):
    write_volume(volume.path, units="unknown")
    parent = db.get(SegmentationResult, volume.parent_id)
    parent.metadata_json = {**parent.metadata_json, "source_sha256": source_sha256(volume.path), "xyzt_units": 0}
    db.commit()
    volume.request = volume.request.model_copy(update={"source": volume.request.source.model_copy(update={"source_sha256": parent.metadata_json["source_sha256"]})})
    job, token, payload = claimed(db, volume, runtime)
    with pytest.raises(HTTPException): results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    assert_no_result(db, job)


def test_immutable_database_guards(db, volume, runtime):
    job, token, payload = claimed(db, volume, runtime)
    result_id = results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    for statement in [sa.update(StenosisAnalysisResult).where(StenosisAnalysisResult.id == result_id).values(finding_count=0),
        sa.delete(StenosisAnalysisResult).where(StenosisAnalysisResult.id == result_id),
        sa.delete(StenosisLesion).where(StenosisLesion.result_id == result_id),
        sa.insert(StenosisLesion).values(result_id=result_id, lesion_id=str(uuid4()), payload_json=lesion())]:
        with pytest.raises(IntegrityError): db.execute(statement); db.commit()
        db.rollback()
    assert len(results.SQLResultStore().load(db, result_id).lesions) == 2


@pytest.mark.parametrize("invalid", [None, "hash", "geometry", "nonbinary"])
def test_supplied_region_protected_download_and_integrity(client, db, volume, runtime, tmp_path, invalid):
    job, token, payload = claimed(db, volume, runtime)
    path = tmp_path / "synthetic-region.nii.gz"
    write_volume(path, mask=True, value=2 if invalid == "nonbinary" else 1,
        affine=np.diag([2., 2., 3., 1.]) if invalid == "geometry" else None)
    geometry = AnalysisResult.model_validate(payload).provenance.geometry
    region = {"artifact_id": str(uuid4()), "format": "nii.gz", "sha256": "a"*64 if invalid == "hash" else hashlib.sha256(path.read_bytes()).hexdigest(),
        "source_sha256": volume.request.source.source_sha256, "geometry": geometry.model_dump(mode="json"),
        "geometry_fingerprint": geometry_fingerprint(geometry, volume.request.source.source_sha256)}
    payload["lesions"][0]["candidate_region"] = region
    if invalid:
        with pytest.raises(HTTPException): results.persist_completed_result(db, job.analysis_id, token, payload, runtime, {region["artifact_id"]: path})
        assert_no_result(db, job)
        return
    result_id = results.persist_completed_result(db, job.analysis_id, token, payload, runtime, {region["artifact_id"]: path})
    url = endpoint(volume, job) + f'/lesions/{payload["lesions"][0]["lesion_id"]}/regions/{region["artifact_id"]}'
    assert client.get(url).status_code == 401
    response = client.get(url, headers=volume.headers)
    assert response.status_code == 200 and response.content == path.read_bytes()
    assert response.headers["cache-control"] == "no-store" and response.headers["x-content-type-options"] == "nosniff"
    assert "candidate_region.nii.gz" in response.headers["content-disposition"]
    assert client.get(url.rsplit("/", 1)[0] + "/" + str(uuid4()), headers=volume.headers).status_code == 404
    reference = AnalysisResult.model_validate(payload).lesions[0].candidate_region
    results.artifact_path(result_id, reference).write_bytes(b"replacement")
    assert client.get(url, headers=volume.headers).status_code == 409


def test_migration_roundtrip_preserves_existing_entities(db, volume, runtime):
    job, token, payload = claimed(db, volume, runtime)
    results.persist_completed_result(db, job.analysis_id, token, payload, runtime)
    db.rollback()
    config = Config("alembic.ini")
    command.downgrade(config, "0006_stenosis_jobs")
    assert "stenosis_analysis_results" not in sa.inspect(engine).get_table_names()
    db.expire_all()
    assert db.get(Case, volume.case_id) and db.get(SegmentationResult, volume.parent_id)
    assert db.get(StenosisAnalysisJob, str(job.analysis_id)).status == "completed"
    db.rollback()
    command.upgrade(config, "head")
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisResult)) == 0
    with pytest.raises(HTTPException) as failure: results.retrieve_result(db, volume.case_id, job.analysis_id)
    assert failure.value.detail["code"] == "result_integrity_failure"


def test_normal_runtime_stays_unregistered():
    assert get_runtime() is None
