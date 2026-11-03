"""Protected supplied-attribution reads. No HTTP generator or writer."""
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response

from app.models import Case, SegmentationResult
from app.routers.cases import AuthenticatedCaseReader, DatabaseSession
from app.routers.segmentation import snapshot_source, SourceSnapshotResponse, current_source_sha256
from app.schemas.stenosis_explanations import ExplanationList
from app.services import stenosis_explanations as explanations, stenosis_jobs as jobs
from app.services.audit import record_event

router=APIRouter(prefix="/cases",tags=["Stenosis explanations"])


@router.get("/{case_id}/stenosis/analyses/{analysis_id}/explanations",response_model=ExplanationList)
def list_explanations(case_id:int,analysis_id:UUID,current_user:AuthenticatedCaseReader,db:DatabaseSession,response:Response):
    result=explanations.list_explanations(db,case_id,analysis_id)
    record_event(db,"stenosis.explanations_read",current_user.id,case_id);db.commit()
    response.headers["Cache-Control"]="no-store"
    return result


@router.get("/{case_id}/stenosis/analyses/{analysis_id}/explanations/{explanation_id}/artifact")
def get_artifact(case_id:int,analysis_id:UUID,explanation_id:UUID,current_user:AuthenticatedCaseReader,db:DatabaseSession):
    result=explanations.list_explanations(db,case_id,analysis_id)
    item=next((value for value in result.items if value.explanation_id==explanation_id),None)
    if item is None: raise HTTPException(404,"Explanation not found")
    path=explanations.artifact_path(result.result_id,item.explanation_id,item.artifact_id,item.format)
    if not path.is_file(): raise explanations.error("artifact_unavailable","The attribution artifact is missing from private storage.",404)
    snapshot=None
    try:
        if path.stat().st_size>explanations.MAX_ARTIFACT_BYTES: raise explanations.error("artifact_integrity_failure")
        try: snapshot=snapshot_source(path,item.content_sha256,item.format=="nii.gz",max_bytes=explanations.MAX_ARTIFACT_BYTES)
        except HTTPException: raise explanations.error("artifact_integrity_failure","The attribution content checksum could not be verified.") from None
        case=db.get(Case,case_id,populate_existing=True)
        source=jobs.get_job(db,case_id,analysis_id).provenance.source
        parent=db.get(SegmentationResult,str(source.parent_segmentation_result_id),populate_existing=True)
        if case is None or parent is None or not jobs.fresh(source,case,parent,current_source_sha256(case)):
            raise explanations.error("source_changed","The source changed during attribution retrieval.")
        record_event(db,"stenosis.explanation_artifact_read",current_user.id,case_id);db.commit()
        response=SourceSnapshotResponse(snapshot,item.format=="nii.gz")
        response.headers["Content-Disposition"]=f'attachment; filename="model_attribution.{item.format}"'
        return response
    except (OSError,RuntimeError):
        if snapshot is not None: snapshot.close()
        raise explanations.error("artifact_unavailable","The attribution artifact could not be retrieved.") from None
    except BaseException:
        if snapshot is not None: snapshot.close()
        raise
