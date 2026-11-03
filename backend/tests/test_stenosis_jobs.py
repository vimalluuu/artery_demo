"""Real disposable-PostgreSQL lifecycle tests. No provider execution occurs."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
import hashlib
from threading import Barrier
from types import SimpleNamespace
from uuid import UUID, uuid4

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi import HTTPException
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.core.roles import Role
from app.database.session import Base, engine, SessionLocal
from app.main import app
from app.models import Case, Patient, SegmentationResult, StenosisAnalysisJob
from app.routers.segmentation import VOLUME_DIR, UPLOAD_DIR
from app.schemas.stenosis import AnalysisRequest
from app.services import stenosis_jobs as jobs
from app.services.source_fingerprint import source_sha256
from app.services.stenosis_runtime import ExecutionRuntime, get_runtime


@pytest.fixture(autouse=True)
def postgres_only():
    if engine.dialect.name != "postgresql":
        pytest.skip("Requires disposable PostgreSQL; SQLite does not verify locks/concurrency")


class NeverExecutedProvider:
    method_id, method_version, checkpoint_sha256 = "test-only-provider", "v1", None

    def execute(self, analysis_id, source):
        raise AssertionError("Tests and HTTP acceptance must never execute inference")


@pytest.fixture
def runtime():
    # Test-only durable result fixture, outside application metadata/migrations.
    metadata = sa.MetaData()
    table = sa.Table("test_stenosis_result_fixture", metadata, sa.Column("id", sa.String(36), primary_key=True), sa.Column("payload", sa.JSON(), nullable=False))
    table.create(engine)

    class Store:
        def load(self, db, result_id):
            return db.scalar(sa.select(table.c.payload).where(table.c.id == str(result_id)).with_for_update())

        def persist_test_result(self, result_id, payload):
            with SessionLocal.begin() as session:
                session.execute(table.insert().values(id=str(result_id), payload=payload))

    binding = ExecutionRuntime(NeverExecutedProvider(), SimpleNamespace(accepting_jobs=lambda: True), Store())
    old = app.dependency_overrides.copy()
    app.dependency_overrides[get_runtime] = lambda: binding
    try:
        yield binding
    finally:
        app.dependency_overrides.clear(); app.dependency_overrides.update(old)
        table.drop(engine)


@pytest.fixture
def source_case(db, account):
    user, headers = account("Clinician")
    patient = Patient(patient_code="P-" + uuid4().hex[:12], display_name="Synthetic lifecycle fixture")
    db.add(patient); db.flush()
    path = VOLUME_DIR / (uuid4().hex + ".nii")
    path.write_bytes(b"synthetic source bytes; no medical volume or inference")
    case = Case(patient_id=patient.id, case_code="C-" + uuid4().hex[:12], volume_path=path.relative_to(UPLOAD_DIR).as_posix(), modality="CTA")
    db.add(case); db.flush()
    metadata = {"source_sha256": source_sha256(path), "shape": [10, 20, 30],
                "affine": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], "xyzt_units": 2}
    parent = SegmentationResult(id=str(uuid4()), case_id=case.id, source_volume_path=case.volume_path,
                                metadata_json=metadata, created_by=user.id)
    db.add(parent); db.commit()
    request = AnalysisRequest(contract_version="1.0", source={"case_id": case.id, "image_reference": "case-volume",
        "source_sha256": metadata["source_sha256"], "parent_segmentation_result_id": parent.id})
    fixture = SimpleNamespace(case_id=case.id, parent_id=parent.id, user_id=user.id, headers=headers, request=request, path=path)
    db.rollback()
    return fixture


def url(source):
    return f"/api/v1/cases/{source.case_id}/stenosis/analyses"


def post(client, source, key=None, headers=None):
    return client.post(url(source), headers={**(headers or source.headers), "Idempotency-Key": key or str(uuid4())}, json=source.request.model_dump(mode="json"))


def accept(db, source, runtime, key=None):
    return jobs.accepted_job(db, source.case_id, source.request, source.user_id, key or str(uuid4()), runtime)[0]


def stored_result(source, job):
    return {"contract_version": "1.0", "analysis_id": str(job.analysis_id), "state": "completed",
        "provenance": {"contract_version": "1.0", "source": source.request.source.model_dump(mode="json"),
            "method_id": "test-only-provider", "method_version": "v1", "created_at": jobs.now().isoformat(),
            "geometry": {"shape": [10, 20, 30], "array_axis_order": "nifti_i_j_k", "world_convention": "RAS", "world_unit": "mm",
                "affine": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]}},
        "lesions": [], "unavailable_reason": None}


def test_normal_registry_rejects_without_creating_any_job(client, db, source_case):
    assert get_runtime() is None
    response = post(client, source_case)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "capability_unavailable"
    assert response.json()["detail"]["capability_id"] == "stenosis_detection"
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 0
    history = client.get(url(source_case), headers=source_case.headers).json()
    assert history["items"] == [] and history["total"] == 0


def test_unready_dispatcher_rejects(client, db, source_case, runtime):
    app.dependency_overrides[get_runtime] = lambda: ExecutionRuntime(runtime.provider, SimpleNamespace(accepting_jobs=lambda: False), runtime.results)
    assert post(client, source_case).status_code == 409
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 0


def test_unavailable_runtime_does_not_turn_replay_into_new_acceptance(client, db, source_case, runtime):
    key = str(uuid4()); accepted = post(client, source_case, key)
    assert accepted.status_code == 202
    app.dependency_overrides[get_runtime] = lambda: None
    assert post(client, source_case, key).status_code == 409
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 1


def test_changed_provider_fails_original_job_without_rewriting_provenance(db, source_case, runtime):
    job = accept(db, source_case, runtime)
    changed = ExecutionRuntime(SimpleNamespace(method_id="different-provider", method_version="v2", checkpoint_sha256=None, execute=lambda *_: None), runtime.dispatcher, runtime.results)
    with pytest.raises(HTTPException): jobs.claim_job(db, job.analysis_id, changed)
    value = jobs.get_job(db, source_case.case_id, job.analysis_id)
    assert value.status == "failed" and value.failure.code == "provider_changed"
    assert value.provenance.method_id == "test-only-provider"


def test_expired_worker_cannot_heartbeat_or_revive_job(db, source_case, runtime, monkeypatch):
    job = accept(db, source_case, runtime)
    token = jobs.claim_job(db, job.analysis_id, runtime, lease_seconds=30)
    future = jobs.now() + timedelta(seconds=31)
    monkeypatch.setattr(jobs, "now", lambda: future)
    with pytest.raises(HTTPException): jobs.heartbeat(db, job.analysis_id, token)
    row = db.get(StenosisAnalysisJob, str(job.analysis_id))
    assert row.status == "failed" and row.failure_code == "lease_expired"


def test_malformed_runtime_identity_is_unavailable_without_job(client, db, source_case, runtime):
    invalid = ExecutionRuntime(SimpleNamespace(method_id="private/path", method_version="v1", checkpoint_sha256=None, execute=lambda *_: None), runtime.dispatcher, runtime.results)
    app.dependency_overrides[get_runtime] = lambda: invalid
    response = post(client, source_case)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "capability_unavailable"
    assert "private/path" not in str(response.json())
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 0


def test_acceptance_history_status_and_idempotent_replay(client, db, source_case, runtime):
    key = str(uuid4())
    first = post(client, source_case, key)
    assert first.status_code == 202
    value = first.json()
    assert value["status"] == "queued" and value["failure"] is None and not value["stale"]
    assert value["provenance"]["source"] == source_case.request.source.model_dump(mode="json")
    assert value["provenance"]["method_id"] == "test-only-provider"
    assert post(client, source_case, key).json() == value
    assert post(client, source_case, key).status_code == 200
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 1
    status = client.get(url(source_case) + "/" + value["analysis_id"], headers=source_case.headers)
    assert status.json() == value
    assert status.headers["cache-control"] == "no-store"
    history = client.get(url(source_case), headers=source_case.headers).json()
    assert history["items"] == [value] and history["total"] == 1
    serialized = str(value)
    assert "claim_token" not in serialized and "idempotency_key" not in serialized and str(UPLOAD_DIR) not in serialized


def test_same_key_different_request_conflicts(client, db, source_case, runtime):
    key = str(uuid4()); first = post(client, source_case, key)
    parent = db.get(SegmentationResult, source_case.parent_id)
    second = SegmentationResult(id=str(uuid4()), case_id=source_case.case_id, source_volume_path=parent.source_volume_path, metadata_json=parent.metadata_json)
    db.add(second); db.commit()
    source_case.request = source_case.request.model_copy(update={"source": source_case.request.source.model_copy(update={"parent_segmentation_result_id": UUID(second.id)})})
    response = post(client, source_case, key)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "idempotency_conflict"
    assert db.get(StenosisAnalysisJob, first.json()["analysis_id"]).status == "queued"


def test_different_users_do_not_share_keys(client, account, source_case, runtime):
    _, other = account("Admin")
    key = str(uuid4())
    a, b = post(client, source_case, key), post(client, source_case, key, headers=other)
    assert a.status_code == b.status_code == 202 and a.json()["analysis_id"] != b.json()["analysis_id"]


def test_concurrent_duplicate_submissions_create_one_job(db, source_case, runtime):
    barrier = Barrier(2); key = str(uuid4())
    def submit():
        with SessionLocal() as session:
            barrier.wait(timeout=10)
            value, created = jobs.accepted_job(session, source_case.case_id, source_case.request, source_case.user_id, key, runtime)
            return str(value.analysis_id), created
    with ThreadPoolExecutor(2) as pool:
        values = list(pool.map(lambda _: submit(), range(2)))
    assert values[0][0] == values[1][0] and sorted(v[1] for v in values) == [False, True]
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 1


def test_concurrent_claims_are_fenced(db, source_case, runtime):
    job = accept(db, source_case, runtime); barrier = Barrier(2)
    def claim():
        with SessionLocal() as session:
            barrier.wait(timeout=10)
            try: return jobs.claim_job(session, job.analysis_id, runtime)
            except HTTPException as error: return error.status_code
    with ThreadPoolExecutor(2) as pool:
        values = list(pool.map(lambda _: claim(), range(2)))
    assert sum(isinstance(value, str) for value in values) == 1 and 409 in values


def test_success_requires_persisted_matching_result_and_is_terminal(db, source_case, runtime):
    job = accept(db, source_case, runtime); token = jobs.claim_job(db, job.analysis_id, runtime)
    result_id = uuid4()
    with pytest.raises(HTTPException, match="persisted result"):
        jobs.complete_job(db, job.analysis_id, token, result_id, runtime)
    db.rollback()
    payload = stored_result(source_case, job)
    runtime.results.persist_test_result(result_id, payload)
    jobs.complete_job(db, job.analysis_id, token, result_id, runtime)
    row = db.get(StenosisAnalysisJob, str(job.analysis_id))
    assert row.status == "completed" and row.completed_at and row.result_reference == str(result_id)
    for action in (lambda: jobs.claim_job(db, job.analysis_id, runtime),
                   lambda: jobs.complete_job(db, job.analysis_id, token, result_id, runtime),
                   lambda: jobs.fail_job(db, job.analysis_id, "provider_error")):
        with pytest.raises(HTTPException): action()
        db.rollback()


@pytest.mark.parametrize("change", ["source", "method", "analysis", "geometry", "state"])
def test_invalid_persisted_result_never_completes(db, source_case, runtime, change):
    job = accept(db, source_case, runtime); token = jobs.claim_job(db, job.analysis_id, runtime)
    payload = stored_result(source_case, job)
    if change == "source": payload["provenance"]["source"]["source_sha256"] = "b" * 64
    if change == "method": payload["provenance"]["method_version"] = "v2"
    if change == "analysis": payload["analysis_id"] = str(uuid4())
    if change == "geometry": payload["provenance"]["geometry"]["shape"][0] = 11
    if change == "state": payload.update(state="running", lesions=None)
    result_id = uuid4(); runtime.results.persist_test_result(result_id, payload)
    with pytest.raises(HTTPException): jobs.complete_job(db, job.analysis_id, token, result_id, runtime)
    db.rollback()
    assert db.get(StenosisAnalysisJob, str(job.analysis_id)).status == "running"


def test_failure_is_sanitized_preserves_provenance_and_replay_does_not_retry(client, db, source_case, runtime):
    key = str(uuid4()); job = accept(db, source_case, runtime, key)
    token = jobs.claim_job(db, job.analysis_id, runtime)
    with pytest.raises(ValueError): jobs.fail_job(db, job.analysis_id, "private/path/traceback", token)
    db.rollback()
    jobs.fail_job(db, job.analysis_id, "provider_error", token)
    replay = post(client, source_case, key)
    assert replay.status_code == 200 and replay.json()["status"] == "failed"
    assert replay.json()["provenance"] == job.provenance.model_dump(mode="json")
    assert "private" not in str(replay.json()) and "traceback" not in str(replay.json())
    with pytest.raises(HTTPException): jobs.claim_job(db, job.analysis_id, runtime)


def test_queued_failure_and_unknown_transition(db, source_case, runtime):
    job = accept(db, source_case, runtime)
    jobs.fail_job(db, job.analysis_id, "dispatch_failed")
    with pytest.raises(HTTPException): jobs.transition(SimpleNamespace(status="unknown"), "running")
    with pytest.raises(HTTPException): jobs.transition(SimpleNamespace(status="failed"), "completed")


@pytest.mark.parametrize("moment", ["accept", "claim", "complete"])
def test_same_path_source_mutation_fails_closed(client, db, source_case, runtime, moment):
    job = accept(db, source_case, runtime) if moment != "accept" else None
    token = jobs.claim_job(db, job.analysis_id, runtime) if moment == "complete" else None
    source_case.path.write_bytes(b"different source bytes")
    if moment == "accept":
        assert post(client, source_case).status_code == 409
        assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 0
    else:
        with pytest.raises(HTTPException):
            if moment == "claim": jobs.claim_job(db, job.analysis_id, runtime)
            else: jobs.complete_job(db, job.analysis_id, token, uuid4(), runtime)
        assert db.get(StenosisAnalysisJob, str(job.analysis_id)).status == "failed"
        value = jobs.get_job(db, source_case.case_id, job.analysis_id)
        assert value.stale and value.failure.code == "source_changed"


@pytest.mark.parametrize("change", ["hash", "replaced", "missing_parent", "other_case", "route"])
def test_rejects_invalid_source_or_parent(client, db, source_case, runtime, change):
    if change == "hash": source_case.request = source_case.request.model_copy(update={"source": source_case.request.source.model_copy(update={"source_sha256": "b" * 64})})
    if change == "replaced":
        case = db.get(Case, source_case.case_id); case.volume_path = "volumes/replaced.nii"; db.commit()
    if change == "missing_parent": source_case.request = source_case.request.model_copy(update={"source": source_case.request.source.model_copy(update={"parent_segmentation_result_id": uuid4()})})
    if change == "other_case":
        parent = db.get(SegmentationResult, source_case.parent_id)
        other = Case(patient_id=db.get(Case, source_case.case_id).patient_id, case_code=uuid4().hex)
        db.add(other); db.flush(); parent.case_id = other.id; db.commit()
    if change == "route": source_case.request = source_case.request.model_copy(update={"source": source_case.request.source.model_copy(update={"case_id": source_case.case_id + 1})})
    response = post(client, source_case)
    assert response.status_code in (404, 409)
    assert db.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 0


def test_worker_lease_heartbeat_expiry_and_bad_token(db, source_case, runtime, monkeypatch):
    job = accept(db, source_case, runtime); token = jobs.claim_job(db, job.analysis_id, runtime, lease_seconds=30)
    with pytest.raises(HTTPException): jobs.heartbeat(db, job.analysis_id, "wrong-token")
    db.rollback()
    jobs.heartbeat(db, job.analysis_id, token, lease_seconds=60)
    future = jobs.now() + timedelta(seconds=61)
    monkeypatch.setattr(jobs, "now", lambda: future)
    assert jobs.fail_expired_jobs(db) == 1
    assert jobs.fail_expired_jobs(db) == 0
    with pytest.raises(HTTPException): jobs.complete_job(db, job.analysis_id, token, uuid4(), runtime)


@pytest.mark.parametrize("role", list(Role))
def test_authorization_for_history_status_and_creation(client, db, source_case, runtime, account, role):
    _, headers = account(role)
    job = accept(db, source_case, runtime)
    assert client.get(url(source_case), headers=headers).status_code == 200
    assert client.get(url(source_case) + "/" + str(job.analysis_id), headers=headers).status_code == 200
    assert post(client, source_case, headers=headers).status_code == (202 if role in {Role.CLINICIAN, Role.ADMIN} else 403)


@pytest.mark.parametrize("session", ["missing", "invalid", "inactive", "revoked"])
def test_sessions_are_rejected(client, db, source_case, runtime, account, session):
    headers = source_case.headers
    if session == "missing": headers = {}
    if session == "invalid": headers = {"Authorization": "Bearer invalid"}
    if session in {"inactive", "revoked"}:
        from app.models import User
        actor = db.get(User, source_case.user_id)
        if session == "inactive": actor.is_active = False
        else: actor.token_version += 1
        db.commit()
    assert client.get(url(source_case), headers=headers).status_code == 401
    response = client.post(url(source_case), headers={**headers, "Idempotency-Key": str(uuid4())}, json=source_case.request.model_dump(mode="json"))
    assert response.status_code == 401


def test_pagination_cross_case_and_bad_requests(client, db, source_case, runtime):
    a, b = accept(db, source_case, runtime), accept(db, source_case, runtime)
    first = client.get(url(source_case) + "?limit=1&offset=0", headers=source_case.headers).json()
    second = client.get(url(source_case) + "?limit=1&offset=1", headers=source_case.headers).json()
    assert first["has_more"] and not second["has_more"]
    assert first["items"][0]["analysis_id"] != second["items"][0]["analysis_id"]
    other = Case(patient_id=db.get(Case, source_case.case_id).patient_id, case_code=uuid4().hex)
    db.add(other); db.commit()
    assert client.get(f"/api/v1/cases/{other.id}/stenosis/analyses/{a.analysis_id}", headers=source_case.headers).status_code == 404
    assert client.get(f"/api/v1/cases/{other.id}/stenosis/analyses", headers=source_case.headers).json()["items"] == []
    assert client.get(url(source_case) + "?limit=101", headers=source_case.headers).status_code == 422
    assert client.post(url(source_case), headers=source_case.headers, json=source_case.request.model_dump(mode="json")).status_code == 422


def test_database_constraints_and_provenance_deletion_protection(db, source_case, runtime):
    job = accept(db, source_case, runtime)
    for statement in (
        sa.update(StenosisAnalysisJob).values(status="unknown"),
        sa.update(StenosisAnalysisJob).values(status="completed"),
        sa.delete(SegmentationResult).where(SegmentationResult.id == source_case.parent_id),
        sa.delete(Case).where(Case.id == source_case.case_id),
    ):
        with pytest.raises(IntegrityError): db.execute(statement); db.commit()
        db.rollback()
    row = db.get(StenosisAnalysisJob, str(job.analysis_id))
    copy = {column.name: getattr(row, column.name) for column in row.__table__.columns}
    copy["id"] = str(uuid4())
    with pytest.raises(IntegrityError): db.execute(sa.insert(StenosisAnalysisJob).values(**copy)); db.commit()
    db.rollback()


def test_migration_roundtrip_matches_models_and_preserves_parent_data(db, source_case):
    # A migration-only test binding, never registered with the application.
    binding = ExecutionRuntime(NeverExecutedProvider(), SimpleNamespace(accepting_jobs=lambda: True), SimpleNamespace(load=lambda *_: None))
    accept(db, source_case, binding)
    db.rollback()
    before = None
    with engine.connect() as connection:
        before = connection.scalar(sa.select(sa.func.count()).select_from(SegmentationResult))
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    config = Config("alembic.ini")
    command.downgrade(config, "0005_segmentation_results")
    assert "stenosis_analysis_jobs" not in sa.inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(SegmentationResult)) == before
    command.upgrade(config, "head")
    indexes = {item["name"] for item in sa.inspect(engine).get_indexes("stenosis_analysis_jobs")}
    assert {"ix_stenosis_job_history", "ix_stenosis_job_status"} <= indexes
    with engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(StenosisAnalysisJob)) == 0
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []


def test_idempotency_header_cors_preserves_origin_policy(client):
    headers = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "Authorization,Content-Type,Idempotency-Key"}
    assert client.options("/api/v1/cases/1/stenosis/analyses", headers=headers).status_code == 200
    headers["Origin"] = "https://untrusted.example"
    assert client.options("/api/v1/cases/1/stenosis/analyses", headers=headers).status_code == 400


def test_client_role_claim_cannot_expand_execution_permissions(client, source_case, account):
    from app.core.security import create_access_token
    user, _ = account("Researcher")
    token = create_access_token(str(user.id), "Admin", user.token_version)
    response = post(client, source_case, headers={"Authorization": "Bearer " + token})
    assert response.status_code == 403
