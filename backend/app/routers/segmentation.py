"""Synchronous, authenticated research inference on a case's stored CT volume."""
from pathlib import Path
from threading import BoundedSemaphore
from typing import Literal
from uuid import UUID, uuid4
import hashlib
import logging
import os
import stat
import tempfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select

from app.core.config import settings
from app.models import Case, SegmentationResult
from app.routers.cases import AuthenticatedCaseReader, ClinicalWriter, DatabaseSession, UPLOAD_DIR, VOLUME_DIR
from app.schemas.segmentation import SegmentationRequest, SegmentationResponse
from app.services.audit import record_event
from app.services.source_fingerprint import source_sha256

router = APIRouter(prefix="/cases", tags=["Experimental segmentation"])
logger = logging.getLogger(__name__)
inference_slot = BoundedSemaphore(1)


def execute_inference(source: Path, destination: Path, threshold: float):
    # Optional dependency: importing the API must not require a model runtime.
    try:
        import torch
        from app.services.segmentation.inference import InferenceError, run_inference
    except (ImportError, OSError) as exc:
        raise HTTPException(503, "Inference runtime unavailable; install backend/requirements-model.txt.") from exc
    torch.set_num_threads(settings.VASCULAI_MODEL_THREADS)
    try:
        return run_inference(source, settings.VASCULAI_MODEL_CHECKPOINT, destination,
                             threshold=threshold, batch_size=settings.VASCULAI_MODEL_BATCH_SIZE,
                             device=settings.VASCULAI_MODEL_DEVICE,
                             max_voxels=min(settings.MAX_VOLUME_VOXELS, settings.VASCULAI_MODEL_MAX_VOXELS),
                             max_bytes=settings.MAX_VOLUME_UNCOMPRESSED_MB * 1024 * 1024)
    except InferenceError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


def get_case(db, case_id):
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "Case not found")
    return case


def result_directory(result_id):
    try:
        if str(UUID(result_id)) != result_id:
            raise ValueError()
    except ValueError:
        raise HTTPException(404, "Segmentation result not found") from None
    root = (Path(settings.OUTPUT_DIR).resolve() / "segmentations").resolve()
    directory = (root / result_id).resolve()
    if directory.parent != root:
        raise HTTPException(400, "Stored result path is invalid")
    return directory


def current_source_sha256(case):
    if not case.volume_path:
        return None
    try:
        source = (UPLOAD_DIR / case.volume_path).resolve()
        if source.parent != VOLUME_DIR:
            return None
        return source_sha256(source)
    except OSError:
        return None


def is_stale(result, case, checksum):
    expected = result.metadata_json.get("source_sha256")
    # Missing/unreadable sources or old records without provenance fail closed.
    return result.source_volume_path != case.volume_path or not checksum or not expected or expected != checksum


def response_for(result, case, checksum):
    base = f"{settings.API_V1_STR}/cases/{case.id}/segmentations/{result.id}"
    return SegmentationResponse(
        id=result.id, case_id=case.id, created_at=result.created_at,
        stale=is_stale(result, case, checksum),
        metadata=result.metadata_json, mask_url=f"{base}/mask",
        probabilities_url=f"{base}/probabilities",
    )


@router.post("/{case_id}/segmentations", response_model=SegmentationResponse, status_code=201)
def create_segmentation(case_id: int, request: SegmentationRequest,
                        current_user: ClinicalWriter, db: DatabaseSession):
    case = get_case(db, case_id)
    if not case.volume_path:
        raise HTTPException(409, "Upload a three-dimensional CT NIfTI volume first.")
    if case.modality not in {"CTA", "CT Angiography"}:
        raise HTTPException(409, "This model requires CT. Confirm case modality as CTA or CT Angiography.")
    source_relative = case.volume_path
    source = (UPLOAD_DIR / source_relative).resolve()
    if source.parent != VOLUME_DIR:
        raise HTTPException(400, "Stored volume path is invalid")
    if not source.is_file():
        raise HTTPException(404, "Input volume is missing from storage.")
    if not settings.VASCULAI_MODEL_CHECKPOINT:
        raise HTTPException(503, "Model checkpoint is not configured; set VASCULAI_MODEL_CHECKPOINT.")
    result_id = str(uuid4())
    directory = result_directory(result_id)
    if not inference_slot.acquire(blocking=False):
        raise HTTPException(503, "Inference worker is busy; retry after the active run completes.", headers={"Retry-After": "30"})
    committed = False
    actor_id = current_user.id
    # Do not hold a database transaction throughout a potentially long CPU run.
    try:
        db.rollback()
        initial_checksum = source_sha256(source)
        metadata = execute_inference(source, directory, request.threshold if request.threshold is not None else settings.VASCULAI_MODEL_THRESHOLD)
        db.expire_all()
        case = get_case(db, case_id)
        checksum = current_source_sha256(case)
        if case.volume_path != source_relative or checksum != initial_checksum or metadata.get("source_sha256") != initial_checksum:
            raise HTTPException(409, "Volume changed during inference; run again on the current upload.")
        result = SegmentationResult(id=result_id, case_id=case_id,
                                    source_volume_path=source_relative,
                                    metadata_json=metadata, created_by=actor_id)
        db.add(result)
        record_event(db, "case.segmentation_created", actor_id, case_id)
        db.flush()
        response = response_for(result, case, checksum)
        db.commit()
        committed = True
        return response
    except HTTPException:
        raise
    except Exception:
        logger.exception("Segmentation failed for case %s", case_id)
        raise HTTPException(500, "Segmentation could not be completed or saved.") from None
    finally:
        try:
            if not committed:
                db.rollback()
                # UUID-owned files only; never delete the source or handoff.
                for name in ("probabilities.nii.gz", "prediction_mask.nii.gz", "metadata.json"):
                    (directory / name).unlink(missing_ok=True)
                if directory.exists():
                    directory.rmdir()
        finally:
            inference_slot.release()


