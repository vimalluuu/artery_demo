import gzip
import os
import builtins
import asyncio
import hashlib
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.requests import ClientDisconnect

from app.core.config import settings
from app.database.session import SessionLocal
from app.models import Case, SegmentationResult
from app.models.audit import AuditEvent
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
        assert client.get(result["mask_url"].rsplit("/", 1)[0] + "/source", headers=headers).status_code == 200
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


@pytest.mark.parametrize("role", ["Clinician", "Admin", "Researcher", "DataScientist"])
@pytest.mark.parametrize("compressed", [True, False])
def test_source_bytes_authorization_and_safe_headers(client, account, fake_runtime, db, role, compressed):
    case_id, writer = seed(client, account)
    if not compressed:
        uploaded = client.post(f"/api/v1/cases/{case_id}/volume", headers=writer,
                               files={"file": ("synthetic.nii", gzip.decompress(volume()))})
        assert uploaded.status_code == 200
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=writer, json={}).json()
    url = f"/api/v1/cases/{case_id}/segmentations/{result['id']}/source"
    assert client.get(url).status_code == 401
    _, reader = account(role)
    response = client.get(url, headers=reader)
    assert response.status_code == 200
    assert response.content == (segmentation.UPLOAD_DIR / db.get(Case, case_id).volume_path).read_bytes()
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    expected = "source_ct.nii.gz" if compressed else "source_ct.nii"
    assert response.headers["content-disposition"] == f'attachment; filename="{expected}"'
    assert "volumes/" not in response.headers["content-disposition"]


@pytest.mark.parametrize("failure", ["missing_source", "missing_checksum", "same_path_change", "replaced_path", "outside_storage", "wrong_case", "missing_result", "inactive_user"])
def test_source_fails_closed(client, account, fake_runtime, db, failure, tmp_path):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    case = db.get(Case, case_id)
    row = db.get(SegmentationResult, result["id"])
    source = segmentation.UPLOAD_DIR / case.volume_path
    requested_case = case_id
    expected = 409
    if failure == "missing_source":
        source.unlink()
    elif failure == "missing_checksum":
        row.metadata_json = {}
    elif failure == "same_path_change":
        change_bytes_at_same_path(source)
    elif failure == "replaced_path":
        case.volume_path = "volumes/replaced.nii.gz"
    elif failure == "outside_storage":
        outside = tmp_path / "private.nii.gz"
        outside.write_bytes(volume())
        case.volume_path = str(outside)
        row.source_volume_path = str(outside)
    elif failure == "wrong_case":
        other = client.post("/api/v1/cases", headers=headers,
                            json={"patient_id": case.patient_id, "case_code": "SEG-OTHER", "modality": "CTA"}).json()
        requested_case, expected = other["id"], 404
    elif failure == "missing_result":
        db.delete(row)
        expected = 404
    else:
        user, headers = account("Researcher")
        user.is_active = False
        expected = 401  # Existing auth treats a deactivated identity as invalid.
    db.commit()
    response = client.get(f"/api/v1/cases/{requested_case}/segmentations/{result['id']}/source", headers=headers)
    assert response.status_code == expected, response.text
    assert "private.nii.gz" not in response.text and str(segmentation.UPLOAD_DIR) not in response.text


def test_source_route_is_documented_and_traversal_is_rejected(client, account, fake_runtime, db):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    schema = client.get("/openapi.json").json()
    route = "/api/v1/cases/{case_id}/segmentations/{result_id}/source"
    assert route in schema["paths"]
    assert schema["paths"][route]["get"]["security"]
    assert set(schema["paths"][route]["get"]["responses"]["200"]["content"]) == {"application/gzip", "application/octet-stream"}
    case = db.get(Case, case_id)
    case.volume_path = "../private.nii.gz"
    row = db.get(SegmentationResult, result["id"])
    row.source_volume_path = case.volume_path
    db.commit()
    assert client.get(f"/api/v1/cases/{case_id}/segmentations/{result['id']}/source", headers=headers).status_code == 409


def test_source_symlink_outside_storage_fails_closed(client, account, fake_runtime, db, tmp_path):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    path = segmentation.UPLOAD_DIR / db.get(Case, case_id).volume_path
    outside = tmp_path / "outside.nii.gz"
    outside.write_bytes(path.read_bytes())
    path.unlink()
    try:
        path.symlink_to(outside)
    except OSError:
        pytest.skip("Creating symlinks is not permitted on this host")
    response = client.get(f"/api/v1/cases/{case_id}/segmentations/{result['id']}/source", headers=headers)
    assert response.status_code == 409


