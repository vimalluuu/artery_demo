"""Trusted atomic result writer, immutable SQL store and protected readers."""
from pathlib import Path
from uuid import UUID, uuid4
import logging

from fastapi import HTTPException
import nibabel as nib
import numpy as np
from sqlalchemy import select

from app.core.config import settings
from app.models import Case, SegmentationResult, StenosisAnalysisJob, StenosisAnalysisResult, StenosisLesion
from app.routers.cases import UPLOAD_DIR, VOLUME_DIR
from app.routers.segmentation import snapshot_source, current_source_sha256
from app.schemas.stenosis import AnalysisResult, LesionResult, VolumeGeometry
from app.schemas.stenosis_results import StenosisResultResponse, ViewerSource, StenosisLesionResponse
from app.services import stenosis_jobs as jobs
from app.services.audit import record_event
from app.services.source_fingerprint import file_version
from app.services.stenosis_geometry import geometry_fingerprint, same_geometry, visualization_state
from app.services.volume_ingestion import validate_nifti_file, validate_nifti_extension

logger = logging.getLogger(__name__)
MAX_LESIONS = 200


def error(code="invalid_result", message="The result or source geometry could not be verified.", status=409):
    return jobs.conflict(code, message, status)


def source_geometry(case):
    path = (UPLOAD_DIR / case.volume_path).resolve()
    if path.parent != VOLUME_DIR:
        raise error()
    version = file_version(path)
    props = validate_nifti_file(path, validate_nifti_extension(path.name),
        max_uncompressed_bytes=settings.MAX_VOLUME_UNCOMPRESSED_MB * 1024 * 1024,
        max_voxels=settings.MAX_VOLUME_VOXELS)
    if props.ndim != 3 or props.xyzt_units & 7 != 2 or not (props.qform_code > 0 or props.sform_code > 0):
        raise error("unsupported_geometry", "Localization requires a coded three-dimensional source with explicit millimetre units.")
    if file_version(path) != version:
        raise error("source_changed", "The source changed during geometry verification.")
    return VolumeGeometry(shape=props.shape, array_axis_order="nifti_i_j_k", world_convention="RAS", world_unit="mm",
        affine=tuple(tuple(props.affine_flat[i:i+4]) for i in range(0, 16, 4)))


class SQLResultStore:
    """Read immutable rows in the caller's transaction; never registers a provider."""
    def load(self, db, result_id):
        row = db.scalar(select(StenosisAnalysisResult).where(StenosisAnalysisResult.id == str(result_id)).with_for_update(read=True))
        if row is None:
            return None
        lesions = db.scalars(select(StenosisLesion).where(StenosisLesion.result_id == row.id).order_by(StenosisLesion.lesion_id)).all()
        try:
            result = AnalysisResult(contract_version=row.schema_version, analysis_id=row.analysis_id,
                state=row.status, provenance=row.provenance_json, lesions=[LesionResult.model_validate(item.payload_json) for item in lesions], unavailable_reason=None)
            if (len(lesions) != row.finding_count or len(lesions) > MAX_LESIONS
                    or any(str(value.lesion_id) != item.lesion_id for value, item in zip(result.lesions, lesions))
                    or result.provenance.source.case_id != row.case_id
                    or str(result.provenance.source.parent_segmentation_result_id) != row.parent_segmentation_result_id
                    or result.provenance.source.source_sha256 != row.source_sha256
                    or geometry_fingerprint(result.provenance.geometry, row.source_sha256) != row.geometry_fingerprint):
                raise ValueError()
            for lesion in result.lesions:
                if lesion.candidate_region and lesion.candidate_region.geometry_fingerprint != row.geometry_fingerprint:
                    raise ValueError()
            return result
        except (ValueError, TypeError, KeyError):
            raise error("result_integrity_failure", "The stored result is incomplete or inconsistent; no findings were returned.") from None


def artifact_directory(result_id):
    result_id = str(UUID(str(result_id)))
    base = (Path(settings.OUTPUT_DIR).resolve() / "stenosis-results").resolve()
    directory = (base / result_id).resolve()
    if directory.parent != base:
        raise error("artifact_unavailable", "The region artifact is unavailable.")
    return directory


def artifact_path(result_id, reference):
    directory = artifact_directory(result_id)
    path = (directory / f"{reference.artifact_id}.{reference.format}").resolve()
    if path.parent != directory:
        raise error("artifact_unavailable", "The region artifact is unavailable.")
    return path