@router.get("/{case_id}/segmentations", response_model=list[SegmentationResponse])
def list_segmentations(case_id: int, current_user: AuthenticatedCaseReader, db: DatabaseSession):
    case = get_case(db, case_id)
    results = db.scalars(select(SegmentationResult).where(SegmentationResult.case_id == case_id)
                         .order_by(SegmentationResult.created_at.desc(), SegmentationResult.id)).all()
    checksum = current_source_sha256(case) if results else None
    responses = [response_for(result, case, checksum) for result in results]
    record_event(db, "case.segmentation_list_read", current_user.id, case_id)
    db.commit()
    return responses


def current_result(db, case_id, result_id):
    case = get_case(db, case_id)
    result = db.get(SegmentationResult, result_id)
    if result is None or result.case_id != case_id:
        raise HTTPException(404, "Segmentation result not found")
    if is_stale(result, case, current_source_sha256(case)):
        raise HTTPException(409, "Segmentation input changed, is missing, or cannot be verified; run inference again.")
    return case, result


class SourceSnapshotResponse(StreamingResponse):
    """Serve only the verified snapshot handle; close it even on disconnect."""

    def __init__(self, snapshot, compressed):
        self.snapshot = snapshot
        filename = "source_ct.nii.gz" if compressed else "source_ct.nii"
        super().__init__(iter(lambda: snapshot.read(64 * 1024), b""),
                         media_type="application/gzip" if compressed else "application/octet-stream",
                         headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                  "Content-Disposition": f'attachment; filename="{filename}"',
                                  "Content-Length": str(os.fstat(snapshot.fileno()).st_size)})

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.snapshot.close()


def snapshot_source(source, expected_checksum, compressed):
    """Hash the bytes actually copied, then serve that private copy without reopening.

    A pinned source descriptor alone would still permit concurrent in-place writes.
    TemporaryFile works on Windows too and is never mounted or returned by path.
    """
    snapshot = tempfile.TemporaryFile(mode="w+b")
    limit = (settings.MAX_VOLUME_COMPRESSED_MB if compressed else settings.MAX_VOLUME_UNCOMPRESSED_FILE_MB) * 1024 * 1024
    try:
        digest = hashlib.sha256()
        size = 0
        with source.open("rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or source.resolve() != source:
                raise HTTPException(409, "Segmentation source is unavailable or cannot be verified.")
            if info.st_size > limit:
                raise HTTPException(409, "Segmentation source exceeds the configured storage limit.")
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                size += len(block)
                if size > limit:
                    raise HTTPException(409, "Segmentation source exceeds the configured storage limit.")
                snapshot.write(block)
                digest.update(block)
        if digest.hexdigest() != expected_checksum or source.resolve() != source:
            raise HTTPException(409, "Segmentation input changed; run inference again.")
        snapshot.seek(0)
        return snapshot
    except BaseException:
        snapshot.close()
        raise


# Register before the artifact route so "source" is not parsed as an artifact.
@router.get("/{case_id}/segmentations/{result_id}/source", response_class=StreamingResponse,
            responses={200: {"description": "Original CT bytes for a current segmentation result",
                             "content": {mime: {"schema": {"type": "string", "format": "binary"}}
                                         for mime in ("application/gzip", "application/octet-stream")}},
                       404: {"description": "Case or matching result not found"},
                       409: {"description": "Source stale, missing, or unverifiable"}})
def download_source(case_id: int, result_id: str,
                    current_user: AuthenticatedCaseReader, db: DatabaseSession):
    case, result = current_result(db, case_id, result_id)
    source_relative = case.volume_path
    try:
        source = (UPLOAD_DIR / source_relative).resolve()
        if source.parent != VOLUME_DIR or not source.is_file():
            raise HTTPException(409, "Segmentation source is unavailable or cannot be verified.")
        compressed = source.name.lower().endswith(".nii.gz")
        if not compressed and not source.name.lower().endswith(".nii"):
            raise HTTPException(409, "Segmentation source format cannot be verified.")
        snapshot = snapshot_source(source, result.metadata_json["source_sha256"], compressed)
    except (OSError, RuntimeError):
        raise HTTPException(409, "Segmentation source is unavailable or cannot be verified.") from None
    try:
        db.refresh(case)
        if case.volume_path != source_relative:
            raise HTTPException(409, "Segmentation input changed; run inference again.")
        record_event(db, "case.segmentation_source_read", current_user.id, case_id)
        db.commit()
        return SourceSnapshotResponse(snapshot, compressed)
    except BaseException:
        snapshot.close()
        raise


@router.get("/{case_id}/segmentations/{result_id}/{artifact}")
def download_segmentation(case_id: int, result_id: str, artifact: Literal["mask", "probabilities"],
                          current_user: AuthenticatedCaseReader, db: DatabaseSession):
    current_result(db, case_id, result_id)
    filename = "prediction_mask.nii.gz" if artifact == "mask" else "probabilities.nii.gz"
    directory = result_directory(result_id)
    path = (directory / filename).resolve()
    if path.parent != directory or not path.is_file():
        raise HTTPException(404, "Segmentation artifact is missing from storage.")
    record_event(db, "case.segmentation_artifact_read", current_user.id, case_id)
    db.commit()
    return FileResponse(path, filename=filename, media_type="application/gzip", headers={"Cache-Control": "no-store"})