@pytest.mark.parametrize("change", ["replace", "in_place", "delete"])
def test_source_change_after_freshness_check_before_snapshot_is_rejected(
        client, account, fake_runtime, db, monkeypatch, change):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    source = segmentation.UPLOAD_DIR / db.get(Case, case_id).volume_path
    snapshot_source = segmentation.snapshot_source
    temporary_file = segmentation.tempfile.TemporaryFile
    snapshots = []

    def track_snapshot(*args, **kwargs):
        snapshot = temporary_file(*args, **kwargs)
        snapshots.append(snapshot)
        return snapshot

    def change_then_snapshot(path, expected, compressed):
        assert path == source  # The route has already checked freshness and containment.
        if change == "replace":
            replacement = source.with_name("replacement.nii.gz")
            replacement.write_bytes(b"unvalidated replacement")
            replacement.replace(source)
        elif change == "in_place":
            change_bytes_at_same_path(source)
        else:
            source.unlink()
        return snapshot_source(path, expected, compressed)

    monkeypatch.setattr(segmentation.tempfile, "TemporaryFile", track_snapshot)
    monkeypatch.setattr(segmentation, "snapshot_source", change_then_snapshot)
    response = client.get(result["mask_url"].rsplit("/", 1)[0] + "/source", headers=headers)
    assert response.status_code == 409
    assert snapshots and all(snapshot.closed for snapshot in snapshots)
    assert db.scalars(select(AuditEvent).where(AuditEvent.action == "case.segmentation_source_read")).all() == []


@pytest.mark.parametrize("change", ["replace", "in_place"])
def test_source_changes_before_response_reads_do_not_change_verified_snapshot(
        client, account, fake_runtime, db, monkeypatch, change):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    source = segmentation.UPLOAD_DIR / db.get(Case, case_id).volume_path
    original_bytes = source.read_bytes()
    response_call = segmentation.SourceSnapshotResponse.__call__
    snapshots = []

    async def change_then_respond(self, scope, receive, send):
        snapshots.append(self.snapshot)
        if change == "replace":
            replacement = source.with_name("replacement.nii.gz")
            replacement.write_bytes(b"must never be served")
            replacement.replace(source)
        else:
            change_bytes_at_same_path(source)
        return await response_call(self, scope, receive, send)

    monkeypatch.setattr(segmentation.SourceSnapshotResponse, "__call__", change_then_respond)
    response = client.get(result["mask_url"].rsplit("/", 1)[0] + "/source", headers=headers)
    assert response.status_code == 200
    assert response.content == original_bytes and response.content != source.read_bytes()
    assert int(response.headers["content-length"]) == len(original_bytes)
    assert snapshots and all(snapshot.closed for snapshot in snapshots)
    assert len(db.scalars(select(AuditEvent).where(AuditEvent.action == "case.segmentation_source_read")).all()) == 1


def test_source_symlink_swap_between_containment_check_and_open_is_rejected(
        client, account, fake_runtime, db, tmp_path, monkeypatch):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    source = segmentation.UPLOAD_DIR / db.get(Case, case_id).volume_path
    outside = tmp_path / "outside.nii.gz"
    outside.write_bytes(source.read_bytes())  # Even an identical checksum must not bypass containment.
    link = source.with_name("replacement-link.nii.gz")
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("Creating symlinks is not permitted on this host")
    snapshot_source = segmentation.snapshot_source

    def swap_then_snapshot(path, expected, compressed):
        link.replace(source)
        return snapshot_source(path, expected, compressed)

    monkeypatch.setattr(segmentation, "snapshot_source", swap_then_snapshot)
    response = client.get(result["mask_url"].rsplit("/", 1)[0] + "/source", headers=headers)
    assert response.status_code == 409
    assert str(outside) not in response.text


