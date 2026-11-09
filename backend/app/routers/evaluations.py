"""Protected offline evidence endpoints, independent of the frontend dashboard."""
from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from app.core.dependencies import require_roles
from app.core.roles import Role
from app.models import User
from app.routers.cases import AuthenticatedCaseReader, DatabaseSession
from app.schemas.evaluation import (EvaluationImport, ArtifactResponse, EvaluationSummary, EvaluationCases,
                                    EvaluationComparison, ModelRuns, StenosisEvaluationSections)
from app.services import evaluations as service
from app.services.audit import record_event

router = APIRouter(tags=["Offline evaluations"])
Importer = Annotated[User, Depends(require_roles(Role.DATA_SCIENTIST, Role.ADMIN))]


def finish(db, user, response, event):
    record_event(db, event, user.id)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"


@router.post("/evaluations/artifacts", status_code=201, response_model=ArtifactResponse)
def upload_artifact(current_user: Importer, db: DatabaseSession, response: Response, file: UploadFile = File(...)):
    # UUID storage names, bounded content validation; user filenames are never paths.
    data = file.file.read(service.MAX_ARTIFACT_BYTES + 1)
    value = service.upload(db, current_user, data)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return value


@router.post("/evaluations/import", status_code=201, response_model=EvaluationSummary)
def import_evaluation(request: EvaluationImport, current_user: Importer, db: DatabaseSession, response: Response):
    row, created = service.import_result(db, current_user, request)
    response.status_code = 201 if created else 200
    value = service.summary(*service.load(db, row.id))
    finish(db, current_user, response, "evaluation.import_readback")
    return value


@router.get("/evaluations/compare", response_model=EvaluationComparison)
def compare(current_user: AuthenticatedCaseReader, db: DatabaseSession, response: Response,
            ids: str = Query(..., max_length=400)):
    try:
        values = [UUID(value.strip()) for value in ids.split(",")]
        if not 2 <= len(values) <= 10 or len(set(values)) != len(values):
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Provide 2–10 distinct evaluation UUIDs separated by commas") from None
    result = service.comparison(db, values)
    finish(db, current_user, response, "evaluation.compared")
    return result


@router.get("/evaluations/{evaluation_id}/summary", response_model=EvaluationSummary)
def summary(evaluation_id: UUID, current_user: AuthenticatedCaseReader, db: DatabaseSession, response: Response):
    result = service.summary(*service.load(db, evaluation_id))
    finish(db, current_user, response, "evaluation.summary_read")
    return result


@router.get("/evaluations/{evaluation_id}/cases", response_model=EvaluationCases)
def cases(evaluation_id: UUID, current_user: AuthenticatedCaseReader, db: DatabaseSession, response: Response):
    result = service.case_details(*service.load(db, evaluation_id))
    finish(db, current_user, response, "evaluation.cases_read")
    return result


@router.get("/models/{model_id}/runs", response_model=ModelRuns)
def model_runs(model_id: str, current_user: AuthenticatedCaseReader, db: DatabaseSession, response: Response,
               limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=service.MAX_HISTORY_OFFSET)):
    result = service.model_runs(db, model_id, limit=limit, offset=offset)
    finish(db, current_user, response, "evaluation.model_runs_read")
    return result


@router.get("/stenosis/evaluations/{evaluation_id}/cases/{case_id}/sections", response_model=StenosisEvaluationSections)
def sections(evaluation_id: UUID, case_id: int, current_user: AuthenticatedCaseReader, db: DatabaseSession, response: Response):
    result = service.sections(db, evaluation_id, case_id)
    finish(db, current_user, response, "evaluation.stenosis_sections_read")
    return result
