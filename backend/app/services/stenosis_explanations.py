"""Trusted supplied-attribution persistence; no attribution computation."""
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
import nibabel as nib
import numpy as np
from sqlalchemy import select

from app.core.config import settings
from app.models import StenosisExplanationArtifact, StenosisLesion, StenosisAnalysisResult
from app.schemas.stenosis_explanations import ExplanationSubmission, ExplanationDetails, ExplanationMetadata, ExplanationList, MAX_EXPLANATIONS
from app.services import stenosis_results as results, stenosis_jobs as jobs
from app.services.stenosis_geometry import same_geometry, geometry_fingerprint, visualization_state
from app.services.volume_ingestion import validate_nifti_file
from app.routers.segmentation import snapshot_source

MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
MAX_EXPANDED_BYTES = 384 * 1024 * 1024
MAX_VOXELS = 67_108_864


@dataclass(frozen=True)
class SuppliedExplanation:
    """Worker-only path binding. Never parsed from a browser/API request."""
    metadata: ExplanationSubmission | dict
    path: Path


def error(code="invalid_explanation", message="The supplied attribution or its provenance could not be verified.", status=409):
    return results.error(code, message, status)


def artifact_path(result_id, explanation_id, artifact_id, format):
    base = Path(settings.OUTPUT_DIR).resolve() / "stenosis-explanations"
    directory = (base / str(UUID(str(result_id))) / str(UUID(str(explanation_id)))).resolve()
    if directory.parent.parent != base:
        raise error("artifact_unavailable")
    if format not in {"nii", "nii.gz"}: raise error()
    path = (directory / (str(UUID(str(artifact_id))) + "." + format)).resolve()
    if path.parent != directory: raise error("artifact_unavailable")
    return path


def validate_values(path, metadata):
    if path.stat().st_size > MAX_ARTIFACT_BYTES:
        raise error("artifact_too_large", "The attribution exceeds the file-size limit.")
    props = validate_nifti_file(path, "." + metadata.format, max_uncompressed_bytes=MAX_EXPANDED_BYTES, max_voxels=MAX_VOXELS)
    from app.schemas.stenosis import VolumeGeometry
    actual = VolumeGeometry(shape=props.shape, affine=tuple(tuple(props.affine_flat[i:i+4]) for i in range(0,16,4)),
        array_axis_order="nifti_i_j_k", world_convention="RAS", world_unit="mm")
    if (props.ndim != 3 or props.voxel_dtype != "float32" or props.xyzt_units & 7 != 2
        or not (props.sform_code or props.qform_code) or not same_geometry(actual, metadata.geometry)):
        raise error("invalid_attribution_geometry", "Attribution must be coded, millimetre, float32 data on the original source grid.")
    image = nib.load(path)
    if image.dataobj.slope != 1 or image.dataobj.inter != 0:
        raise error("invalid_attribution_values", "Attribution data must use identity NIfTI scaling; values are never silently normalized.")
    # Already bounded to <= 67M float32 voxels; no float64 get_fdata copy.
    values = np.asanyarray(image.dataobj)
    lo, hi = metadata.values.expected_range
    tolerance = max(1., abs(lo), abs(hi)) * 1e-6
    for start in range(values.shape[0]):
        chunk = values[start]
        if not np.isfinite(chunk).all() or np.any(chunk < lo - tolerance) or np.any(chunk > hi + tolerance):
            raise error("invalid_attribution_values", "Attribution values are non-finite or outside their declared range.")
        if metadata.values.value_type == "non_negative" and np.any(chunk < 0):
            raise error("invalid_attribution_values", "Non-negative attribution contains negative values.")
    if metadata.scope == "slice":
        # Full-grid representation; out-of-plane values must be exactly zero.
        for index in range(metadata.shape[metadata.slice_axis]):
            if index != metadata.slice_index and np.any(np.take(values,index,axis=metadata.slice_axis) != 0):
                raise error("invalid_slice_attribution", "Slice attribution contains values outside its declared original-array plane.")


