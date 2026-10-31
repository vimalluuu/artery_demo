"""Read-only capability information; no stenosis execution routes."""
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.core.dependencies import require_roles
from app.core.roles import CASE_READERS
from app.models import User
from app.schemas.stenosis import CapabilitiesResponse
from app.services.stenosis import capabilities

router = APIRouter(prefix="/stenosis", tags=["Stenosis capabilities"])
CaseReader = Annotated[User, Depends(require_roles(*CASE_READERS))]


@router.get("/capabilities", response_model=CapabilitiesResponse)
def get_capabilities(current_user: CaseReader, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return capabilities()
