"""Phase 1 contracts and real auth dependencies with a database-free session double.

Local execution uses --noconftest, bypassing the existing migration fixtures.
"""
from copy import deepcopy
import json
from pathlib import Path
import re
from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.core.roles import Role
from app.core.security import create_access_token
from app.database.session import get_db
from app.main import app
from app.models import User
from app.schemas.stenosis import (
    AnalysisRequest, AnalysisResult, CapabilitiesResponse, Capability, Measurement,
    VolumeGeometry,
)
from app.services.stenosis import capabilities, validate_source_association

RUN_ID = "12345678-1234-4567-890a-123456789abc"
SOURCE = {"case_id": 1, "image_reference": "case-volume", "source_sha256": "a" * 64,
          "parent_segmentation_result_id": RUN_ID}
GEOMETRY = {"shape": [10, 20, 30], "array_axis_order": "nifti_i_j_k",
            "world_convention": "RAS", "world_unit": "mm",
            "affine": [[.5, 0, 0, 10], [0, 1, 0, 20], [0, 0, 2, 30], [0, 0, 0, 1]]}
REASON = {"code": "not_implemented", "message": "No verified method is integrated."}


def result_payload(state="completed"):
    return {"contract_version": "1.0", "analysis_id": RUN_ID, "state": state,
            "provenance": {"contract_version": "1.0", "source": deepcopy(SOURCE),
                           "geometry": deepcopy(GEOMETRY), "method_id": "test-method",
                           "method_version": "test-v1", "created_at": "2026-10-31T00:00:00Z"},
            "lesions": [] if state == "completed" else None,
            "unavailable_reason": deepcopy(REASON) if state in {"unavailable", "failed", "not_performed"} else None}


def lesion_payload():
    missing = {"value": None, "unit": "mm", "unavailable_reason": deepcopy(REASON)}
    return {"lesion_id": RUN_ID,
            "location": {"coordinate_convention": "array_ijk_and_RAS_mm", "voxel_indices": [2, 3, 4],
                         "world_coordinates": [11, 23, 38], "slice_axis": 2, "slice_index": 4},
            "localization_unavailable_reason": None,
            "measurements": {"reference_diameter": deepcopy(missing), "minimum_lumen_diameter": deepcopy(missing),
                             "percentage_narrowing": {**deepcopy(missing), "unit": "percent"}},
            "severity": {"category": None, "unavailable_reason": deepcopy(REASON)},
            "explanation": {"artifact_id": None, "unavailable_reason": deepcopy(REASON)}}


class AuthSession:
    def __init__(self):
        self.user = SimpleNamespace(id=1, role="Clinician", token_version=0, is_active=True)
        self.reads = 0

    def get(self, model, key):
        assert model is User  # No case, model-provider or capability DB queries.
        self.reads += 1
        return self.user if key == self.user.id else None

    def add(self, event):
        pass  # Existing rejection auditing is kept off the real database.

    def commit(self):
        pass


@pytest.fixture
def safe_client():
    session = AuthSession()
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: session
    try:
        with TestClient(app) as client:
            yield client, session
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def authorization(role="Clinician", version=0):
    return {"Authorization": "Bearer " + create_access_token("1", role, version)}


@pytest.mark.parametrize("role", list(Role))
def test_capabilities_use_existing_auth_for_all_case_readers(safe_client, role):
    client, session = safe_client
    session.user.role = role
    response = client.get("/api/v1/stenosis/capabilities", headers=authorization(role))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == capabilities().model_dump(mode="json")
    assert session.reads == 1


def test_capabilities_require_authentication(safe_client):
    client, session = safe_client
    assert client.get("/api/v1/stenosis/capabilities").status_code == 401
    assert client.get("/api/v1/stenosis/capabilities", headers={"Authorization": "Bearer malformed"}).status_code == 401
    assert session.reads == 0


@pytest.mark.parametrize("change", ["inactive", "revoked", "unknown_role", "missing_user"])
def test_capabilities_reject_invalid_sessions(safe_client, change):
    client, session = safe_client
    headers = authorization()
    if change == "inactive": session.user.is_active = False
    if change == "revoked": session.user.token_version = 1
    if change == "unknown_role": session.user.role = "unrecognized"
    if change == "missing_user": session.user.id = 2
    assert client.get("/api/v1/stenosis/capabilities", headers=headers).status_code == 401


