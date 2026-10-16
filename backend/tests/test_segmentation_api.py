import gzip
import os
import builtins

import nibabel as nib
import numpy as np
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import SessionLocal
from app.models import Case, SegmentationResult
from app.routers import segmentation
from app.services import source_fingerprint


def volume(shape=(5, 7, 9)):
    return gzip.compress(nib.Nifti1Image(np.zeros(shape, dtype=np.int16), np.eye(4)).to_bytes())


def seed(client, account):
    _, headers = account("Clinician")
    patient = client.post("/api/v1/patients", headers=headers,
                          json={"patient_code": "SEG-001", "display_name": "Synthetic"}).json()
    case = client.post("/api/v1/cases", headers=headers,
                       json={"patient_id": patient["id"], "case_code": "SEG-001", "modality": "CTA"}).json()
    assert client.post(f"/api/v1/cases/{case['id']}/volume", headers=headers,
                       files={"file": ("synthetic.nii.gz", volume())}).status_code == 200
    return case["id"], headers


@pytest.fixture
def fake_runtime(monkeypatch):
    monkeypatch.setattr(settings, "VASCULAI_MODEL_CHECKPOINT", "test-fixture-only")
    def execute(source, destination, threshold):
        destination.mkdir(parents=True)
        for name in ("prediction_mask.nii.gz", "probabilities.nii.gz"):
            (destination / name).write_bytes(volume())
        (destination / "metadata.json").write_text("{}")
        return {"experimental": True, "clinical_validation": False, "threshold": threshold,
                "source_sha256": source_fingerprint.source_sha256(source)}
    monkeypatch.setattr(segmentation, "execute_inference", execute)
    return execute


@pytest.mark.parametrize("role,expected", [("Clinician", 201), ("Admin", 201), ("Researcher", 403), ("DataScientist", 403)])
def test_run_authorization_and_results(client, account, fake_runtime, role, expected):
    case_id, _ = seed(client, account)
    _, headers = account(role)
    url = f"/api/v1/cases/{case_id}/segmentations"
    assert client.post(url, json={}).status_code == 401
    response = client.post(url, headers=headers, json={"threshold": .6})
    assert response.status_code == expected, response.text
    if expected == 201:
        result = response.json()
        assert not result["stale"] and result["metadata"]["threshold"] == .6
        assert "source_volume_path" not in result
        download = client.get(result["mask_url"], headers=headers)
        assert download.status_code == 200 and download.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("role", ["Clinician", "Admin", "Researcher", "DataScientist"])
def test_all_case_readers_can_read_outputs(client, account, fake_runtime, role):
    case_id, writer = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=writer, json={}).json()
    _, reader = account(role)
    listed = client.get(f"/api/v1/cases/{case_id}/segmentations", headers=reader)
    assert listed.status_code == 200 and len(listed.json()) == 1
    assert client.get(result["probabilities_url"], headers=reader).status_code == 200
    assert client.get(result["mask_url"]).status_code == 401


def test_replaced_volume_marks_results_stale(client, account, fake_runtime):
    case_id, headers = seed(client, account)
    url = f"/api/v1/cases/{case_id}/segmentations"
    result = client.post(url, headers=headers, json={}).json()
    assert client.post(f"/api/v1/cases/{case_id}/volume", headers=headers,
                       files={"file": ("replacement.nii.gz", volume())}).status_code == 200
    assert client.get(url, headers=headers).json()[0]["stale"]
    assert client.get(result["mask_url"], headers=headers).status_code == 409
    assert client.get(f"/api/v1/cases/{case_id + 1}/segmentations/{result['id']}/mask", headers=headers).status_code == 404


def test_prerequisites_and_invalid_threshold(client, account, monkeypatch, db):
    case_id, headers = seed(client, account)
    url = f"/api/v1/cases/{case_id}/segmentations"
    monkeypatch.setattr(settings, "VASCULAI_MODEL_CHECKPOINT", None)
    assert client.post(url, headers=headers, json={}).status_code == 503
    assert client.post(url, headers=headers, json={"threshold": 1.2}).status_code == 422
    assert client.post(url, headers=headers, json={"checkpoint": "arbitrary.pt"}).status_code == 422
    assert client.post("/api/v1/cases/999999/segmentations", headers=headers, json={}).status_code == 404
    case = db.get(Case, case_id)
    case.modality = "MRA"
    db.commit()
    assert client.post(url, headers=headers, json={}).status_code == 409
    case.volume_path = None
    db.commit()
    assert client.post(url, headers=headers, json={}).status_code == 409


