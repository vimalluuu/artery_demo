"""
test_patients_cases_phase2.py

Phase 2 integration tests: patients and cases real API endpoints.

Covers:
  - Patient creation (201) and duplicate code (409)
  - Patient list (Clinician, Admin only — 403 for Researcher/DataScientist)
  - Case creation (201): links patient_id, case_code, study_type
  - Case list (all authenticated roles)
  - Case get by DB id (not case_code)
  - Case image upload (multipart, 201 updated CaseResponse with image_path set)
  - Image metadata after upload
  - RBAC: Researcher/DataScientist cannot create patients, create cases, or upload
  - Error handling: 404 patient not found, 409 duplicate case_code, 415 bad media type
"""
import io
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

# conftest.py provides: client, account, database (autouse)


def _uid():
    return uuid4().hex[:8]


# ─── Patient endpoints ────────────────────────────────────────────────────────

class TestPatientCreate:
    def test_clinician_creates_patient(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.post("/api/v1/patients", json={
            "patient_code": f"PT-{_uid()}",
            "display_name": "Test Patient",
        }, headers=headers)
        assert r.status_code == 201
        body = r.json()
        assert "id" in body
        assert body["patient_code"].startswith("PT-")
        assert body["display_name"] == "Test Patient"
        assert body["notes"] is None

    def test_admin_creates_patient(self, client: TestClient, account):
        _, headers = account("Admin")
        r = client.post("/api/v1/patients", json={
            "patient_code": f"PT-{_uid()}",
            "display_name": "Admin Patient",
            "notes": "Some context",
        }, headers=headers)
        assert r.status_code == 201
        assert r.json()["notes"] == "Some context"

    def test_duplicate_patient_code_returns_409(self, client: TestClient, account):
        _, headers = account("Clinician")
        code = f"PT-{_uid()}"
        client.post("/api/v1/patients", json={"patient_code": code, "display_name": "A"}, headers=headers)
        r = client.post("/api/v1/patients", json={"patient_code": code, "display_name": "B"}, headers=headers)
        assert r.status_code == 409

    def test_researcher_cannot_create_patient(self, client: TestClient, account):
        _, headers = account("Researcher")
        r = client.post("/api/v1/patients", json={
            "patient_code": f"PT-{_uid()}", "display_name": "X",
        }, headers=headers)
        assert r.status_code == 403

    def test_data_scientist_cannot_create_patient(self, client: TestClient, account):
        _, headers = account("DataScientist")
        r = client.post("/api/v1/patients", json={
            "patient_code": f"PT-{_uid()}", "display_name": "X",
        }, headers=headers)
        assert r.status_code == 403

    def test_unauthenticated_cannot_create_patient(self, client: TestClient):
        r = client.post("/api/v1/patients", json={"patient_code": "PT-X", "display_name": "X"})
        assert r.status_code == 401


class TestPatientList:
    def test_clinician_lists_patients(self, client: TestClient, account):
        _, headers = account("Clinician")
        client.post("/api/v1/patients", json={"patient_code": f"PT-{_uid()}", "display_name": "A"}, headers=headers)
        r = client.get("/api/v1/patients", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1

    def test_researcher_cannot_list_patients(self, client: TestClient, account):
        _, headers = account("Researcher")
        r = client.get("/api/v1/patients", headers=headers)
        assert r.status_code == 403


# ─── Case endpoints ───────────────────────────────────────────────────────────

def _create_patient(client, headers):
    r = client.post("/api/v1/patients", json={
        "patient_code": f"PT-{_uid()}", "display_name": "Test",
    }, headers=headers)
    assert r.status_code == 201
    return r.json()["id"]


class TestCaseCreate:
    def test_clinician_creates_case(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _create_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid,
            "case_code": f"CASE-{_uid()}",
            "study_type": "Coronary Artery Analysis",
        }, headers=headers)
        assert r.status_code == 201
        body = r.json()
        assert "id" in body
        assert isinstance(body["id"], int), "id must be integer DB PK"
        assert body["patient_id"] == pid
        assert body["status"] == "pending", (
            "Backend stores status as lowercase — the frontend adapter title-cases it"
        )
        assert body["image_path"] is None
        assert "created_at" in body

    def test_case_code_is_distinct_from_db_id(self, client: TestClient, account):
        """case_code is a string label; id is the integer primary key."""
        _, headers = account("Clinician")
        pid = _create_patient(client, headers)
        code = f"CASE-LABEL-{_uid()}"
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": code, "study_type": "S",
        }, headers=headers)
        assert r.status_code == 201
        body = r.json()
        assert body["case_code"] == code, "case_code is the human label"
        assert isinstance(body["id"], int), "id is the numeric PK used in URLs"
        assert str(body["id"]) != code, "id and case_code are different values"

    def test_duplicate_case_code_returns_409(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _create_patient(client, headers)
        code = f"CASE-{_uid()}"
        client.post("/api/v1/cases", json={"patient_id": pid, "case_code": code, "study_type": "S"}, headers=headers)
        r = client.post("/api/v1/cases", json={"patient_id": pid, "case_code": code, "study_type": "S"}, headers=headers)
        assert r.status_code == 409

    def test_missing_patient_returns_404(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.post("/api/v1/cases", json={
            "patient_id": 999999, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=headers)
        assert r.status_code == 404

    def test_researcher_cannot_create_case(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, researcher_headers = account("Researcher")
        pid = _create_patient(client, clinician_headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=researcher_headers)
        assert r.status_code == 403

    def test_data_scientist_cannot_create_case(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, ds_headers = account("DataScientist")
        pid = _create_patient(client, clinician_headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=ds_headers)
        assert r.status_code == 403


class TestCaseList:
    def _setup_case(self, client, headers):
        pid = _create_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=headers)
        assert r.status_code == 201
        return r.json()["id"]

    def test_clinician_lists_cases(self, client: TestClient, account):
        _, headers = account("Clinician")
        self._setup_case(client, headers)
        r = client.get("/api/v1/cases", headers=headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_researcher_can_list_cases(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, researcher_headers = account("Researcher")
        self._setup_case(client, clinician_headers)
        r = client.get("/api/v1/cases", headers=researcher_headers)
        assert r.status_code == 200

    def test_data_scientist_can_list_cases(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, ds_headers = account("DataScientist")
        self._setup_case(client, clinician_headers)
        r = client.get("/api/v1/cases", headers=ds_headers)
        assert r.status_code == 200

    def test_unauthenticated_cannot_list_cases(self, client: TestClient):
        r = client.get("/api/v1/cases")
        assert r.status_code == 401


class TestCaseGet:
    def test_get_case_by_integer_id(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _create_patient(client, headers)
        code = f"CASE-{_uid()}"
        create_r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": code, "study_type": "Renal Artery Analysis",
        }, headers=headers)
        case_id = create_r.json()["id"]
        r = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == case_id
        assert body["case_code"] == code
        assert body["study_type"] == "Renal Artery Analysis"

    def test_get_nonexistent_case_returns_404(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.get("/api/v1/cases/999999", headers=headers)
        assert r.status_code == 404

    def test_researcher_can_read_case(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, researcher_headers = account("Researcher")
        pid = _create_patient(client, clinician_headers)
        create_r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=clinician_headers)
        case_id = create_r.json()["id"]
        r = client.get(f"/api/v1/cases/{case_id}", headers=researcher_headers)
        assert r.status_code == 200


# ─── Image upload ─────────────────────────────────────────────────────────────

def _minimal_png() -> bytes:
    """1×1 white PNG — minimal valid file for upload tests."""
    import base64
    # Pre-encoded 1x1 white PNG (67 bytes)
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    )


class TestCaseImageUpload:
    def _create_case(self, client, headers):
        pid = _create_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=headers)
        assert r.status_code == 201
        return r.json()["id"]

    def test_clinician_uploads_png(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = self._create_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["image_path"] is not None, "image_path must be set after upload"
        assert body["id"] == case_id

    def test_upload_sets_image_path_on_case(self, client: TestClient, account):
        """After upload, GET /cases/:id must reflect the updated image_path."""
        _, headers = account("Clinician")
        case_id = self._create_case(client, headers)
        # Verify no image before upload
        before = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert before["image_path"] is None
        # Upload
        client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        after = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        assert after["image_path"] is not None

    def test_researcher_cannot_upload_image(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, researcher_headers = account("Researcher")
        case_id = self._create_case(client, clinician_headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=researcher_headers,
        )
        assert r.status_code == 403

    def test_upload_unsupported_extension_returns_415(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = self._create_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("report.pdf", b"%PDF-1", "application/pdf")},
            headers=headers,
        )
        assert r.status_code == 415

    def test_upload_empty_file_returns_400(self, client: TestClient, account):
        _, headers = account("Clinician")
        case_id = self._create_case(client, headers)
        r = client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("empty.png", b"", "image/png")},
            headers=headers,
        )
        assert r.status_code == 400

    def test_upload_to_missing_case_returns_404(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.post(
            "/api/v1/cases/999999/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        assert r.status_code == 404


class TestCaseImageMetadata:
    def test_metadata_returns_404_when_no_image(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _create_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=headers)
        case_id = r.json()["id"]
        meta_r = client.get(f"/api/v1/cases/{case_id}/image/metadata", headers=headers)
        assert meta_r.status_code == 404

    def test_metadata_after_upload_contains_expected_fields(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _create_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=headers)
        case_id = r.json()["id"]
        client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=headers,
        )
        meta_r = client.get(f"/api/v1/cases/{case_id}/image/metadata", headers=headers)
        assert meta_r.status_code == 200
        meta = meta_r.json()
        assert meta["case_id"] == case_id
        assert meta["format"] == "PNG"
        assert meta["width"] == 1
        assert meta["height"] == 1
        assert meta["file_size_bytes"] > 0
        assert "pixel_dtype" in meta

    def test_researcher_can_read_image_metadata(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, researcher_headers = account("Researcher")
        pid = _create_patient(client, clinician_headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}", "study_type": "S",
        }, headers=clinician_headers)
        case_id = r.json()["id"]
        client.post(
            f"/api/v1/cases/{case_id}/image",
            files={"file": ("scan.png", _minimal_png(), "image/png")},
            headers=clinician_headers,
        )
        meta_r = client.get(f"/api/v1/cases/{case_id}/image/metadata", headers=researcher_headers)
        assert meta_r.status_code == 200
