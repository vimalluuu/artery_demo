from datetime import datetime, timedelta, timezone

import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.security import decode_access_token, hash_password, verify_password
from app.models import AuditEvent, User
from conftest import PASSWORD

PREFIX = "/api/v1/auth"


def registration(**changes):
    return {"full_name": "  Jane Smith  ", "email": "Jane@example.org",
            "password": PASSWORD, **changes}


def test_register_hash_duplicate_and_login(client, db):
    response = client.post(PREFIX + "/register", json=registration())
    assert response.status_code == 201
    assert response.json()["full_name"] == "Jane Smith"
    assert response.json()["role"] == "Clinician"
    assert "password_hash" not in response.text and PASSWORD not in response.text
    user = db.scalar(select(User))
    assert user.email == "jane@example.org"
    assert user.password_hash.startswith("$argon2id$")
    assert verify_password(PASSWORD, user.password_hash)
    assert not verify_password("wrong", user.password_hash)
    assert client.post(PREFIX + "/register", json=registration(email="JANE@example.org")).status_code == 409
    for body in [{"json": {"email": "JANE@example.org", "password": PASSWORD}},
                 {"data": {"username": "jane@example.org", "password": PASSWORD}}]:
        login = client.post(PREFIX + "/login", **body)
        assert login.status_code == 200
        data = login.json()
        assert data["user"]["id"] == user.id and data["token_type"] == "bearer"
        claims = decode_access_token(data["access_token"])
        assert claims["sub"] == str(user.id) and claims["exp"] > claims["iat"]
        assert client.get(PREFIX + "/me", headers={"Authorization": "Bearer " + data["access_token"]}).status_code == 200


@pytest.mark.parametrize("changes", [
    {"email": "invalid"}, {"password": "xyz123"}, {"password": "x" * 129},
    {"full_name": "  "}, {"role": "Admin"}, {"role": "Administrator"},
    {"role": "doctor"}, {"is_active": True}, {"token_version": 0},
])
def test_registration_validation_no_secrets(client, changes):
    data = registration(**changes)
    response = client.post(PREFIX + "/register", json=data)
    assert response.status_code == 422
    assert data["password"] not in response.text
    assert all("input" not in error for error in response.json()["detail"])


@pytest.mark.parametrize("role", ["Clinician", "Researcher", "DataScientist"])
def test_non_admin_registration_roles(client, role):
    response = client.post(PREFIX + "/register", json=registration(role=role))
    assert response.status_code == 201 and response.json()["role"] == role


def test_registration_concurrent_conflict_rolls_back(client, monkeypatch):
    from sqlalchemy.orm import Session
    original = Session.flush
    def conflict(self, *args, **kwargs):
        if any(isinstance(obj, User) for obj in self.new):
            raise IntegrityError("insert", {}, Exception("private database error"))
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Session, "flush", conflict)
    response = client.post(PREFIX + "/register", json=registration())
    assert response.status_code == 409
    assert "private" not in response.text


@pytest.mark.parametrize("active, password", [(True, "incorrect"), (False, PASSWORD)])
def test_invalid_credentials(client, account, active, password):
    user, _ = account(active=active)
    response = client.post(PREFIX + "/login", json={"email": user.email, "password": password})
    assert response.status_code == 401
    unknown = client.post(PREFIX + "/login", json={"email": "unknown@example.org", "password": password})
    assert response.json() == unknown.json()
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("body", [
    {"json": {}}, {"json": []}, {"json": {"email": "invalid", "password": PASSWORD}},
    {"content": "{broken", "headers": {"Content-Type": "application/json"}},
])
def test_malformed_login(client, body):
    response = client.post(PREFIX + "/login", **body)
    assert response.status_code == 422 and PASSWORD not in response.text


def test_unsupported_login_and_no_token(client):
    assert client.post(PREFIX + "/login", content="credentials").status_code == 415
    assert client.get(PREFIX + "/me").status_code == 401


