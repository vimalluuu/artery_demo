"""Authorized operational read models and on-demand reports; no new persistence."""
from contextlib import contextmanager
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session
from app.core.roles import CLINICAL_WRITERS
from app.routers.cases import AuthenticatedCaseReader, ClinicalWriter, DatabaseSession
from app.schemas.stenosis_reporting import AnalyticsFilters, AnalyticsSummary, AnalysisIndex, TrendResponse, StenosisReport, JobStatus
from app.services import stenosis_analytics as analytics, stenosis_reporting as reports
from app.services.audit import record_event

router = APIRouter(tags=["Stenosis analytics and reports"])
def get_filters(start_date:date|None=None,end_date:date|None=None,
                filter_case_id:int|None=Query(None,alias="case_id",gt=0),filter_patient_id:int|None=Query(None,alias="patient_id",gt=0),
                status:JobStatus|None=None,method_id:str|None=Query(None,max_length=128),method_version:str|None=Query(None,max_length=128)):
    try:
        return AnalyticsFilters(start_date=start_date,end_date=end_date,case_id=filter_case_id,patient_id=filter_patient_id,status=status,method_id=method_id,method_version=method_version).resolved()
    except ValidationError:
        raise HTTPException(422,"Invalid date window, method identity or filter combination") from None


Filters = Annotated[AnalyticsFilters, Depends(get_filters)]


@contextmanager
def snapshot(db):
    # Authentication remains database-authoritative on the request's session.
    # Domain queries use a coherent snapshot, without rolling back that session
    # or silently discarding pending caller changes. Audit writes use the original.
    bind = db.get_bind().execution_options(isolation_level="REPEATABLE READ" if db.bind.dialect.name=="postgresql" else "SERIALIZABLE")
    with Session(bind=bind,autoflush=False) as read:
        yield read


def finish(db, user, response, event, case_id=None):
    record_event(db,event,user.id,case_id);db.commit()
    response.headers["Cache-Control"]="no-store"
    response.headers["X-Content-Type-Options"]="nosniff"


@router.get("/stenosis/analytics/summary",response_model=AnalyticsSummary)
def summary(current_user:AuthenticatedCaseReader,db:DatabaseSession,response:Response,filters:Filters):
    with snapshot(db) as read: result=analytics.summary(read,filters,current_user.role in CLINICAL_WRITERS)
    finish(db,current_user,response,"stenosis.analytics_read");return result


@router.get("/stenosis/analytics/trends",response_model=TrendResponse)
def trends(current_user:AuthenticatedCaseReader,db:DatabaseSession,response:Response,filters:Filters):
    with snapshot(db) as read:
        resolved=analytics.scope(read,filters,current_user.role in CLINICAL_WRITERS)
        result=analytics.trends(read,resolved)
    finish(db,current_user,response,"stenosis.trends_read");return result


@router.get("/stenosis/analytics/analyses",response_model=AnalysisIndex)
def index(current_user:AuthenticatedCaseReader,db:DatabaseSession,response:Response,filters:Filters,limit:int=Query(20,ge=1,le=100),offset:int=Query(0,ge=0)):
    with snapshot(db) as read: result=analytics.index(read,filters,current_user.role in CLINICAL_WRITERS,limit,offset)
    finish(db,current_user,response,"stenosis.analytics_history_read");return result


@router.get("/cases/{case_id}/stenosis/analytics",response_model=AnalyticsSummary)
def case_summary(case_id:int,current_user:AuthenticatedCaseReader,db:DatabaseSession,response:Response,filters:Filters):
    from fastapi import HTTPException
    if filters.case_id is not None and filters.case_id!=case_id: raise HTTPException(404,"Matching case not found")
    filters=filters.model_copy(update={"case_id":case_id})
    with snapshot(db) as read: result=analytics.summary(read,filters,current_user.role in CLINICAL_WRITERS)
    finish(db,current_user,response,"stenosis.case_analytics_read",case_id);return result


@router.get("/patients/{patient_id}/stenosis/analytics",response_model=AnalyticsSummary)
def patient_summary(patient_id:int,current_user:ClinicalWriter,db:DatabaseSession,response:Response,filters:Filters):
    from fastapi import HTTPException
    if filters.patient_id is not None and filters.patient_id!=patient_id: raise HTTPException(404,"Matching patient not found")
    filters=filters.model_copy(update={"patient_id":patient_id})
    with snapshot(db) as read: result=analytics.summary(read,filters,True)
    finish(db,current_user,response,"stenosis.patient_analytics_read");return result


@router.get("/cases/{case_id}/stenosis/analyses/{analysis_id}/report",response_model=StenosisReport)
def get_report(case_id:int,analysis_id:UUID,current_user:AuthenticatedCaseReader,db:DatabaseSession,response:Response):
    with snapshot(db) as read: result=reports.report(read,case_id,analysis_id)
    finish(db,current_user,response,"stenosis.report_read",case_id);return result


@router.get("/cases/{case_id}/stenosis/analyses/{analysis_id}/report.csv")
def get_csv(case_id:int,analysis_id:UUID,current_user:AuthenticatedCaseReader,db:DatabaseSession):
    with snapshot(db) as read: text=reports.csv_report(reports.report(read,case_id,analysis_id))
    response=Response(content=text,media_type="text/csv",headers={"Content-Disposition":f'attachment; filename="vascuai-stenosis-{analysis_id}.csv"'})
    finish(db,current_user,response,"stenosis.report_export",case_id);return response
