from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Case, User
from app.services.image_preprocessing import preprocess_image, normalize_image, ImagePreprocessingError


def seed_case(client, account):
    _, headers = account()
    patient = client.post("/api/v1/patients", headers=headers, json={
        "patient_code": "P-001", "display_name": "Deidentified Test"})
    assert patient.status_code == 201
    case = client.post("/api/v1/cases", headers=headers, json={"patient_id": patient.json()["id"], "case_code": "C-001"})
    assert case.status_code == 201
    return case.json(), headers


@pytest.mark.parametrize("role", ["Clinician", "Researcher", "DataScientist", "Admin"])
def test_complete_role_matrix(client, account, role):
    case, clinician = seed_case(client, account)
    user, headers = account(role)
    for route in ["/auth/me", "/cases", f"/cases/{case['id']}"]:
        assert client.get("/api/v1" + route, headers=headers).status_code == 200
    clinical = role in {"Clinician", "Admin"}
    assert client.get("/api/v1/patients", headers=headers).status_code == (200 if clinical else 403)
    assert client.post("/api/v1/patients", headers=headers, json={
        "patient_code": "P-002", "display_name": "Test"}).status_code == (201 if clinical else 403)
    assert client.post("/api/v1/cases", headers=headers, json={
        "patient_id": case["patient_id"], "case_code": "C-002"}).status_code == (201 if clinical else 403)
    image = BytesIO()
    Image.new("L", (10, 12)).save(image, format="PNG")
    assert client.post(f"/api/v1/cases/{case['id']}/image", headers=headers,
                       files={"file": ("image.png", image.getvalue(), "image/png")}).status_code == (200 if clinical else 403)
    # All four roles read image metadata; upload once with the authorized clinician.
    client.post(f"/api/v1/cases/{case['id']}/image", headers=clinician,
                files={"file": ("image.png", image.getvalue(), "image/png")})
    assert client.get(f"/api/v1/cases/{case['id']}/image/metadata", headers=headers).status_code == 200
    for route in ["/admin/users", "/admin/audit"]:
        assert client.get("/api/v1" + route, headers=headers).status_code == (200 if role == "Admin" else 403)
    assert client.patch(f"/api/v1/admin/users/{user.id}", headers=headers,
                        json={"role": role, "is_active": True}).status_code == (200 if role == "Admin" else 403)


@pytest.mark.parametrize("method,path,payload", [
    ("get", "/patients", None), ("post", "/patients", {"patient_code": "P1", "display_name": "Test"}),
    ("get", "/cases", None), ("post", "/cases", {"patient_id": 1, "case_code": "C1"}),
    ("get", "/cases/1", None), ("get", "/cases/1/image/metadata", None),
    ("get", "/admin/users", None), ("get", "/admin/audit", None),
    ("patch", "/admin/users/1", {"role": "Admin", "is_active": True}),
    ("post", "/auth/logout", None), ("patch", "/auth/me", {"full_name": "Test Name"}),
    ("post", "/auth/password", {"current_password": "anything", "new_password": "valid-long-password"}),
])
def test_missing_authentication(client, method, path, payload):
    assert client.request(method, "/api/v1" + path, json=payload).status_code == 401


def test_upload_requires_auth(client):
    assert client.post("/api/v1/cases/1/image", files={"file": ("x.png", b"data")}).status_code == 401


def test_admin_changes_take_effect_and_revoke(client, account):
    admin, headers = account("Admin")
    user, old_headers = account()
    route = f"/api/v1/admin/users/{user.id}"
    response = client.patch(route, headers=headers, json={"role": "DataScientist", "is_active": True})
    assert response.status_code == 200 and response.json()["role"] == "DataScientist"
    assert client.get("/api/v1/auth/me", headers=old_headers).status_code == 401
    assert client.patch(f"/api/v1/admin/users/{admin.id}", headers=headers,
                        json={"role": "Researcher", "is_active": True}).status_code == 409
    assert client.patch(route, headers=headers, json={"role": "superuser", "is_active": True}).status_code == 422
    assert client.patch("/api/v1/admin/users/999999", headers=headers,
                        json={"role": "Admin", "is_active": True}).status_code == 404
    response = client.patch(route, headers=headers, json={"role": "DataScientist", "is_active": False})
    assert response.status_code == 200 and not response.json()["is_active"]


def test_case_constraints_and_conflicts(client, account, db):
    case, headers = seed_case(client, account)
    assert client.post("/api/v1/cases", headers=headers, json={
        "patient_id": 999999, "case_code": "new"}).status_code == 404
    assert client.post("/api/v1/cases", headers=headers, json={
        "patient_id": case["patient_id"], "case_code": "C-001"}).status_code == 409
    assert client.post("/api/v1/patients", headers=headers, json={
        "patient_code": "P-001", "display_name": "Other"}).status_code == 409
    assert client.get("/api/v1/cases/999999", headers=headers).status_code == 404
    assert client.get(f"/api/v1/cases/{case['id']}/image/metadata", headers=headers).status_code == 404
    db.add(Case(patient_id=999999, case_code="FK-test"))
    with pytest.raises(IntegrityError): db.commit()
    db.rollback()
    db.add(User(full_name="Invalid Role", email="role@example.org", password_hash="hash", role="superuser"))
    with pytest.raises(IntegrityError): db.commit()
    db.rollback()


@pytest.mark.parametrize("fmt,extension", [("PNG", ".png"), ("JPEG", ".jpg"), ("TIFF", ".tiff")])
def test_image_upload_metadata_replace_preprocessing(client, account, fmt, extension):
    case, headers = seed_case(client, account)
    image = BytesIO()
    Image.new("RGB", (16, 12), color=(64, 128, 192)).save(image, format=fmt)
    route = f"/api/v1/cases/{case['id']}/image"
    response = client.post(route, headers=headers, files={"file": ("../../image" + extension, image.getvalue())})
    assert response.status_code == 200
    old_path = Path(response.json()["image_path"])
    assert old_path.is_file()
    meta = client.get(route + "/metadata", headers=headers).json()
    assert (meta["width"], meta["height"], meta["channels"]) == (16, 12, 3)
    tensor = preprocess_image(old_path, target_size=(8, 6), grayscale=True)
    assert tensor.shape == (6, 8) and tensor.dtype == np.float32
    assert 0 <= tensor.min() <= tensor.max() <= 1
    assert client.post(route, headers=headers, files={"file": ("new" + extension, image.getvalue())}).status_code == 200
    assert not old_path.exists()


@pytest.mark.parametrize("name,data,status", [("x.exe", b"x", 415), ("x.png", b"", 400), ("x.png", b"invalid", 400)])
def test_invalid_upload(client, account, name, data, status):
    case, headers = seed_case(client, account)
    assert client.post(f"/api/v1/cases/{case['id']}/image", headers=headers,
                       files={"file": (name, data)}).status_code == status


def test_path_escape_and_preprocessing_errors(client, account, db, tmp_path):
    case, headers = seed_case(client, account)
    row = db.get(Case, case["id"])
    row.image_path = str(tmp_path / "outside.png")
    db.commit()
    assert client.get(f"/api/v1/cases/{case['id']}/image/metadata", headers=headers).status_code == 400
    for array in [np.array([], dtype=np.uint8), np.array([float("nan")]), np.array([2.0]), np.array([1], dtype=np.int32)]:
        with pytest.raises(ImagePreprocessingError): normalize_image(array)
