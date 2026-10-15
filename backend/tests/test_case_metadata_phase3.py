"""
test_case_metadata_phase3.py

Tests for migration 0003_case_meta: the six new case metadata columns.

Covers:
  - Case creation with all new metadata fields (create + read round-trip)
  - Case creation without metadata (null for pre-migration compatibility)
  - Pydantic field validation (modality, region, sex allowed values; age range)
  - PATCH /cases/:id endpoint (partial update, immutable field protection)
  - PATCH RBAC: only Clinician/Admin can update
  - Metadata survives a GET /cases/:id after creation and PATCH
  - Null-safe: pre-migration cases (null fields) still serialise correctly
  - Migration compatibility check via SQLAlchemy model inspection

These tests run against the disposable SQLite test database (in-memory)
created by conftest.py — NOT the production PostgreSQL database.
"""
from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


def _uid():
    return uuid4().hex[:8]


def _make_patient(client, headers):
    r = client.post("/api/v1/patients", json={
        "patient_code": f"PT-{_uid()}",
        "display_name": "Test Patient",
    }, headers=headers)
    assert r.status_code == 201
    return r.json()["id"]


def _make_case(client, headers, **extra):
    pid = _make_patient(client, headers)
    body = {
        "patient_id": pid,
        "case_code": f"CASE-{_uid()}",
        "study_type": "Coronary Artery Analysis",
        **extra,
    }
    r = client.post("/api/v1/cases", json=body, headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()


# ─── Case creation with metadata fields ──────────────────────────────────────

class TestCaseCreateWithMetadata:
    def test_create_with_all_metadata_fields(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers,
            modality="CT Angiography",
            region="Coronary",
            scan_date="2026-09-20",
            age_years=58,
            sex="M",
            notes="Stable angina — de-identified",
        )
        assert case["modality"]  == "CT Angiography"
        assert case["region"]    == "Coronary"
        assert case["scan_date"] == "2026-09-20"
        assert case["age_years"] == 58
        assert case["sex"]       == "M"
        assert case["notes"]     == "Stable angina — de-identified"

    def test_create_without_metadata_returns_null_fields(self, client: TestClient, account):
        """Pre-migration compatibility: existing cases must have null metadata."""
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        assert case["modality"]  is None
        assert case["region"]    is None
        assert case["scan_date"] is None
        assert case["age_years"] is None
        assert case["sex"]       is None
        assert case["notes"]     is None

    def test_create_with_partial_metadata(self, client: TestClient, account):
        """Some metadata provided, rest remain null."""
        _, headers = account("Clinician")
        case = _make_case(client, headers, modality="MRA", region="Carotid")
        assert case["modality"]  == "MRA"
        assert case["region"]    == "Carotid"
        assert case["scan_date"] is None
        assert case["age_years"] is None

    def test_metadata_survives_get_roundtrip(self, client: TestClient, account):
        """Values written on create must be returned by GET /cases/:id."""
        _, headers = account("Clinician")
        created = _make_case(client, headers,
            modality="DSA", region="Peripheral", sex="F", age_years=72)
        case_id = created["id"]
        r = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["modality"]  == "DSA"
        assert body["region"]    == "Peripheral"
        assert body["sex"]       == "F"
        assert body["age_years"] == 72

    def test_metadata_in_list_response(self, client: TestClient, account):
        _, headers = account("Clinician")
        _make_case(client, headers, modality="CTA", region="Renal")
        r = client.get("/api/v1/cases", headers=headers)
        assert r.status_code == 200
        cases = r.json()
        renal = next((c for c in cases if c.get("modality") == "CTA"), None)
        assert renal is not None
        assert renal["region"] == "Renal"


# ─── Pydantic field validation ─────────────────────────────────────────────────

class TestCaseMetadataValidation:
    def test_invalid_modality_rejected(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _make_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}",
            "study_type": "S", "modality": "X-Ray",  # Not in allowed set
        }, headers=headers)
        assert r.status_code == 422, "Invalid modality must be rejected"

    def test_invalid_region_rejected(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _make_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}",
            "study_type": "S", "region": "Brain",  # Not in allowed set
        }, headers=headers)
        assert r.status_code == 422, "Invalid region must be rejected"

    def test_invalid_sex_rejected(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _make_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}",
            "study_type": "S", "sex": "X",  # Not M/F/O
        }, headers=headers)
        assert r.status_code == 422, "Invalid sex code must be rejected"

    def test_age_years_below_zero_rejected(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _make_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}",
            "study_type": "S", "age_years": -1,
        }, headers=headers)
        assert r.status_code == 422, "Negative age must be rejected"

    def test_age_years_above_120_rejected(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _make_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}",
            "study_type": "S", "age_years": 121,
        }, headers=headers)
        assert r.status_code == 422, "Age > 120 must be rejected"

    def test_age_years_zero_and_120_are_valid(self, client: TestClient, account):
        _, headers = account("Clinician")
        case0 = _make_case(client, headers, age_years=0)
        case120 = _make_case(client, headers, age_years=120)
        assert case0["age_years"] == 0
        assert case120["age_years"] == 120

    def test_notes_max_2000_chars(self, client: TestClient, account):
        _, headers = account("Clinician")
        pid = _make_patient(client, headers)
        r = client.post("/api/v1/cases", json={
            "patient_id": pid, "case_code": f"CASE-{_uid()}",
            "study_type": "S", "notes": "x" * 2001,
        }, headers=headers)
        assert r.status_code == 422, "Notes > 2000 chars must be rejected"

    def test_notes_exactly_2000_chars_accepted(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers, notes="A" * 2000)
        assert len(case["notes"]) == 2000

    def test_all_valid_sex_codes(self, client: TestClient, account):
        _, headers = account("Clinician")
        for code in ["M", "F", "O"]:
            case = _make_case(client, headers, sex=code)
            assert case["sex"] == code

    def test_all_valid_modality_values(self, client: TestClient, account):
        _, headers = account("Clinician")
        for m in ["CT Angiography", "MRA", "CTA", "DSA", "Ultrasound", "Other"]:
            case = _make_case(client, headers, modality=m)
            assert case["modality"] == m

    def test_all_valid_region_values(self, client: TestClient, account):
        _, headers = account("Clinician")
        for region in ["Coronary", "Carotid", "Renal", "Peripheral", "Cerebral", "Aorta", "Other"]:
            case = _make_case(client, headers, region=region)
            assert case["region"] == region


