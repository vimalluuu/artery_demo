"""Read-only findings/artifacts. Browsers cannot write provider results."""
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response

from app.models import Case, SegmentationResult
from app.routers.cases import AuthenticatedCaseReader, DatabaseSession
from app.routers.segmentation import snapshot_source, SourceSnapshotResponse, current_source_sha256
from app.schemas.stenosis_results import StenosisResultResponse, StenosisLesionResponse
from app.services import stenosis_results as results, stenosis_jobs as jobs
from app.services.audit import record_event

router = APIRouter(prefix="/cases", tags=["Stenosis results"])


@router.get("/{case_id}/stenosis/analyses/{analysis_id}/result", response_model=StenosisResultResponse)
def get_result(case_id: int, analysis_id: UUID, current_user: AuthenticatedCaseReader,
               db: DatabaseSession, response: Response):
    result = results.retrieve_result(db, case_id, analysis_id)
    record_event(db, "stenosis.result_read", current_user.id, case_id)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/{case_id}/stenosis/analyses/{analysis_id}/lesions/{lesion_id}", response_model=StenosisLesionResponse)
def get_lesion(case_id: int, analysis_id: UUID, lesion_id: UUID,
               current_user: AuthenticatedCaseReader, db: DatabaseSession, response: Response):
    result = results.retrieve_lesion(db, case_id, analysis_id, lesion_id)
    record_event(db, "stenosis.lesion_read", current_user.id, case_id)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/{case_id}/stenosis/analyses/{analysis_id}/lesions/{lesion_id}/regions/{artifact_id}")
def get_region(case_id: int, analysis_id: UUID, lesion_id: UUID, artifact_id: UUID,
               current_user: AuthenticatedCaseReader, db: DatabaseSession):
    result = results.retrieve_lesion(db, case_id, analysis_id, lesion_id)
    reference = result.lesion.candidate_region
    if reference is None or reference.artifact_id != artifact_id:
        raise HTTPException(404, "Candidate region not found")
    snapshot = None
    try:
        path = results.artifact_path(result.result_id, reference)
        snapshot = snapshot_source(path, reference.sha256, reference.format == "nii.gz")
        case = db.get(Case, case_id, populate_existing=True)
        parent = db.get(SegmentationResult, str(result.provenance.source.parent_segmentation_result_id), populate_existing=True)
        if case is None or parent is None or not jobs.fresh(result.provenance.source, case, parent, current_source_sha256(case)):
            raise results.error("source_changed", "The source changed while retrieving the region.")
        record_event(db, "stenosis.region_read", current_user.id, case_id)
        db.commit()
        response = SourceSnapshotResponse(snapshot, reference.format == "nii.gz")
        response.headers["Content-Disposition"] = f'attachment; filename="candidate_region.{reference.format}"'
        return response
    except (OSError, RuntimeError):
        if snapshot is not None: snapshot.close()
        raise results.error("artifact_unavailable", "The region artifact is unavailable or unverifiable.") from None
    except BaseException:
        if snapshot is not None: snapshot.close()
        raise
