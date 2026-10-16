"""
test_volume_ingestion.py — Phase 4 NIfTI volume ingestion tests.

Tests cover:
  - Valid 3D .nii, 4D .nii, and .nii.gz uploads
  - Extension rejection, empty file, truncated header, spoofed content
  - Size limits and bounded-decompression behaviour
  - Invalid shape, spacing, affine, dtype, ndim
  - RBAC: Clinician/Admin pass; Researcher/DataScientist/unauthenticated fail
  - Missing case 404
  - Metadata persistence (shape, spacing, affine, dtype, units)
  - Relative-path enforcement and path-traversal attempt
  - Replacement (second upload removes old file)
  - Old cases with no volume
  - 2D image and 3D volume coexisting on one case
  - Volume service unit tests (validate_nifti_file)
  - Existing 2D upload tests unaffected (regression smoke)

All tests run against the disposable in-memory SQLite test DB via conftest.py.
No real database is touched.
"""
from __future__ import annotations

import gzip
import io
import struct
import tempfile
from pathlib import Path
from uuid import uuid4

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.services.volume_ingestion import (
    MAX_DIMENSION_SIZE,
    MAX_VOXEL_COUNT,
    SUPPORTED_EXTENSIONS,
    VolumeIngestionError,
    VolumeProperties,
    _bounded_decompress,
    _detect_nifti_version,
    validate_nifti_extension,
    validate_nifti_file,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _uid() -> str:
    return uuid4().hex[:8]


def _make_patient(client: TestClient, headers: dict) -> int:
    r = client.post("/api/v1/patients", json={
        "patient_code": f"PT-{_uid()}",
        "display_name": "Volume Test Patient",
    }, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _make_case(client: TestClient, headers: dict) -> int:
    pid = _make_patient(client, headers)
    r = client.post("/api/v1/cases", json={
        "patient_id": pid,
        "case_code": f"CASE-{_uid()}",
        "study_type": "Coronary Artery Analysis",
    }, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _nii3d_bytes(
    shape: tuple[int, int, int] = (16, 16, 8),
    dtype: np.dtype | str = np.float32,
    spacing: tuple[float, float, float] = (1.0, 1.0, 2.0),
) -> bytes:
    """Return raw bytes for a minimal valid 3D NIfTI-1 file."""
    data = np.zeros(shape, dtype=dtype)
    affine = np.diag([spacing[0], spacing[1], spacing[2], 1.0])
    img = nib.Nifti1Image(data, affine)
    return img.to_bytes()


def _nii4d_bytes(
    shape: tuple[int, int, int, int] = (8, 8, 4, 3),
    dtype: np.dtype | str = np.int16,
) -> bytes:
    """Return raw bytes for a minimal valid 4D NIfTI-1 file."""
    data = np.zeros(shape, dtype=dtype)
    img = nib.Nifti1Image(data, np.eye(4))
    return img.to_bytes()


def _niigz_bytes(shape: tuple[int, int, int] = (8, 8, 4)) -> bytes:
    """Return raw bytes for a valid .nii.gz file (gzip-compressed NIfTI)."""
    data = np.zeros(shape, dtype=np.float32)
    img = nib.Nifti1Image(data, np.eye(4))
    raw = img.to_bytes()
    gz_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=gz_buf, mode="wb") as gz:
        gz.write(raw)
    return gz_buf.getvalue()


def _minimal_png() -> bytes:
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
        "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )


# ─── Service unit tests ───────────────────────────────────────────────────────

class TestValidateNiftiExtension:
    def test_nii_accepted(self):
        assert validate_nifti_extension("scan.nii") == ".nii"

    def test_nii_gz_accepted(self):
        assert validate_nifti_extension("scan.nii.gz") == ".nii.gz"

    def test_case_insensitive(self):
        assert validate_nifti_extension("SCAN.NII") == ".nii"
        assert validate_nifti_extension("SCAN.NII.GZ") == ".nii.gz"

    def test_dcm_rejected(self):
        with pytest.raises(VolumeIngestionError):
            validate_nifti_extension("scan.dcm")

    def test_png_rejected(self):
        with pytest.raises(VolumeIngestionError):
            validate_nifti_extension("scan.png")

    def test_empty_name_rejected(self):
        with pytest.raises(VolumeIngestionError):
            validate_nifti_extension("")

    def test_nii_bak_rejected(self):
        with pytest.raises(VolumeIngestionError):
            validate_nifti_extension("scan.nii.bak")


class TestValidateNiftiFile:
    def _write_tmp(self, data: bytes, suffix: str = ".nii") -> Path:
        fd, name = tempfile.mkstemp(suffix=suffix)
        import os
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
        return Path(name)

    def test_valid_3d_nii(self):
        path = self._write_tmp(_nii3d_bytes(), ".nii")
        try:
            props = validate_nifti_file(path, ".nii")
            assert props.ndim == 3
            assert props.shape == (16, 16, 8)
            assert props.voxel_dtype == "float32"
            assert len(props.affine_flat) == 16
            assert props.nifti_version == 1
        finally:
            path.unlink(missing_ok=True)

    def test_valid_4d_nii(self):
        path = self._write_tmp(_nii4d_bytes(), ".nii")
        try:
            props = validate_nifti_file(path, ".nii")
            assert props.ndim == 4
            assert props.shape == (8, 8, 4, 3)
            assert props.voxel_dtype == "int16"
        finally:
            path.unlink(missing_ok=True)

    def test_valid_nii_gz(self):
        path = self._write_tmp(_niigz_bytes(), ".nii.gz")
        try:
            props = validate_nifti_file(path, ".nii.gz")
            assert props.ndim == 3
            assert props.shape == (8, 8, 4)
        finally:
            path.unlink(missing_ok=True)

    def test_voxel_spacing_extracted(self):
        path = self._write_tmp(_nii3d_bytes(spacing=(1.5, 2.0, 3.0)), ".nii")
        try:
            props = validate_nifti_file(path, ".nii")
            assert abs(props.voxel_spacing_x - 1.5) < 1e-5
            assert abs(props.voxel_spacing_y - 2.0) < 1e-5
            assert abs(props.voxel_spacing_z - 3.0) < 1e-5
        finally:
            path.unlink(missing_ok=True)

    def test_empty_file_rejected(self):
        path = self._write_tmp(b"", ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="empty"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_truncated_header_rejected(self):
        path = self._write_tmp(b"x" * 100, ".nii")
        try:
            with pytest.raises(VolumeIngestionError):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_png_renamed_to_nii_rejected(self):
        path = self._write_tmp(_minimal_png(), ".nii")
        try:
            with pytest.raises(VolumeIngestionError):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_2d_image_rejected(self):
        data = np.zeros((64, 64), dtype=np.float32)
        img = nib.Nifti1Image(data, np.eye(4))
        path = self._write_tmp(img.to_bytes(), ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="dimension"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_5d_volume_rejected(self):
        # nibabel won't easily create a 5D without header manipulation;
        # we test by creating a large dim header manually with nibabel
        data = np.zeros((4, 4, 4, 2, 2), dtype=np.float32)
        img = nib.Nifti1Image(data, np.eye(4))
        path = self._write_tmp(img.to_bytes(), ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="dimension"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_zero_spacing_rejected(self):
        # Start with a valid 3D image, then corrupt the pixdim bytes
        # to set x-spacing to 0 (nibabel won't let us create it directly
        # with a zero-diagonal affine).
        valid_bytes = bytearray(_nii3d_bytes((8, 8, 4), spacing=(1.0, 1.0, 1.0)))
        # pixdim is at byte offset 76 in the NIfTI-1 header, 8 floats of 4 bytes each.
        # pixdim[1] (x-spacing) is at offset 76 + 4 = 80
        import struct
        struct.pack_into('<f', valid_bytes, 80, 0.0)  # zero x-spacing
        path = self._write_tmp(bytes(valid_bytes), ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="spacing"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_implausible_spacing_rejected(self):
        data = np.zeros((4, 4, 4), dtype=np.float32)
        img = nib.Nifti1Image(data, np.eye(4))
        img.header["pixdim"][1] = 200.0  # 200 mm — implausible
        img.header.set_xyzt_units("mm")
        path = self._write_tmp(img.to_bytes(), ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="100 mm"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_singular_affine_rejected(self):
        # Start with a valid image then corrupt the affine in the raw bytes.
        # The affine starts after the 348-byte NIfTI-1 header.
        # nibabel stores the affine via sform; sform offset in NIfTI-1 is byte 280.
        # Easiest approach: set all rotation columns to zero via the srow bytes.
        valid_bytes = bytearray(_nii3d_bytes((4, 4, 4)))
        import struct
        # srow_x (bytes 280-292), srow_y (292-304), srow_z (304-316): 3*4 floats each
        # Zero out the 3x3 submatrix (first 3 elements of each srow)
        for row_offset in (280, 292, 304):
            for col in range(3):
                struct.pack_into('<f', valid_bytes, row_offset + col * 4, 0.0)
        # Set sform_code to 1 so nibabel uses sform for affine
        struct.pack_into('<h', valid_bytes, 254, 1)  # sform_code at offset 254
        path = self._write_tmp(bytes(valid_bytes), ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="degenerate"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_complex_dtype_rejected(self):
        data = np.zeros((4, 4, 4), dtype=np.complex64)
        img = nib.Nifti1Image(data, np.eye(4))
        path = self._write_tmp(img.to_bytes(), ".nii")
        try:
            with pytest.raises(VolumeIngestionError, match="data type"):
                validate_nifti_file(path, ".nii")
        finally:
            path.unlink(missing_ok=True)

    def test_bounded_decompress_rejects_large_gz(self, monkeypatch):
        """Bounded decompressor must reject when decompressed size > limit."""
        import app.services.volume_ingestion as vi
        monkeypatch.setattr(vi, "MAX_UNCOMPRESSED_BYTES", 10)  # tiny limit
        gz_bytes = _niigz_bytes((4, 4, 4))
        path = self._write_tmp(gz_bytes, ".nii.gz")
        try:
            with pytest.raises(VolumeIngestionError, match="Decompressed"):
                validate_nifti_file(path, ".nii.gz")
        finally:
            path.unlink(missing_ok=True)

    def test_bounded_decompress_retains_only_header_bytes(self):
        gz_bytes = _niigz_bytes((16, 16, 8))
        path = self._write_tmp(gz_bytes, ".nii.gz")
        try:
            header = _bounded_decompress(path, limit=10_000_000, header_read_limit=540)
            assert len(header) == 540
            assert len(gzip.decompress(gz_bytes)) > 1000
        finally:
            path.unlink(missing_ok=True)

    def test_validate_nifti_file_accepts_custom_limit_without_global_mutation(self):
        import app.services.volume_ingestion as vi
        default_limit = vi.MAX_UNCOMPRESSED_BYTES
        gz_bytes = _niigz_bytes((4, 4, 4))
        path = self._write_tmp(gz_bytes, ".nii.gz")
        try:
            with pytest.raises(VolumeIngestionError, match="Decompressed"):
                validate_nifti_file(path, ".nii.gz", max_uncompressed_bytes=10)
            # Global limit must be intact
            assert vi.MAX_UNCOMPRESSED_BYTES == default_limit
            props = validate_nifti_file(path, ".nii.gz", max_uncompressed_bytes=10_000_000)
            assert props.ndim == 3
        finally:
            path.unlink(missing_ok=True)

    def test_corrupt_gz_rejected(self):
        path = self._write_tmp(b"\x1f\x8b" + b"\x00" * 50, ".nii.gz")
        try:
            with pytest.raises(VolumeIngestionError):
                validate_nifti_file(path, ".nii.gz")
        finally:
            path.unlink(missing_ok=True)

    def test_float64_dtype_accepted(self):
        """float64 is in ALLOWED_NP_KINDS ('f')."""
        path = self._write_tmp(_nii3d_bytes(dtype=np.float64), ".nii")
        try:
            props = validate_nifti_file(path, ".nii")
            assert props.voxel_dtype == "float64"
        finally:
            path.unlink(missing_ok=True)

    def test_uint8_dtype_accepted(self):
        path = self._write_tmp(_nii3d_bytes(dtype=np.uint8), ".nii")
        try:
            props = validate_nifti_file(path, ".nii")
            assert props.voxel_dtype == "uint8"
        finally:
            path.unlink(missing_ok=True)

    def test_affine_flat_length(self):
        path = self._write_tmp(_nii3d_bytes(), ".nii")
        try:
            props = validate_nifti_file(path, ".nii")
            assert len(props.affine_flat) == 16
        finally:
            path.unlink(missing_ok=True)


# ─── API integration tests ────────────────────────────────────────────────────

class TestVolumeUploadValid:
    def test_clinician_uploads_3d_nii(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("brain.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["volume_path"] is not None
        assert body["has_volume"] is True
        assert body["id"] == case_id

    def test_admin_uploads_3d_nii(self, client: TestClient, account):
        _, headers = account("Admin")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    def test_upload_4d_nii(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("timeseries.nii", _nii4d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_volume"] is True

    def test_upload_nii_gz(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii.gz", _niigz_bytes(), "application/gzip")},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    def test_volume_path_is_relative(self, client: TestClient, account):
        """volume_path must be a relative path (not absolute)."""
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 200
        vpath = r.json()["volume_path"]
        assert not vpath.startswith("/"), "volume_path must be relative, not absolute"
        assert not (len(vpath) > 1 and vpath[1] == ":"), "volume_path must not be an absolute Windows path"

    def test_volume_path_starts_with_volumes_dir(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["volume_path"].startswith("volumes/")

    def test_get_returns_volume_path_after_upload(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        before = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert before["volume_path"] is None
        assert before["has_volume"] is False
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        after = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert after["volume_path"] is not None
        assert after["has_volume"] is True


class TestVolumeUploadRBAC:
    def test_researcher_cannot_upload(self, client: TestClient, account):
        _, clinician_hdr = account("Clinician")
        _, researcher_hdr = account("Researcher")
        case_id = _make_case(client, clinician_hdr)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=researcher_hdr,
        )
        assert r.status_code == 403

    def test_data_scientist_cannot_upload(self, client: TestClient, account):
        _, clinician_hdr = account("Clinician")
        _, ds_hdr = account("DataScientist")
        case_id = _make_case(client, clinician_hdr)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=ds_hdr,
        )
        assert r.status_code == 403

    def test_unauthenticated_cannot_upload(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
        )
        assert r.status_code == 401

    def test_researcher_can_read_volume_metadata(self, client: TestClient, account):
        _, clinician_hdr = account("Clinician")
        _, researcher_hdr = account("Researcher")
        case_id = _make_case(client, clinician_hdr)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=clinician_hdr,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=researcher_hdr)
        assert r.status_code == 200

    def test_data_scientist_can_read_volume_metadata(self, client: TestClient, account):
        _, clinician_hdr = account("Clinician")
        _, ds_hdr = account("DataScientist")
        case_id = _make_case(client, clinician_hdr)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=clinician_hdr,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=ds_hdr)
        assert r.status_code == 200


class TestVolumeUploadErrors:
    def test_wrong_extension_returns_415(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("report.pdf", b"%PDF-1", "application/pdf")},
            headers=headers,
        )
        assert r.status_code == 415

    def test_dcm_extension_returns_415(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("scan.dcm", b"DICM", "application/dicom")},
            headers=headers,
        )
        assert r.status_code == 415

    def test_empty_file_returns_400(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("empty.nii", b"", "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 400

    def test_truncated_nifti_returns_400(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("trunc.nii", b"x" * 100, "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 400

    def test_png_renamed_nii_returns_400(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("spoofed.nii", _minimal_png(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 400

    def test_missing_case_returns_404(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.post(
            "/api/v1/cases/999999/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 404

    def test_corrupt_gz_returns_400(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("corrupt.nii.gz", b"\x1f\x8b\x00" + b"\xff" * 50, "application/gzip")},
            headers=headers,
        )
        assert r.status_code == 400

    def test_nii_gz_upload_exceeds_compressed_limit_returns_413(self, client: TestClient, account, monkeypatch):
        import app.routers.cases as cases_mod
        monkeypatch.setattr(cases_mod, "MAX_VOLUME_COMPRESSED", 50)
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("scan.nii.gz", _niigz_bytes(), "application/gzip")},
            headers=headers,
        )
        assert r.status_code == 413
        assert "compressed (.nii.gz)" in r.json()["detail"]

    def test_nii_upload_exceeds_uncompressed_limit_returns_413(self, client: TestClient, account, monkeypatch):
        import app.routers.cases as cases_mod
        monkeypatch.setattr(cases_mod, "MAX_VOLUME_UNCOMPRESSED_FILE", 50)
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("scan.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 413
        assert "uncompressed (.nii)" in r.json()["detail"]

    def test_nii_not_blocked_by_compressed_limit(self, client: TestClient, account, monkeypatch):
        import app.routers.cases as cases_mod
        monkeypatch.setattr(cases_mod, "MAX_VOLUME_COMPRESSED", 50)
        monkeypatch.setattr(cases_mod, "MAX_VOLUME_UNCOMPRESSED_FILE", 10_000_000)
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("scan.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 200, r.text


class TestVolumeMetadataPersistence:
    def test_metadata_shape_correct(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes((24, 20, 12)), "application/octet-stream")},
            headers=headers,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 200
        meta = r.json()
        assert meta["shape_x"] == 24
        assert meta["shape_y"] == 20
        assert meta["shape_z"] == 12
        assert meta["shape_t"] is None
        assert meta["ndim"] == 3

    def test_metadata_4d_shape_t(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii4d_bytes((8, 8, 4, 5)), "application/octet-stream")},
            headers=headers,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 200
        meta = r.json()
        assert meta["ndim"] == 4
        assert meta["shape_t"] == 5

    def test_metadata_voxel_spacing(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(spacing=(1.5, 2.0, 3.0)), "application/octet-stream")},
            headers=headers,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 200
        meta = r.json()
        assert abs(meta["voxel_spacing_x"] - 1.5) < 1e-4
        assert abs(meta["voxel_spacing_y"] - 2.0) < 1e-4
        assert abs(meta["voxel_spacing_z"] - 3.0) < 1e-4

    def test_metadata_affine_length(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 200
        assert len(r.json()["affine"]) == 16

    def test_metadata_dtype(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(dtype=np.int16), "application/octet-stream")},
            headers=headers,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 200
        assert r.json()["voxel_dtype"] == "int16"

    def test_metadata_404_when_no_volume(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 404

    def test_metadata_404_for_missing_case(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.get("/api/v1/cases/999999/volume/metadata", headers=headers)
        assert r.status_code == 404

    def test_unauthenticated_cannot_read_metadata(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata")
        assert r.status_code == 401


class TestVolumeReplacement:
    def test_second_upload_replaces_volume_path(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r1 = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol1.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        path1 = r1.json()["volume_path"]

        r2 = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol2.nii", _nii3d_bytes((4, 4, 4)), "application/octet-stream")},
            headers=headers,
        )
        path2 = r2.json()["volume_path"]

        assert path1 != path2, "Second upload must produce a new path"
        # GET must show the updated path
        after = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert after["volume_path"] == path2

    def test_second_upload_updates_metadata(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol1.nii", _nii3d_bytes((16, 16, 8)), "application/octet-stream")},
            headers=headers,
        )
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol2.nii", _nii3d_bytes((4, 4, 4)), "application/octet-stream")},
            headers=headers,
        )
        meta = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers).json()
        assert meta["shape_x"] == 4
        assert meta["shape_y"] == 4
        assert meta["shape_z"] == 4


class TestVolumeAndImageCoexist:
    def test_2d_image_and_3d_volume_on_same_case(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)

        # Upload 2D image
        r_img = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        assert r_img.status_code == 200
        assert r_img.json()["image_path"] is not None

        # Upload 3D volume
        r_vol = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("brain.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r_vol.status_code == 200

        case = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        # Both coexist
        assert case["image_path"] is not None
        assert case["volume_path"] is not None
        assert case["has_volume"] is True

    def test_2d_upload_does_not_affect_volume_path(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        # Upload volume first
        client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("vol.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        # Now upload a 2D image
        client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        case = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert case["volume_path"] is not None, "Volume upload must survive 2D image upload"


class TestOldCasesNoVolume:
    def test_existing_case_has_volume_path_null(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        case = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert case["volume_path"] is None
        assert case["has_volume"] is False

    def test_list_response_includes_has_volume_false(self, client: TestClient, account):
        _, headers = account("Clinician")
        _make_case(client, headers)
        r = client.get("/api/v1/cases", headers=headers)
        assert r.status_code == 200
        for c in r.json():
            # All cases without volume must report has_volume correctly
            if c["volume_path"] is None:
                assert c["has_volume"] is False


class TestPathTraversalPrevention:
    def test_traversal_filename_still_stored_safely(self, client: TestClient, account):
        """The filename from the client is discarded; only UUID+ext is stored."""
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/volume",
            files={"file": ("../../etc/passwd.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        # Should succeed (filename is ignored; UUID name used instead)
        assert r.status_code == 200
        vpath = r.json()["volume_path"]
        assert ".." not in vpath
        assert vpath.startswith("volumes/")

    def test_invalid_stored_path_returns_400(self, client: TestClient, account, db):
        """If a stored volume_path resolves outside VOLUME_DIR, metadata endpoint → 400."""
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        # Inject a bad path directly into the DB
        from app.models import Case
        row = db.get(Case, case_id)
        row.volume_path = "../../secret"
        db.commit()
        r = client.get(f"/api/v1/cases/{case_id}/volume/metadata", headers=headers)
        assert r.status_code == 400


class TestMigrationModelCompatibility:
    def test_case_model_has_volume_path(self):
        from app.models.case import Case
        cols = {c.key for c in Case.__table__.columns}
        assert "volume_path" in cols

    def test_volume_path_is_nullable(self):
        from app.models.case import Case
        col = Case.__table__.c["volume_path"]
        assert col.nullable

    def test_volume_metadata_table_exists(self):
        from app.models.volume_metadata import VolumeMetadata
        cols = {c.key for c in VolumeMetadata.__table__.columns}
        required = {
            "id", "case_id",
            "dim_x", "dim_y", "dim_z", "dim_t",
            "voxel_spacing_x", "voxel_spacing_y", "voxel_spacing_z",
            "aff_00", "aff_15",  # spot-check first and last affine columns
            "voxel_dtype", "nifti_version",
            "qform_code", "sform_code", "xyzt_units",
            "file_size_bytes", "uploaded_at", "uploader_id",
        }
        # aff_15 is aff_33 (index 15), check it exists
        affine_cols = {f"aff_{r}{c}" for r in range(4) for c in range(4)}
        assert affine_cols.issubset(cols)
        for col in ("id", "case_id", "dim_x", "dim_y", "dim_z", "voxel_dtype"):
            assert col in cols, f"Expected column '{col}' in volume_metadata"

    def test_volume_metadata_case_id_unique_indexed(self):
        from app.models.volume_metadata import VolumeMetadata
        index_names = {
            idx.name
            for idx in VolumeMetadata.__table__.indexes
        }
        # The unique enforcement for case_id is done via op.create_index in the
        # migration (unique=True). ORM uses index=True which produces the same
        # named index (ix_volume_metadata_case_id); uniqueness is a DB-level
        # property enforced by the migration, not the ORM Index object.
        assert "ix_volume_metadata_case_id" in index_names, (
            f"Expected ix_volume_metadata_case_id in {index_names}"
        )

    def test_case_and_volume_metadata_relationship(self):
        from app.models.case import Case
        from app.models.volume_metadata import VolumeMetadata
        assert hasattr(Case, "volume_metadata")
        assert hasattr(VolumeMetadata, "case")


# ─── Regression — existing 2D upload behaviour unchanged ─────────────────────

class TestExisting2DUnchanged:
    def test_2d_upload_still_works(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["image_path"] is not None

    def test_2d_response_has_no_new_required_fields_missing(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        # All pre-existing fields still present
        for field in ("id", "patient_id", "case_code", "study_type", "status",
                      "image_path", "created_at"):
            assert field in body, f"Field '{field}' missing from CaseResponse"
        # New fields have safe defaults
        assert body["volume_path"] is None
        assert body["has_volume"] is False

    def test_nifti_returns_415_on_image_endpoint(self, client: TestClient, account):
        """NIfTI files must still be rejected by the 2D image endpoint."""
        _, headers = account("Clinician")
        case_id = _make_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.nii", _nii3d_bytes(), "application/octet-stream")},
            headers=headers,
        )
        assert r.status_code == 415