def test_no_execution_endpoint_and_typed_openapi(safe_client):
    client, _ = safe_client
    assert client.post("/api/v1/stenosis/capabilities", headers=authorization()).status_code == 405
    assert client.post("/api/v1/stenosis/analyses", headers=authorization()).status_code == 404
    schema = client.get("/openapi.json").json()
    path = schema["paths"]["/api/v1/stenosis/capabilities"]
    assert set(path) == {"get"}
    assert path["get"]["security"] == [{"OAuth2PasswordBearer": []}]
    assert path["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CapabilitiesResponse")


def test_current_registry_is_complete_unavailable_and_independent():
    payload = capabilities().model_dump(mode="json")
    assert payload["contract_version"] == "1.0"
    assert len(payload["capabilities"]) == 9
    for item in payload["capabilities"]:
        assert item["status"] in {"unavailable", "not_integrated"}
        assert item["execution_permitted"] is False
        assert item["availability_reason"]
        assert item["method_id"] is None and item["method_version"] is None
    payload["capabilities"][0]["availability_reason"] = "changed client copy"
    assert capabilities().capabilities[0].availability_reason != "changed client copy"


@pytest.mark.parametrize("field,value", [
    ("contract_version", "2.0"), ("id", "segmentation"), ("display_name", " "),
    ("status", "processing"), ("execution_permitted", True), ("execution_permitted", "false"),
    ("method_id", "unversioned"), ("availability_reason", ""),
])
def test_capability_rejects_invalid_fields(field, value):
    item = capabilities().model_dump(mode="json")["capabilities"][0]
    item[field] = value
    with pytest.raises(ValidationError): Capability.model_validate(item)


@pytest.mark.parametrize("field", ["contract_version", "id", "status", "display_name", "availability_reason", "execution_permitted"])
def test_capability_requires_fields(field):
    item = capabilities().model_dump(mode="json")["capabilities"][0]
    del item[field]
    with pytest.raises(ValidationError): Capability.model_validate(item)


@pytest.mark.parametrize("change", ["missing", "duplicate", "version", "extra"])
def test_response_rejects_incomplete_or_unknown_contract(change):
    payload = capabilities().model_dump(mode="json")
    if change == "missing": payload["capabilities"].pop()
    if change == "duplicate": payload["capabilities"][1] = payload["capabilities"][0]
    if change == "version": del payload["contract_version"]
    if change == "extra": payload["internal_path"] = "/private/storage"
    with pytest.raises(ValidationError): CapabilitiesResponse.model_validate(payload)


def test_available_requires_versioned_method_and_disabled_cannot_execute():
    item = capabilities().model_dump(mode="json")["capabilities"][0]
    with pytest.raises(ValidationError): Capability.model_validate({**item, "status": "available"})
    assert Capability.model_validate({**item, "status": "available", "method_id": "provider", "method_version": "v1", "execution_permitted": True})
    with pytest.raises(ValidationError): Capability.model_validate({**item, "status": "disabled", "execution_permitted": True})


def test_future_request_and_record_binding():
    request = AnalysisRequest(contract_version="1.0", source=SOURCE)
    record = SimpleNamespace(id=RUN_ID, case_id=1, metadata_json={"source_sha256": "a" * 64})
    validate_source_association(request, record)
    for changes in ({"case_id": 2}, {"id": str(UUID(int=1))}, {"metadata_json": {"source_sha256": "b" * 64}}):
        with pytest.raises(ValueError): validate_source_association(request, SimpleNamespace(**{**vars(record), **changes}))


@pytest.mark.parametrize("field,value", [("case_id", 0), ("case_id", True), ("source_sha256", "bad"),
    ("parent_segmentation_result_id", "bad"), ("image_reference", "C:/private/ct.nii")])
def test_future_request_invalid_source(field, value):
    with pytest.raises(ValidationError): AnalysisRequest(contract_version="1.0", source={**SOURCE, field: value})


def test_future_request_rejects_options_and_unknown_version():
    with pytest.raises(ValidationError): AnalysisRequest(contract_version="2.0", source=SOURCE)
    with pytest.raises(ValidationError): AnalysisRequest(contract_version="1.0", source=SOURCE, threshold=.7)


@pytest.mark.parametrize("state", ["completed", "queued", "running", "failed", "unavailable", "not_performed"])
def test_future_states_are_distinct(state):
    result = AnalysisResult.model_validate(result_payload(state))
    assert (result.lesions == []) if state == "completed" else (result.lesions is None)


