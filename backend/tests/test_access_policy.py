"""Verify the frontend policy against the live backend role vocabulary and APIs."""
import json
from pathlib import Path
from typing import get_args

import pytest

from app.core.roles import CASE_READERS, CLINICAL_WRITERS, Role
from app.schemas.auth import UserRegister

POLICY = json.loads((Path(__file__).resolve().parents[2] / "frontend-react/src/constants/access-policy.json").read_text())


def test_frontend_and_backend_share_all_four_roles_and_writer_permissions():
    assert POLICY["roles"] == {role.name: role.value for role in Role}
    assert len(POLICY["roles"]) == 4
    assert set(POLICY["caseReaders"]) == {role.value for role in CASE_READERS}
    assert set(POLICY["clinicalWriters"]) == {role.value for role in CLINICAL_WRITERS}
    assert set(POLICY["publicRegistration"]) == set(get_args(UserRegister.model_fields["role"].annotation))
    assert "Admin" not in POLICY["publicRegistration"]


@pytest.mark.parametrize("role", POLICY["caseReaders"])
def test_policy_matches_case_edits_volume_writes_and_metadata_reads(client, account, role):
    # The existing API matrix also checks patients, cases, image uploads, and admin
    # endpoints. This covers the additional metadata edit and volume endpoints.
    import nibabel as nib
    import numpy as np
    _, clinician = account("Clinician")
    patient = client.post("/api/v1/patients", headers=clinician,
                          json={"patient_code": "POL-001", "display_name": "Policy verification"}).json()
    case = client.post("/api/v1/cases", headers=clinician,
                       json={"patient_id": patient["id"], "case_code": "POL-001"}).json()
    _, headers = account(role)
    can_write = role in POLICY["clinicalWriters"]
    route = f"/api/v1/cases/{case['id']}"
    assert client.patch(route, headers=headers, json={"notes": "Verified"}).status_code == (200 if can_write else 403)
    raw = nib.Nifti1Image(np.zeros((3, 4, 5), dtype=np.int16), np.eye(4)).to_bytes()
    response = client.post(route + "/volume", headers=headers, files={"file": ("test.nii", raw)})
    assert response.status_code == (200 if can_write else 403)
    if not can_write:
        assert client.post(route + "/volume", headers=clinician, files={"file": ("test.nii", raw)}).status_code == 200
    assert client.get(route + "/volume/metadata", headers=headers).status_code == 200


def test_health_endpoints_are_public_monitoring_not_administrator_data(client):
    assert client.get("/health").json() == {"status": "healthy"}
    assert client.get("/health/ready").json() == {"status": "ready"}