def copy_regions(result_id, result, inputs, geometry_hash):
    references = {}
    for lesion in result.lesions:
        region = lesion.candidate_region
        if region:
            if region.geometry_fingerprint != geometry_hash:
                raise error()
            key = str(region.artifact_id)
            if key in references and references[key] != region:
                raise error()
            references[key] = region
    if set(inputs) != set(references):
        raise error("invalid_region", "Each region requires exactly its trusted artifact input.")
    if not references:
        return None
    directory = artifact_directory(result_id)
    directory.mkdir(parents=True, exist_ok=False)
    try:
        for key, reference in references.items():
            destination = artifact_path(result_id, reference)
            snapshot = snapshot_source(Path(inputs[key]).resolve(), reference.sha256, reference.format == "nii.gz")
            try:
                with destination.open("xb") as output:
                    for block in iter(lambda: snapshot.read(1024 * 1024), b""):
                        output.write(block)
            finally:
                snapshot.close()
            props = validate_nifti_file(destination, "." + reference.format, max_voxels=settings.VASCULAI_MODEL_MAX_VOXELS)
            candidate = VolumeGeometry(shape=props.shape, array_axis_order="nifti_i_j_k", world_convention="RAS", world_unit="mm",
                affine=tuple(tuple(props.affine_flat[i:i+4]) for i in range(0, 16, 4)))
            if (props.ndim != 3 or props.xyzt_units & 7 != 2 or props.voxel_dtype != "uint8"
                    or not (props.qform_code or props.sform_code) or not same_geometry(candidate, result.provenance.geometry)):
                raise error("invalid_region", "Region geometry or voxel type does not match the source.")
            image = nib.load(str(destination))
            if image.dataobj.slope != 1 or image.dataobj.inter != 0:
                raise error("invalid_region", "Candidate regions must be unscaled binary uint8 volumes.")
            values = np.asanyarray(image.dataobj).reshape(-1)
            for start in range(0, values.size, 1024 * 1024):
                chunk = values[start:start + 1024 * 1024]
                if np.any((chunk != 0) & (chunk != 1)):
                    raise error("invalid_region", "Candidate regions must contain only binary labels.")
        return directory
    except BaseException:
        cleanup_regions(directory)
        raise


def cleanup_regions(directory):
    if directory is not None:
        # Only a newly created UUID-owned output directory, never input files.
        for path in directory.iterdir():
            path.unlink()
        directory.rmdir()


def persist_completed_result(db, job_id, token, payload, runtime, region_inputs=None, *, explanations=()):
    """Internal worker entry point. No public result-write endpoint exists."""
    directory = None
    committed = False
    explanation_directories = []
    try:
        jobs.require_runtime(runtime)
        if not isinstance(runtime.results, SQLResultStore):
            raise error("result_store_unavailable", "The canonical SQL result store is required.")
        job = jobs.running_job(db, job_id, token)
        jobs.verify_fresh_locked(db, job)
        result = AnalysisResult.model_validate(payload)
        if (result.state != "completed" or str(result.analysis_id) != job.id or result.provenance.source != jobs.source_for(job)
                or (result.provenance.method_id, result.provenance.method_version, result.provenance.checkpoint_sha256)
                != (job.method_id, job.method_version, job.checkpoint_sha256) or len(result.lesions) > MAX_LESIONS):
            raise error()
        geometry = source_geometry(db.get(Case, job.case_id))
        if not same_geometry(result.provenance.geometry, geometry):
            raise error()
        # Canonicalize to the verified source header, never resample image data.
        data = result.model_dump(mode="json")
        data["provenance"]["geometry"] = geometry.model_dump(mode="json")
        result = AnalysisResult.model_validate(data)
        fingerprint = geometry_fingerprint(geometry, job.source_sha256)
        result_id = str(uuid4())
        directory = copy_regions(result_id, result, region_inputs or {}, fingerprint)
        # A long artifact validation may outlast a lease or source version.
        job = jobs.running_job(db, job_id, token)
        jobs.verify_fresh_locked(db, job)
        db.add(StenosisAnalysisResult(id=result_id, analysis_id=job.id, case_id=job.case_id,
            parent_segmentation_result_id=job.parent_segmentation_result_id, schema_version="1.0", status="completed",
            source_sha256=job.source_sha256, geometry_fingerprint=fingerprint,
            provenance_json=result.provenance.model_dump(mode="json"), finding_count=len(result.lesions)))
        db.flush()
        for lesion in result.lesions:
            db.add(StenosisLesion(result_id=result_id, lesion_id=str(lesion.lesion_id), payload_json=lesion.model_dump(mode="json")))
        db.flush()
        # Explanation rows/files participate in this same running-job transaction.
        # No existing immutable result/lesion payload is rewritten.
        from app.services.stenosis_explanations import persist_explanation_artifact, MAX_EXPLANATIONS
        if len(explanations) > MAX_EXPLANATIONS:
            raise error("invalid_explanation", "Too many supplied explanations.")
        for supplied in explanations:
            persist_explanation_artifact(db, job_id, token, result_id, supplied, runtime, explanation_directories)
        jobs.complete_job(db, job_id, token, UUID(result_id), runtime, commit=False)
        record_event(db, "stenosis.result_saved", job.created_by, job.case_id)
        db.commit()
        committed = True
        logger.info("Stenosis result %s saved for analysis %s", result_id, job_id)
        return result_id
    except HTTPException as failure:
        db.rollback()
        code = failure.detail.get("code") if isinstance(failure.detail, dict) else None
        if code in {"source_changed", "lease_expired"}:
            try: jobs.fail_job(db, job_id, code, token)
            except HTTPException: db.rollback()
        raise
    except Exception:
        db.rollback()
        raise error() from None
    finally:
        if not committed:
            cleanup_regions(directory)
            for owned in reversed(explanation_directories):
                cleanup_regions(owned)


