"""Case-scoped lifecycle endpoints; no synchronous provider execution."""
from typing import Annotated
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response

from app.routers.cases import AuthenticatedCaseReader, ClinicalWriter, DatabaseSession
from app.schemas.stenosis import AnalysisRequest
from app.schemas.stenosis_jobs import AnalysisHistoryResponse, AnalysisJobResponse
from app.schemas.stenosis_reporting import AnalyticsFilters, JobStatus
from app.services import stenosis_jobs as jobs
from app.services.audit import record_event
from app.services.stenosis_runtime import ExecutionRuntime, get_runtime

router = APIRouter(prefix="/cases", tags=["Stenosis lifecycle"])
Runtime = Annotated[ExecutionRuntime | None, Depends(get_runtime)]
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128,
                                      pattern=r"^[A-Za-z0-9_-]+$")]


@router.post("/{case_id}/stenosis/analyses", response_model=AnalysisJobResponse, status_code=202,
             responses={200: {"model": AnalysisJobResponse, "description": "Existing accepted job; no retry was started"},
                        409: {"description": "Capability unavailable, stale source or idempotency conflict"}})
def start_analysis(case_id: int, request: AnalysisRequest, key: IdempotencyKey,
                   current_user: ClinicalWriter, db: DatabaseSession, runtime: Runtime, response: Response):
    result, created = jobs.accepted_job(db, case_id, request, current_user.id, key, runtime)
    response.status_code = 202 if created else 200
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/{case_id}/stenosis/analyses", response_model=AnalysisHistoryResponse)
def analysis_history(case_id: int, current_user: AuthenticatedCaseReader, db: DatabaseSession,
                     response: Response, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                     status:JobStatus|None=None,start_date:date|None=None,end_date:date|None=None,
                     method_id:str|None=Query(None,max_length=128),method_version:str|None=Query(None,max_length=128)):
    from pydantic import ValidationError
    from fastapi import HTTPException
    try: filters=AnalyticsFilters(status=status,start_date=start_date,end_date=end_date,method_id=method_id,method_version=method_version)
    except ValidationError: raise HTTPException(422,"Invalid history filters") from None
    result = jobs.history(db, case_id, limit, offset, **filters.model_dump(exclude={"case_id","patient_id"}))
    record_event(db, "stenosis.history_read", current_user.id, case_id)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/{case_id}/stenosis/analyses/{analysis_id}", response_model=AnalysisJobResponse)
def analysis_status(case_id: int, analysis_id: UUID, current_user: AuthenticatedCaseReader,
                    db: DatabaseSession, response: Response):
    result = jobs.get_job(db, case_id, analysis_id)
    record_event(db, "stenosis.status_read", current_user.id, case_id)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return result