def test_unavailable_result_does_not_require_invented_method_or_geometry():
    payload = result_payload("unavailable")
    payload["provenance"].update(method_id=None, method_version=None, geometry=None)
    assert AnalysisResult.model_validate(payload).provenance.method_id is None
    payload.update(state="completed", lesions=[], unavailable_reason=None)
    with pytest.raises(ValidationError): AnalysisResult.model_validate(payload)


def test_documented_examples_match_registry_and_future_schemas():
    document = (Path(__file__).resolve().parents[2] / "docs" / "stenosis-contract-v1.md").read_text(encoding="utf-8")
    examples = [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", document, re.S)]
    assert examples[0] == capabilities().model_dump(mode="json")
    AnalysisRequest.model_validate(examples[1])
    AnalysisResult.model_validate(examples[2])


@pytest.mark.parametrize("change", ["empty_failed", "missing_completed", "reason_completed", "missing_failure_reason", "invalid_state", "naive_date", "path"])
def test_future_result_rejects_ambiguous_or_unsafe_states(change):
    payload = result_payload()
    if change == "empty_failed": payload.update(state="failed", unavailable_reason=REASON)
    if change == "missing_completed": payload["lesions"] = None
    if change == "reason_completed": payload["unavailable_reason"] = REASON
    if change == "missing_failure_reason": payload.update(state="unavailable", lesions=None)
    if change == "invalid_state": payload["state"] = "negative"
    if change == "naive_date": payload["provenance"]["created_at"] = "2026-10-31T00:00:00"
    if change == "path": payload["provenance"]["checkpoint_path"] = "/private/weights.pt"
    with pytest.raises(ValidationError): AnalysisResult.model_validate(payload)


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), 101])
def test_invalid_percentage_values(value):
    with pytest.raises(ValidationError): Measurement(value=value, unit="percent", unavailable_reason=None,
        method_id="test", method_version="v1", definition="Test definition only")


def test_missing_measurements_are_not_zero_and_values_need_provenance():
    assert Measurement(value=None, unit="mm", unavailable_reason=REASON).value is None
    with pytest.raises(ValidationError): Measurement(value=0, unit="mm", unavailable_reason=REASON)
    with pytest.raises(ValidationError): Measurement(value=None, unit="mm", unavailable_reason=None)
    with pytest.raises(ValidationError): Measurement(value=1, unit="mm", unavailable_reason=None)
    with pytest.raises(ValidationError): Measurement(value=5, unit="percent", unavailable_reason=None, method_id="test", method_version="v1")


def test_lesion_contract_accepts_explicit_unavailable_fields():
    payload = result_payload()
    payload["lesions"] = [lesion_payload()]
    assert len(AnalysisResult.model_validate(payload).lesions) == 1


@pytest.mark.parametrize("change", ["bounds", "world", "slice", "axis_only", "units", "severity", "explanation", "explanation_source", "duplicate"])
def test_lesion_rejects_inconsistent_coordinates_measurements_or_explanations(change):
    payload = result_payload()
    lesion = lesion_payload()
    payload["lesions"] = [lesion]
    if change == "bounds": lesion["location"]["voxel_indices"][0] = 10
    if change == "world": lesion["location"]["world_coordinates"][0] = 999
    if change == "slice": lesion["location"]["slice_index"] = 5
    if change == "axis_only": del lesion["location"]["slice_index"]
    if change == "units": lesion["measurements"]["reference_diameter"]["unit"] = "percent"
    if change == "severity": lesion["severity"] = {"category": "invented", "unavailable_reason": None}
    if change == "explanation": lesion["explanation"] = {"artifact_id": RUN_ID, "unavailable_reason": None}
    if change == "explanation_source": lesion["explanation"] = {"artifact_id": RUN_ID, "unavailable_reason": None,
        "method_id": "test-attribution", "method_version": "v1", "explained_target": "Test target",
        "geometry": deepcopy(GEOMETRY), "source_sha256": "b" * 64}
    if change == "duplicate": payload["lesions"].append(deepcopy(lesion))
    with pytest.raises(ValidationError): AnalysisResult.model_validate(payload)


@pytest.mark.parametrize("change", ["units", "affine", "singular", "nan", "shape"])
def test_geometry_declares_valid_world_and_array_semantics(change):
    payload = deepcopy(GEOMETRY)
    if change == "units": payload["world_unit"] = "unknown"
    if change == "affine": payload["affine"][3][3] = 0
    if change == "singular": payload["affine"][0] = [0, 0, 0, 0]
    if change == "nan": payload["affine"][0][0] = float("nan")
    if change == "shape": payload["shape"][0] = 0
    with pytest.raises(ValidationError): VolumeGeometry.model_validate(payload)
