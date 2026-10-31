"""Transactional job lifecycle. HTTP handlers never invoke the medical provider."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import logging
import secrets
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import Case, SegmentationResult, StenosisAnalysisJob
from app.routers.segmentation import current_result, current_source_sha256, is_stale
from app.schemas.stenosis import AnalysisProvenance, AnalysisResult, CONTRACT_VERSION, SourceReference
from app.schemas.stenosis_jobs import AnalysisHistoryResponse, AnalysisJobResponse, JobFailure
from app.services.audit import record_event
from app.services.stenosis import validate_source_association

logger = logging.getLogger(__name__)
TRANSITIONS = {"queued": {"running", "failed"}, "running": {"completed", "failed"},
               "completed": set(), "failed": set()}
FAILURES = {
    "source_changed": "The source or parent segmentation changed or cannot be verified.",
    "provider_changed": "The registered method no longer matches the accepted job.",
    "provider_error": "The analysis provider could not complete this job.",
    "lease_expired": "The worker lease expired; this job requires a new explicit request.",
    "dispatch_failed": "The execution mechanism could not process this accepted job.",
}


def now():
    return datetime.now(timezone.utc)


def conflict(code, message, status=409):
    return HTTPException(status, {"contract_version": CONTRACT_VERSION, "code": code,
                                  "capability_id": "stenosis_detection", "message": message})


def require_runtime(runtime):
    if runtime is None or not runtime.ready():
        raise conflict("capability_unavailable", "No verified stenosis provider, durable dispatcher and result store are registered and ready.")


def source_for(job):
    return SourceReference(case_id=job.case_id, image_reference=job.image_reference,
                           source_sha256=job.source_sha256,
                           parent_segmentation_result_id=job.parent_segmentation_result_id)


def fresh(job, case, parent, checksum):
    return (parent is not None and parent.case_id == job.case_id
            and parent.metadata_json.get("source_sha256") == job.source_sha256
            and not is_stale(parent, case, checksum))


def response_for(db, job, case=None, checksum=None):
    case = case or db.get(Case, job.case_id)
    parent = db.get(SegmentationResult, job.parent_segmentation_result_id)
    if case is None or parent is None or parent.case_id != job.case_id:
        raise conflict("invalid_association", "The analysis association cannot be verified.")
    checksum = checksum if checksum is not None else current_source_sha256(case)
    return AnalysisJobResponse(
        contract_version=job.contract_version, analysis_id=job.id, case_id=job.case_id,
        status=job.status, provenance=AnalysisProvenance(
            contract_version=job.contract_version, source=source_for(job), method_id=job.method_id,
            method_version=job.method_version, checkpoint_sha256=job.checkpoint_sha256,
            created_at=job.created_at),
        created_at=job.created_at, updated_at=job.updated_at, started_at=job.started_at,
        completed_at=job.completed_at, failed_at=job.failed_at,
        failure=JobFailure(code=job.failure_code, message=FAILURES[job.failure_code]) if job.failure_code else None,
        stale=not fresh(job, case, parent, checksum), result_reference=job.result_reference,
    )


def accepted_job(db, case_id, request, actor_id, key, runtime):
    if case_id != request.source.case_id:
        raise conflict("source_mismatch", "The request source must identify the route's case.")
    # The case lock serializes acceptance against committed upload replacement.
    case = db.scalar(select(Case).where(Case.id == case_id).with_for_update()
                     .execution_options(populate_existing=True))
    if case is None:
        raise HTTPException(404, "Case not found")
    _, parent = current_result(db, case_id, str(request.source.parent_segmentation_result_id))
    try:
        validate_source_association(request, parent)
    except ValueError:
        raise conflict("source_mismatch", "The request does not match the current segmentation source.") from None
    # Gate before querying/inserting the job table: no fake acceptance, even if
    # an old key exists while the execution mechanism is unavailable.
    require_runtime(runtime)
    fingerprint = hashlib.sha256(json.dumps(request.model_dump(mode="json"), sort_keys=True,
                                            separators=(",", ":")).encode()).hexdigest()

    def replay():
        existing = db.scalar(select(StenosisAnalysisJob).where(
            StenosisAnalysisJob.created_by == actor_id, StenosisAnalysisJob.case_id == case_id,
            StenosisAnalysisJob.idempotency_key == key))
        if existing is not None and existing.request_fingerprint != fingerprint:
            raise conflict("idempotency_conflict", "This idempotency key is already bound to a different request.")
        return existing

    existing = replay()
    if existing is not None:
        response = response_for(db, existing)
        db.commit()
        return response, False
    created = now()
    try:
        provenance = AnalysisProvenance(contract_version=CONTRACT_VERSION, source=request.source,
            method_id=runtime.provider.method_id, method_version=runtime.provider.method_version,
            checkpoint_sha256=runtime.provider.checkpoint_sha256, created_at=created)
    except (ValidationError, AttributeError):
        raise conflict("capability_unavailable", "The registered method identity cannot be verified.") from None
    job = StenosisAnalysisJob(id=str(uuid4()), case_id=case_id,
        parent_segmentation_result_id=str(request.source.parent_segmentation_result_id),
        created_by=actor_id, contract_version=CONTRACT_VERSION, image_reference=request.source.image_reference,
        source_sha256=request.source.source_sha256, method_id=provenance.method_id,
        method_version=provenance.method_version, checkpoint_sha256=provenance.checkpoint_sha256,
        status="queued", idempotency_key=key, request_fingerprint=fingerprint,
        created_at=created, updated_at=created)
    db.add(job)
    record_event(db, "stenosis.job_queued", actor_id, case_id)
    try:
        db.flush()
        response = response_for(db, job)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = replay()
        if existing is None:
            raise conflict("acceptance_conflict", "The analysis could not be accepted; refresh history before retrying.") from None
        response = response_for(db, existing)
        db.commit()
        return response, False
    logger.info("Stenosis job %s queued for case %s", job.id, case_id)
    return response, True


def history(db, case_id, limit, offset, *, status=None, start_date=None, end_date=None, method_id=None, method_version=None):
    # Acceptance takes an exclusive lock on this case. Keep count and page
    # membership consistent while concurrent requests are being accepted.
    case = db.scalar(select(Case).where(Case.id == case_id).with_for_update(read=True)
                     .execution_options(populate_existing=True))
    if case is None:
        raise HTTPException(404, "Case not found")
    from app.schemas.stenosis_reporting import AnalyticsFilters
    from datetime import datetime, time, timezone
    AnalyticsFilters(status=status,start_date=start_date,end_date=end_date,method_id=method_id,method_version=method_version)
    filters = [StenosisAnalysisJob.case_id == case_id]
    for field,value in (("status",status),("method_id",method_id),("method_version",method_version)):
        if value is not None: filters.append(getattr(StenosisAnalysisJob,field)==value)
    if start_date: filters.append(StenosisAnalysisJob.created_at>=datetime.combine(start_date,time.min,timezone.utc))
    if end_date: filters.append(StenosisAnalysisJob.created_at<=datetime.combine(end_date,time.max,timezone.utc))
    total = db.scalar(select(func.count()).select_from(StenosisAnalysisJob).where(*filters))
    jobs = db.scalars(select(StenosisAnalysisJob).where(*filters)
        .order_by(StenosisAnalysisJob.created_at.desc(), StenosisAnalysisJob.id.desc()).limit(limit).offset(offset)).all()
    checksum = current_source_sha256(case) if jobs else None
    return AnalysisHistoryResponse(contract_version=CONTRACT_VERSION, case_id=case_id,
        items=[response_for(db, job, case, checksum) for job in jobs], total=total,
        limit=limit, offset=offset, has_more=offset + len(jobs) < total)


def get_job(db, case_id, job_id):
    if db.get(Case, case_id) is None:
        raise HTTPException(404, "Case not found")
    job = db.scalar(select(StenosisAnalysisJob).where(StenosisAnalysisJob.id == str(job_id), StenosisAnalysisJob.case_id == case_id))
    if job is None:
        raise HTTPException(404, "Analysis not found")
    return response_for(db, job)


def locked_job(db, job_id):
    job = db.scalar(select(StenosisAnalysisJob).where(StenosisAnalysisJob.id == str(job_id))
        .with_for_update().execution_options(populate_existing=True))
    if job is None:
        raise HTTPException(404, "Analysis not found")
    return job


def transition(job, target):
    if target not in TRANSITIONS.get(job.status, set()):
        raise conflict("invalid_transition", "This lifecycle transition is not permitted.")
    job.status = target
    job.updated_at = now()


def fail_locked(db, job, code):
    if code not in FAILURES:
        raise ValueError("Unknown safe failure code")
    transition(job, "failed")
    job.failure_code, job.failure_reason, job.failed_at = code, FAILURES[code], now()
    job.claim_token_hash, job.lease_expires_at = None, None
    record_event(db, "stenosis.job_failed", job.created_by, job.case_id)
    db.commit()
    logger.info("Stenosis job %s failed for case %s (%s)", job.id, job.case_id, code)


def verify_fresh_locked(db, job, mark_failed=True):
    case = db.scalar(select(Case).where(Case.id == job.case_id).with_for_update()
                     .execution_options(populate_existing=True))
    parent = db.get(SegmentationResult, job.parent_segmentation_result_id, populate_existing=True)
    if case is None or not fresh(job, case, parent, current_source_sha256(case)):
        if mark_failed:
            fail_locked(db, job, "source_changed")
        raise conflict("source_changed", FAILURES["source_changed"])


def claim_job(db, job_id, runtime, lease_seconds=300):
    require_runtime(runtime)
    if not 30 <= lease_seconds <= 86400:
        raise ValueError("Worker lease must be between 30 and 86400 seconds")
    job = locked_job(db, job_id)
    if job.status != "queued":
        raise conflict("invalid_transition", "Only a queued analysis can be claimed.")
    verify_fresh_locked(db, job)
    if (job.method_id, job.method_version, job.checkpoint_sha256) != (
            runtime.provider.method_id, runtime.provider.method_version, runtime.provider.checkpoint_sha256):
        fail_locked(db, job, "provider_changed")
        raise conflict("provider_changed", FAILURES["provider_changed"])
    transition(job, "running")
    token = secrets.token_urlsafe(32)
    job.claim_token_hash = hashlib.sha256(token.encode()).hexdigest()
    job.started_at = now()
    job.lease_expires_at = now() + timedelta(seconds=lease_seconds)
    record_event(db, "stenosis.job_running", job.created_by, job.case_id)
    db.commit()
    logger.info("Stenosis job %s running for case %s", job.id, job.case_id)
    return token


def running_job(db, job_id, token, fail_on_expiry=True):
    job = locked_job(db, job_id)
    if job.status != "running" or not job.claim_token_hash or not hmac.compare_digest(
            job.claim_token_hash, hashlib.sha256(token.encode()).hexdigest()):
        raise conflict("invalid_claim", "The worker does not hold this running analysis.")
    if job.lease_expires_at <= now():
        if fail_on_expiry:
            fail_locked(db, job, "lease_expired")
        raise conflict("lease_expired", FAILURES["lease_expired"])
    return job


def heartbeat(db, job_id, token, lease_seconds=300):
    if not 30 <= lease_seconds <= 86400:
        raise ValueError("Worker lease must be between 30 and 86400 seconds")
    job = running_job(db, job_id, token)
    job.lease_expires_at, job.updated_at = now() + timedelta(seconds=lease_seconds), now()
    db.commit()


def fail_job(db, job_id, code, token=None):
    job = running_job(db, job_id, token) if token is not None else locked_job(db, job_id)
    if token is None and job.status != "queued":
        raise conflict("invalid_claim", "A running job requires its worker claim.")
    fail_locked(db, job, code)


def complete_job(db, job_id, token, result_id: UUID, runtime, *, commit=True):
    require_runtime(runtime)
    job = running_job(db, job_id, token, fail_on_expiry=commit)
    verify_fresh_locked(db, job, mark_failed=commit)
    # The atomic result writer uses commit=False so all result/lesion/job writes
    # commit together, with no guard accidentally committing partial results.
    stored = runtime.results.load(db, result_id)
    if stored is None:
        raise conflict("result_not_persisted", "A valid persisted result is required before completion.")
    try:
        result = AnalysisResult.model_validate(stored)
        if (result.state != "completed" or str(result.analysis_id) != job.id
                or result.provenance.source != source_for(job)
                or (result.provenance.method_id, result.provenance.method_version, result.provenance.checkpoint_sha256)
                != (job.method_id, job.method_version, job.checkpoint_sha256)):
            raise ValueError()
        parent = db.get(SegmentationResult, job.parent_segmentation_result_id)
        geometry = result.provenance.geometry
        metadata = parent.metadata_json
        if (metadata.get("xyzt_units", 0) & 7 != 2 or tuple(metadata.get("shape", [])) != geometry.shape
                or tuple(tuple(row) for row in metadata.get("affine", [])) != geometry.affine):
            raise ValueError()
    except ValueError:
        raise conflict("invalid_result", "The persisted result does not match this accepted analysis.") from None
    transition(job, "completed")
    job.completed_at, job.result_reference = now(), str(result_id)
    job.claim_token_hash, job.lease_expires_at = None, None
    record_event(db, "stenosis.job_completed", job.created_by, job.case_id)
    if commit:
        db.commit()
        logger.info("Stenosis job %s completed for case %s", job.id, job.case_id)


def fail_expired_jobs(db, limit=100):
    """Explicit worker/startup recovery; no automatic retry or HTTP background task."""
    jobs = db.scalars(select(StenosisAnalysisJob).where(StenosisAnalysisJob.status == "running",
        StenosisAnalysisJob.lease_expires_at <= now()).order_by(StenosisAnalysisJob.id)
        .limit(limit).with_for_update(skip_locked=True)).all()
    # One transaction for the locked batch, using the same transition/failure map.
    for job in jobs:
        transition(job, "failed")
        job.failure_code, job.failure_reason, job.failed_at = "lease_expired", FAILURES["lease_expired"], now()
        job.claim_token_hash, job.lease_expires_at = None, None
        record_event(db, "stenosis.job_failed", job.created_by, job.case_id)
    db.commit()
    return len(jobs)