def retrieve_result(db, case_id, analysis_id):
    job = db.scalar(select(StenosisAnalysisJob).where(StenosisAnalysisJob.id == str(analysis_id), StenosisAnalysisJob.case_id == case_id))
    if job is None:
        raise HTTPException(404, "Analysis not found")
    if job.status != "completed":
        raise error("analysis_not_completed", "This analysis has no completed result. Its current state is " + job.status + ".")
    case = db.get(Case, case_id)
    parent = db.get(SegmentationResult, job.parent_segmentation_result_id)
    if case is None or not jobs.fresh(job, case, parent, current_source_sha256(case)):
        raise error("source_changed", "The result belongs to a stale or unverifiable source; findings were not returned.")
    result = SQLResultStore().load(db, job.result_reference) if job.result_reference else None
    if (result is None or str(result.analysis_id) != job.id or result.provenance.source != jobs.source_for(job)
            or (result.provenance.method_id, result.provenance.method_version, result.provenance.checkpoint_sha256)
            != (job.method_id, job.method_version, job.checkpoint_sha256)):
        raise error("result_integrity_failure", "The completed analysis has no matching retrievable result.")
    row = db.get(StenosisAnalysisResult, job.result_reference)
    # Parent metadata is derived from the same fingerprinted source. The worker
    # checked the actual header before persistence; readers do not decode CT again.
    if (tuple(parent.metadata_json.get("shape", [])) != result.provenance.geometry.shape
            or parent.metadata_json.get("xyzt_units", 0) & 7 != 2
            or tuple(tuple(row) for row in parent.metadata_json.get("affine", [])) != result.provenance.geometry.affine):
        raise error("result_integrity_failure", "The source geometry cannot be verified.")
    geometry = result.provenance.geometry
    return StenosisResultResponse(contract_version="1.0", result_id=row.id, case_id=case_id,
        geometry_fingerprint=row.geometry_fingerprint, visualization=visualization_state(geometry),
        segmentation=ViewerSource(id=parent.id, case_id=case_id, stale=False, metadata={
            "source_sha256": job.source_sha256, "shape": geometry.shape, "affine": geometry.affine,
            "xyzt_units": parent.metadata_json["xyzt_units"]}), result=result)


def retrieve_lesion(db, case_id, analysis_id, lesion_id):
    response = retrieve_result(db, case_id, analysis_id)
    lesion = next((item for item in response.result.lesions if str(item.lesion_id) == str(lesion_id)), None)
    if lesion is None:
        raise HTTPException(404, "Lesion not found")
    return StenosisLesionResponse(contract_version="1.0", result_id=response.result_id,
        analysis_id=analysis_id, case_id=case_id, geometry_fingerprint=response.geometry_fingerprint,
        visualization=response.visualization, provenance=response.result.provenance, lesion=lesion)
