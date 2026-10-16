"""Real file/API verification with synthetic, non-patient NIfTI volumes."""
import gzip

import nibabel as nib
import numpy as np
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Case, VolumeMetadata
from app.routers.cases import UPLOAD_DIR, VOLUME_DIR
from app.services.volume_ingestion import VolumeIngestionError, validate_nifti_file


def volume_bytes(version=1, units="mm", spacing=(0.7, 1.2, 2.4)):
    affine = np.array([[0, -spacing[1], 0, 12], [spacing[0], 0, 0, -7], [0, 0, spacing[2], 3], [0, 0, 0, 1]])
    cls = nib.Nifti1Image if version == 1 else nib.Nifti2Image
    image = cls(np.arange(60, dtype=np.int16).reshape(3, 4, 5), affine)
    image.header.set_xyzt_units(units)
    image.set_qform(affine, code=1)
    image.set_sform(affine, code=2)
    return image.to_bytes(), affine


def seed(client, account):
    _, headers = account("Clinician")
    patient = client.post("/api/v1/patients", headers=headers,
                          json={"patient_code": "INT-001", "display_name": "Synthetic verification"}).json()
    case = client.post("/api/v1/cases", headers=headers,
                       json={"patient_id": patient["id"], "case_code": "INT-001"}).json()
    return case["id"], headers


@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("extension", [".nii", ".nii.gz"])
def test_rejects_valid_header_with_missing_voxel_payload(tmp_path, version, extension):
    raw, _ = volume_bytes(version)
    # Keep a parseable header and extension flag but remove the final voxel.
    payload = raw[:-2]
    path = tmp_path / ("truncated" + extension)
    path.write_bytes(gzip.compress(payload) if extension.endswith("gz") else payload)
    with pytest.raises(VolumeIngestionError, match="truncated|payload"):
        validate_nifti_file(path, extension)


@pytest.mark.parametrize("units,spacing", [("meter", (.001, .002, .003)), ("micron", (500, 800, 1200))])
def test_spatial_validation_respects_units_without_changing_geometry(tmp_path, units, spacing):
    raw, affine = volume_bytes(units=units, spacing=spacing)
    path = tmp_path / "units.nii"
    path.write_bytes(raw)
    props = validate_nifti_file(path, ".nii")
    np.testing.assert_allclose(props.affine_flat, affine.flatten(), rtol=1e-6)
    np.testing.assert_allclose([props.voxel_spacing_x, props.voxel_spacing_y, props.voxel_spacing_z], spacing)
    assert path.read_bytes() == raw


def test_declared_4d_payload_obeys_byte_limit(tmp_path):
    raw = bytearray(nib.Nifti1Image(np.zeros((4, 4, 4, 2), dtype=np.float32), np.eye(4)).to_bytes())
    # A 4D header claiming 1024 frames must not be accepted as a small 3D file.
    import struct
    struct.pack_into("<h", raw, 48, 1024)
    path = tmp_path / "oversized-4d.nii"
    path.write_bytes(raw)
    with pytest.raises(VolumeIngestionError, match="payload|maximum|truncated"):
        validate_nifti_file(path, ".nii", max_uncompressed_bytes=4096)


@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("extension", [".nii", ".nii.gz"])
def test_api_stores_original_volume_and_preserves_spatial_metadata(client, account, version, extension):
    case_id, headers = seed(client, account)
    raw, affine = volume_bytes(version)
    payload = gzip.compress(raw) if extension.endswith("gz") else raw
    response = client.post(f"/api/v1/cases/{case_id}/volume", headers=headers,
                           files={"file": ("deidentified" + extension, payload)})
    assert response.status_code == 200, response.text
    stored = (UPLOAD_DIR / response.json()["volume_path"]).resolve()
    assert stored.is_relative_to(VOLUME_DIR)
    assert stored.read_bytes() == payload
    actual = nib.load(stored)
    np.testing.assert_array_equal(np.asanyarray(actual.dataobj), np.arange(60, dtype=np.int16).reshape(3, 4, 5))
    metadata = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers).json()
    assert [metadata[k] for k in ["shape_x", "shape_y", "shape_z"]] == [3, 4, 5]
    assert metadata["xyzt_units"] == 2
    assert (metadata["qform_code"], metadata["sform_code"]) == (1, 2)
    np.testing.assert_allclose(metadata["affine"], affine.flatten(), rtol=1e-6)
    assert not response.json().get("analysis")


def test_api_honors_configured_voxel_limit(client, account, monkeypatch):
    case_id, headers = seed(client, account)
    monkeypatch.setattr(settings, "MAX_VOLUME_VOXELS", 20)
    raw, _ = volume_bytes()
    response = client.post(f"/api/v1/cases/{case_id}/volume", headers=headers,
                           files={"file": ("too-many-voxels.nii", raw)})
    assert response.status_code == 400
    assert "voxel count" in response.json()["detail"]


def test_failed_replacement_keeps_committed_input_and_cleans_new_file(client, account, db, monkeypatch):
    case_id, headers = seed(client, account)
    raw, _ = volume_bytes()
    route = f"/api/v1/cases/{case_id}/volume"
    initial = client.post(route, headers=headers, files={"file": ("first.nii", raw)})
    old_path = UPLOAD_DIR / initial.json()["volume_path"]
    files_before = set(VOLUME_DIR.iterdir())
    original_commit = Session.commit
    def fail_upload_commit(session):
        if any(isinstance(row, VolumeMetadata) for row in session.dirty):
            raise RuntimeError("Injected commit failure")
        return original_commit(session)
    monkeypatch.setattr(Session, "commit", fail_upload_commit)
    with pytest.raises(RuntimeError, match="Injected"):
        client.post(route, headers=headers, files={"file": ("second.nii", raw)})
    db.expire_all()
    assert old_path.read_bytes() == raw
    assert (UPLOAD_DIR / db.get(Case, case_id).volume_path) == old_path
    assert set(VOLUME_DIR.iterdir()) == files_before