def test_path_boundaries(client, account, fake_runtime, db):
    case_id, headers = seed(client, account)
    case = db.get(Case, case_id)
    case.volume_path = "../private.nii.gz"
    db.commit()
    assert client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).status_code == 400


@pytest.mark.parametrize("failure", ["runtime", "commit", "replacement"])
def test_failed_runs_clean_outputs_and_do_not_persist(client, account, fake_runtime, monkeypatch, db, failure):
    case_id, headers = seed(client, account)
    created = []
    def execute(source, destination, threshold):
        metadata = fake_runtime(source, destination, threshold)
        created.append(destination)
        if failure == "runtime":
            raise HTTPException(500, "Inference failed")
        if failure == "replacement":
            with SessionLocal() as other:
                other.get(Case, case_id).volume_path = "volumes/replacement.nii.gz"
                other.commit()
        return metadata
    monkeypatch.setattr(segmentation, "execute_inference", execute)
    if failure == "commit":
        def fail_commit(self):
            raise RuntimeError("test persistence failure")
        monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={})
    assert response.status_code == (409 if failure == "replacement" else 500), response.text
    assert created and all(not path.exists() for path in created)
    assert db.scalars(select(SegmentationResult)).all() == []
    assert segmentation.inference_slot.acquire(blocking=False)
    segmentation.inference_slot.release()


def test_busy_worker_returns_retry_after(client, account, fake_runtime):
    case_id, headers = seed(client, account)
    assert segmentation.inference_slot.acquire(blocking=False)
    try:
        response = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={})
        assert response.status_code == 503 and response.headers["retry-after"] == "30"
    finally:
        segmentation.inference_slot.release()


def test_missing_runtime_is_a_useful_service_error(client, account, monkeypatch):
    case_id, headers = seed(client, account)
    monkeypatch.setattr(settings, "VASCULAI_MODEL_CHECKPOINT", "configured-but-runtime-missing")
    real_import = builtins.__import__
    def import_without_torch(name, *args, **kwargs):
        if name == "torch":
            raise ImportError("test missing optional runtime")
        return real_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", import_without_torch)
    response = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={})
    assert response.status_code == 503 and "requirements-model.txt" in response.json()["detail"]


def test_missing_checkpoint_and_4d_input_through_api(client, account, monkeypatch):
    pytest.importorskip("torch")
    case_id, headers = seed(client, account)
    url = f"/api/v1/cases/{case_id}/segmentations"
    monkeypatch.setattr(settings, "VASCULAI_MODEL_CHECKPOINT", "missing-checkpoint.pt")
    response = client.post(url, headers=headers, json={})
    assert response.status_code == 503 and "missing" in response.json()["detail"]
    checkpoint = os.environ.get("VASCULAI_TEST_CHECKPOINT")
    if checkpoint:
        monkeypatch.setattr(settings, "VASCULAI_MODEL_CHECKPOINT", checkpoint)
        upload = client.post(f"/api/v1/cases/{case_id}/volume", headers=headers,
                             files={"file": ("synthetic4d.nii.gz", volume((5, 7, 9, 2)))})
        assert upload.status_code == 200  # Existing ingestion still accepts 4D.
        response = client.post(url, headers=headers, json={})
        assert response.status_code == 400 and "three-dimensional" in response.json()["detail"]