@pytest.mark.parametrize("variant", [
    "expired", "wrong_signature", "wrong_algorithm", "missing_exp", "missing_sub",
    "missing_iat", "missing_ver", "wrong_audience", "wrong_issuer", "future_iat",
    "invalid_subject", "huge_subject", "unicode_subject", "zero_subject",
    "negative_version", "boolean_version", "nonsense",
])
def test_invalid_tokens(client, account, variant):
    user, headers = account()
    claims = decode_access_token(headers["Authorization"].split()[1])
    key, algorithm = settings.SECRET_KEY.get_secret_value(), "HS256"
    if variant == "expired": claims["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif variant == "wrong_signature": key = "another-test-signing-key-with-32-bytes"
    elif variant == "wrong_algorithm": algorithm = "HS384"
    elif variant.startswith("missing_"): claims.pop(variant.removeprefix("missing_"))
    elif variant == "wrong_audience": claims["aud"] = "another-app"
    elif variant == "wrong_issuer": claims["iss"] = "another-issuer"
    elif variant == "future_iat": claims["iat"] = datetime.now(timezone.utc) + timedelta(hours=1)
    elif variant == "invalid_subject": claims["sub"] = "invalid"
    elif variant == "huge_subject": claims["sub"] = "9" * 10000
    elif variant == "unicode_subject": claims["sub"] = "?"
    elif variant == "zero_subject": claims["sub"] = "0"
    elif variant == "negative_version": claims["ver"] = -1
    elif variant == "boolean_version": claims["ver"] = False
    token = "nonsense" if variant == "nonsense" else jwt.encode(claims, key, algorithm=algorithm)
    response = client.get(PREFIX + "/me", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or expired access token"}


def test_disabled_deleted_users_and_role_claim(client, account, db):
    user, headers = account("Researcher")
    claims = decode_access_token(headers["Authorization"].split()[1])
    claims["role"] = "Admin"
    forged_role = jwt.encode(claims, settings.SECRET_KEY.get_secret_value(), algorithm="HS256")
    assert client.get("/api/v1/admin/users", headers={"Authorization": "Bearer " + forged_role}).status_code == 403
    user.is_active = False
    db.commit()
    assert client.get(PREFIX + "/me", headers=headers).status_code == 401
    db.delete(user)
    db.commit()
    assert client.get(PREFIX + "/me", headers=headers).status_code == 401


def test_logout_revokes_all_sessions(client, account):
    user, first = account()
    second = client.post(PREFIX + "/login", json={"email": user.email, "password": PASSWORD}).json()
    assert client.post(PREFIX + "/logout", headers=first).status_code == 204
    for headers in [first, {"Authorization": "Bearer " + second["access_token"]}]:
        assert client.get(PREFIX + "/me", headers=headers).status_code == 401
    assert client.post(PREFIX + "/login", json={"email": user.email, "password": PASSWORD}).status_code == 200


def test_profile_password_and_audit(client, account, db):
    user, headers = account()
    assert client.patch(PREFIX + "/me", headers=headers, json={"full_name": "New Name", "role": "Admin"}).status_code == 422
    response = client.patch(PREFIX + "/me", headers=headers, json={
        "full_name": "New Name", "institution": "Institute", "department": "Research"})
    assert response.status_code == 200 and response.json()["full_name"] == "New Name"
    new_password = "new-long-password-456"
    assert client.post(PREFIX + "/password", headers=headers, json={
        "current_password": "wrong", "new_password": new_password}).status_code == 400
    response = client.post(PREFIX + "/password", headers=headers, json={
        "current_password": PASSWORD, "new_password": new_password})
    assert response.status_code == 200
    assert client.get(PREFIX + "/me", headers=headers).status_code == 401
    assert client.get(PREFIX + "/me", headers={"Authorization": "Bearer " + response.json()["access_token"]}).status_code == 200
    assert client.post(PREFIX + "/login", json={"email": user.email, "password": PASSWORD}).status_code == 401
    assert client.post(PREFIX + "/login", json={"email": user.email, "password": new_password}).status_code == 200
    events = db.scalars(select(AuditEvent)).all()
    assert {"auth.profile_updated", "auth.password_changed", "auth.password_change_failed"} <= {e.action for e in events}
    assert PASSWORD not in str([e.__dict__ for e in events])


def test_hash_salts_and_malformed_hash():
    a, b = hash_password(PASSWORD), hash_password(PASSWORD)
    assert a != b and verify_password(PASSWORD, a) and verify_password(PASSWORD, b)
    assert not verify_password(PASSWORD, "malformed")