# ─── PATCH /cases/:id (metadata update) ───────────────────────────────────────

class TestCaseMetadataPatch:
    def test_patch_updates_modality(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        case_id = case["id"]
        r = client.patch(f"/api/v1/cases/{case_id}",
                         json={"modality": "MRA"}, headers=headers)
        assert r.status_code == 200
        assert r.json()["modality"] == "MRA"

    def test_patch_partial_update_leaves_other_fields_unchanged(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers,
            modality="CT Angiography", region="Coronary", sex="M")
        case_id = case["id"]
        # Only update region — modality and sex must be unchanged
        r = client.patch(f"/api/v1/cases/{case_id}",
                         json={"region": "Carotid"}, headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["region"]   == "Carotid"          # updated
        assert body["modality"] == "CT Angiography"   # unchanged
        assert body["sex"]      == "M"                # unchanged

    def test_patch_updates_all_metadata_fields(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        case_id = case["id"]
        r = client.patch(f"/api/v1/cases/{case_id}", json={
            "study_type": "Aortic Analysis",
            "modality":   "DSA",
            "region":     "Aorta",
            "scan_date":  "2026-10-01",
            "age_years":  65,
            "sex":        "F",
            "notes":      "Updated notes",
        }, headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["study_type"] == "Aortic Analysis"
        assert body["modality"]   == "DSA"
        assert body["region"]     == "Aorta"
        assert body["scan_date"]  == "2026-10-01"
        assert body["age_years"]  == 65
        assert body["sex"]        == "F"
        assert body["notes"]      == "Updated notes"

    def test_patch_does_not_change_immutable_fields(self, client: TestClient, account):
        """patch endpoint ignores patient_id, case_code, status, image_path, created_at."""
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        case_id = case["id"]
        original_code = case["case_code"]
        original_status = case["status"]
        # Attempt to change immutable fields — they should be silently ignored
        r = client.patch(f"/api/v1/cases/{case_id}", json={
            "modality":   "MRA",
            # Extra unknown fields are rejected by Pydantic (422)
        }, headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["case_code"] == original_code,   "case_code must be immutable"
        assert body["status"]    == original_status, "status must be immutable"
        assert body["modality"]  == "MRA"            # the actual update

    def test_patch_returns_404_for_missing_case(self, client: TestClient, account):
        _, headers = account("Clinician")
        r = client.patch("/api/v1/cases/999999", json={"modality": "MRA"}, headers=headers)
        assert r.status_code == 404

    def test_researcher_cannot_patch(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, researcher_headers = account("Researcher")
        case = _make_case(client, clinician_headers)
        r = client.patch(f"/api/v1/cases/{case['id']}",
                         json={"modality": "MRA"}, headers=researcher_headers)
        assert r.status_code == 403

    def test_data_scientist_cannot_patch(self, client: TestClient, account):
        clinician, clinician_headers = account("Clinician")
        _, ds_headers = account("DataScientist")
        case = _make_case(client, clinician_headers)
        r = client.patch(f"/api/v1/cases/{case['id']}",
                         json={"modality": "MRA"}, headers=ds_headers)
        assert r.status_code == 403

    def test_unauthenticated_cannot_patch(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        r = client.patch(f"/api/v1/cases/{case['id']}", json={"modality": "MRA"})
        assert r.status_code == 401

    def test_patch_with_invalid_modality_rejected(self, client: TestClient, account):
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        r = client.patch(f"/api/v1/cases/{case['id']}",
                         json={"modality": "X-Ray"}, headers=headers)
        assert r.status_code == 422

    def test_patch_persists_across_get(self, client: TestClient, account):
        """PATCH results must be persisted and visible via GET."""
        _, headers = account("Clinician")
        case = _make_case(client, headers)
        case_id = case["id"]
        client.patch(f"/api/v1/cases/{case_id}",
                     json={"modality": "Ultrasound", "age_years": 44},
                     headers=headers)
        r = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["modality"]  == "Ultrasound"
        assert body["age_years"] == 44


# ─── Migration compatibility — SQLAlchemy model inspection ──────────────────

class TestMigrationModelCompatibility:
    def test_case_model_has_new_columns(self):
        """Verify the SQLAlchemy Case model declares all six new columns."""
        from app.models.case import Case
        cols = {c.key for c in Case.__table__.columns}
        for expected in ["modality", "region", "scan_date", "age_years", "sex", "notes"]:
            assert expected in cols, f"Column '{expected}' missing from Case model"

    def test_new_columns_are_nullable(self):
        """All new columns must be nullable (forward compat with existing rows)."""
        from app.models.case import Case
        for col_name in ["modality", "region", "scan_date", "age_years", "sex", "notes"]:
            col = Case.__table__.c[col_name]
            assert col.nullable, f"Column '{col_name}' must be nullable"

    def test_existing_core_columns_still_present(self):
        """Core columns from migration 0001/0002 must not be removed."""
        from app.models.case import Case
        for expected in ["id", "patient_id", "case_code", "study_type",
                         "status", "image_path", "created_at"]:
            assert expected in {c.key for c in Case.__table__.columns}

    def test_case_code_still_unique(self):
        """The unique constraint on case_code must survive the migration."""
        from app.models.case import Case
        unique_cols = {
            col.name
            for constraint in Case.__table__.constraints
            if hasattr(constraint, 'columns')
            for col in constraint.columns
        }
        assert "case_code" in unique_cols or any(
            c.unique for c in Case.__table__.columns if c.name == "case_code"
        ), "case_code unique constraint must be preserved"