def test_original_checkpoint_through_upload_api(client, account, monkeypatch):
    pytest.importorskip("torch")
    checkpoint = os.environ.get("VASCULAI_TEST_CHECKPOINT")
    if not checkpoint:
        pytest.skip("Set VASCULAI_TEST_CHECKPOINT for real checkpoint API verification")
    monkeypatch.setattr(settings, "VASCULAI_MODEL_CHECKPOINT", checkpoint)
    case_id, headers = seed(client, account)
    response = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={})
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["metadata"]["parameter_count"] == 85177 and result["metadata"]["checkpoint_step"] == 700
    assert result["metadata"]["clinical_validation"] is False
    destination = segmentation.result_directory(result["id"])
    mask = nib.load(destination / "prediction_mask.nii.gz").get_fdata()
    probabilities = nib.load(destination / "probabilities.nii.gz").get_fdata()
    assert mask.shape == probabilities.shape == (5, 7, 9)
    np.testing.assert_array_equal(mask, probabilities >= .70)
    assert client.get(result["mask_url"], headers=headers).status_code == 200


def change_bytes_at_same_path(path):
    before = path.stat()
    raw = path.read_bytes()
    path.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])  # Same length; intentionally corrupt test input.
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000))


def test_same_path_content_change_marks_history_stale_and_blocks_downloads(client, account, fake_runtime, db):
    case_id, headers = seed(client, account)
    url = f"/api/v1/cases/{case_id}/segmentations"
    result = client.post(url, headers=headers, json={}).json()
    original_path = db.get(Case, case_id).volume_path
    source = segmentation.UPLOAD_DIR / original_path
    change_bytes_at_same_path(source)
    listed = client.get(url, headers=headers).json()
    assert db.get(Case, case_id).volume_path == original_path
    assert listed[0]["stale"] is True
    assert set(listed[0]) == {"id", "case_id", "created_at", "stale", "metadata", "mask_url", "probabilities_url"}
    assert client.get(result["mask_url"], headers=headers).status_code == 409
    assert client.get(result["probabilities_url"], headers=headers).status_code == 409


def test_unchanged_history_and_downloads_reuse_cached_content_hash(client, account, fake_runtime, monkeypatch):
    case_id, headers = seed(client, account)
    url = f"/api/v1/cases/{case_id}/segmentations"
    result = client.post(url, headers=headers, json={}).json()
    original_read = source_fingerprint._read_digest
    reads = []
    def count_read(path, version):
        reads.append(path)
        return original_read(path, version)
    monkeypatch.setattr(source_fingerprint, "_read_digest", count_read)
    for _ in range(2):
        assert not client.get(url, headers=headers).json()[0]["stale"]
        assert client.get(result["mask_url"], headers=headers).status_code == 200
    assert reads == []  # Inference already populated the cache.
    source_fingerprint._digest_for_version.cache_clear()  # Model a worker restart/eviction.
    for _ in range(2):
        assert not client.get(url, headers=headers).json()[0]["stale"]
        assert client.get(result["probabilities_url"], headers=headers).status_code == 200
    assert len(reads) == 1


@pytest.mark.parametrize("failure", ["missing_input", "missing_checksum"])
def test_unverifiable_inputs_fail_closed(client, account, fake_runtime, db, failure):
    case_id, headers = seed(client, account)
    url = f"/api/v1/cases/{case_id}/segmentations"
    result = client.post(url, headers=headers, json={}).json()
    if failure == "missing_input":
        (segmentation.UPLOAD_DIR / db.get(Case, case_id).volume_path).unlink()
    else:
        row = db.get(SegmentationResult, result["id"])
        row.metadata_json = {key: value for key, value in row.metadata_json.items() if key != "source_sha256"}
        db.commit()
    assert client.get(url, headers=headers).json()[0]["stale"]
    assert client.get(result["mask_url"], headers=headers).status_code == 409


def test_same_path_mutation_during_inference_is_rejected_and_cleaned(client, account, fake_runtime, monkeypatch, db):
    case_id, headers = seed(client, account)
    created = []
    def execute(source, destination, threshold):
        metadata = fake_runtime(source, destination, threshold)
        created.append(destination)
        change_bytes_at_same_path(source)
        return metadata
    monkeypatch.setattr(segmentation, "execute_inference", execute)
    response = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={})
    assert response.status_code == 409
    assert created and not created[0].exists()
    assert db.scalars(select(SegmentationResult)).all() == []