def persist_explanation_artifact(db, job_id, token, result_id, supplied, runtime, owned):
    """Join the *uncommitted* result transaction; never commits or mutates results.

    Called by persist_completed_result after result/lesion inserts and before
    lifecycle completion. `owned` tracks newly created paths for caller rollback.
    """
    jobs.require_runtime(runtime)
    job = jobs.running_job(db, job_id, token, fail_on_expiry=False)
    jobs.verify_fresh_locked(db, job, mark_failed=False)
    row = db.get(StenosisAnalysisResult, str(result_id))
    result = results.SQLResultStore().load(db, result_id)
    if row is None or result is None or row.analysis_id != job.id or result.provenance.source != jobs.source_for(job): raise error()
    value = ExplanationSubmission.model_validate(supplied.metadata)
    if (str(value.analysis_id) != job.id or value.source_sha256 != job.source_sha256
        or value.geometry != result.provenance.geometry or value.geometry_fingerprint != row.geometry_fingerprint
        or value.checkpoint_sha256 != job.checkpoint_sha256): raise error()
    if value.lesion_id is not None and db.get(StenosisLesion, (str(result_id), str(value.lesion_id))) is None:
        raise error("explanation_association_mismatch", "The explanation lesion does not belong to this result.")
    providers = [p for p in runtime.explanations if (p.method_id,p.method_version,p.model_id,p.model_version,p.checkpoint_sha256)
        == (value.method_id,value.method_version,value.model_id,value.model_version,value.checkpoint_sha256)]
    if len(providers) != 1 or providers[0].verify_target(value.target,result,value.lesion_id) is not True:
        raise error("explanation_provider_unavailable", "A reviewed compatible provider must verify the genuine prediction target.")
    if db.get(StenosisExplanationArtifact,str(value.explanation_id)) is not None: raise error("explanation_already_exists")
    destination = artifact_path(result_id,value.explanation_id,value.artifact_id,value.format)
    # Check before mkdir so an existing directory is never enlisted for cleanup.
    destination.parent.mkdir(parents=True,exist_ok=False)
    owned.append(destination.parent)
    path = Path(supplied.path).resolve()
    if path.stat().st_size > MAX_ARTIFACT_BYTES: raise error("artifact_too_large")
    try:
        snapshot = snapshot_source(path,value.content_sha256,value.format=="nii.gz",max_bytes=MAX_ARTIFACT_BYTES)
    except HTTPException:
        raise error("artifact_integrity_failure", "The supplied attribution checksum could not be verified.") from None
    try:
        with destination.open("xb") as output:
            size=0
            for block in iter(lambda:snapshot.read(1024*1024),b""):
                size+=len(block)
                if size>MAX_ARTIFACT_BYTES: raise error("artifact_too_large")
                output.write(block)
    finally: snapshot.close()
    validate_values(destination,value)
    details = ExplanationDetails.model_validate(value.model_dump(include=set(ExplanationDetails.model_fields)))
    db.add(StenosisExplanationArtifact(id=str(value.explanation_id),result_id=str(result_id),analysis_id=job.id,
        lesion_id=str(value.lesion_id) if value.lesion_id else None,artifact_id=str(value.artifact_id),metadata_json=details.model_dump(mode="json")))
    db.flush()
    # Reparse stored metadata and associations, in the same transaction.
    stored = load_metadata(db, result_id, result)
    if not any(item.explanation_id==value.explanation_id for item in stored): raise error()
    return value.explanation_id


def load_metadata(db, result_id, result):
    rows=db.scalars(select(StenosisExplanationArtifact).where(StenosisExplanationArtifact.result_id==str(result_id))
        .order_by(StenosisExplanationArtifact.id).limit(MAX_EXPLANATIONS+1).with_for_update(read=True)).all()
    if len(rows)>MAX_EXPLANATIONS: raise error("explanation_integrity_failure")
    items=[]
    try:
        source=result.provenance.source
        fingerprint=geometry_fingerprint(result.provenance.geometry,source.source_sha256)
        lesions={item.lesion_id for item in result.lesions}
        for row in rows:
            detail=ExplanationDetails.model_validate(row.metadata_json)
            if (str(detail.explanation_id)!=row.id or str(detail.artifact_id)!=row.artifact_id or str(result.analysis_id)!=row.analysis_id
                or (str(detail.lesion_id) if detail.lesion_id else None)!=row.lesion_id
                or (detail.lesion_id is not None and detail.lesion_id not in lesions)
                or detail.checkpoint_sha256!=result.provenance.checkpoint_sha256): raise ValueError()
            items.append(ExplanationMetadata(**detail.model_dump(),analysis_id=result.analysis_id,result_id=UUID(str(result_id)),
                source_sha256=source.source_sha256,geometry_fingerprint=fingerprint,geometry=result.provenance.geometry,
                visualization=visualization_state(result.provenance.geometry)))
    except (ValueError,TypeError,KeyError):
        raise error("explanation_integrity_failure", "Explanation metadata or its source association is inconsistent.") from None
    return items


def list_explanations(db,case_id,analysis_id):
    root=results.retrieve_result(db,case_id,analysis_id)
    items=load_metadata(db,root.result_id,root.result)
    status="not_generated" if not items else "available" if root.visualization.status=="supported" else "unsupported_geometry"
    return ExplanationList(contract_version="1.0",case_id=case_id,analysis_id=analysis_id,result_id=root.result_id,
        status=status,items=items,unavailable_reason={"code":"not_provided","message":"No explanation was generated for this completed result. This says nothing about feature importance."} if not items else None)