def test_case_source_path_changed_during_snapshot_is_rejected(client, account, fake_runtime, monkeypatch):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    snapshot_source = segmentation.snapshot_source
    snapshots = []

    def snapshot_then_replace_case_path(*args):
        snapshot = snapshot_source(*args)
        snapshots.append(snapshot)
        with SessionLocal() as other:
            other.get(Case, case_id).volume_path = "volumes/replacement.nii.gz"
            other.commit()
        return snapshot

    monkeypatch.setattr(segmentation, "snapshot_source", snapshot_then_replace_case_path)
    response = client.get(result["mask_url"].rsplit("/", 1)[0] + "/source", headers=headers)
    assert response.status_code == 409
    assert snapshots and all(snapshot.closed for snapshot in snapshots)


@pytest.mark.parametrize("failure", ["disconnect", "cancel", "error"])
def test_source_snapshot_closes_on_failed_response(failure):
    snapshot = segmentation.tempfile.TemporaryFile(mode="w+b")
    snapshot.write(b"verified snapshot")
    snapshot.seek(0)
    response = segmentation.SourceSnapshotResponse(snapshot, compressed=False)
    error = {"disconnect": OSError, "cancel": asyncio.CancelledError, "error": RuntimeError}[failure]

    async def send(message):
        if message["type"] == "http.response.body":
            raise error("Synthetic response failure")

    async def receive():
        raise AssertionError("ASGI 2.4 uses send errors for disconnect detection")

    with pytest.raises(ClientDisconnect if failure == "disconnect" else error):
        asyncio.run(response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send))
    assert snapshot.closed


def test_source_snapshot_closes_on_legacy_asgi_disconnect():
    snapshot = segmentation.tempfile.TemporaryFile(mode="w+b")
    snapshot.write(b"verified snapshot")
    snapshot.seek(0)
    response = segmentation.SourceSnapshotResponse(snapshot, compressed=False)

    async def send(message):
        pass

    async def receive():
        return {"type": "http.disconnect"}

    asyncio.run(response({"type": "http", "asgi": {"spec_version": "2.0"}}, receive, send))
    assert snapshot.closed


def test_source_snapshot_closes_when_audit_commit_fails(client, account, fake_runtime, monkeypatch):
    case_id, headers = seed(client, account)
    result = client.post(f"/api/v1/cases/{case_id}/segmentations", headers=headers, json={}).json()
    snapshot_source = segmentation.snapshot_source
    snapshots = []

    def track_snapshot(*args):
        snapshot = snapshot_source(*args)
        snapshots.append(snapshot)
        return snapshot

    def fail_commit(self):
        raise HTTPException(503, "Synthetic persistence failure")

    monkeypatch.setattr(segmentation, "snapshot_source", track_snapshot)
    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.get(result["mask_url"].rsplit("/", 1)[0] + "/source", headers=headers)
    assert response.status_code == 503
    assert snapshots and all(snapshot.closed for snapshot in snapshots)


def test_source_mutated_during_multi_chunk_copy_is_rejected(tmp_path, monkeypatch):
    source = tmp_path / "source.nii"
    original = b"A" * (2 * 1024 * 1024)
    source.write_bytes(original)
    open_path = Path.open
    reads = []

    class ChangingReader:
        def __enter__(self):
            self.stream = open_path(source, "rb")
            return self

        def __exit__(self, *args):
            self.stream.close()

        def fileno(self):
            return self.stream.fileno()

        def read(self, count):
            reads.append(count)
            if len(reads) == 2:
                with open_path(source, "r+b") as writer:
                    writer.seek(1024 * 1024)
                    writer.write(b"B" * (1024 * 1024))
            return self.stream.read(count)

    def changing_open(path, *args, **kwargs):
        return ChangingReader() if path == source and args == ("rb",) else open_path(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", changing_open)
    with pytest.raises(HTTPException) as failure:
        segmentation.snapshot_source(source, hashlib.sha256(original).hexdigest(), compressed=False)
    assert failure.value.status_code == 409
    assert len(reads) >= 2 and all(size == 1024 * 1024 for size in reads)


def test_source_snapshot_rejects_oversized_file_without_copying(tmp_path, monkeypatch):
    source = tmp_path / "source.nii"
    source.write_bytes(b"A" * (1024 * 1024 + 1))
    monkeypatch.setattr(settings, "MAX_VOLUME_UNCOMPRESSED_FILE_MB", 1)
    with pytest.raises(HTTPException) as failure:
        segmentation.snapshot_source(source, "unused", compressed=False)
    assert failure.value.status_code == 409
    assert "storage limit" in failure.value.detail
