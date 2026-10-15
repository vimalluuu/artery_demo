
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import cv2
import tifffile
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.dependencies import require_roles
from app.core.roles import CASE_READERS, CLINICAL_WRITERS
from app.services.audit import record_event
from app.database.session import get_db
from app.models import Case, Patient, User
from app.schemas.case import CaseCreate, CaseResponse, CaseUpdate, ImageMetadata


router = APIRouter(prefix="/cases", tags=["Cases"])

MAX_IMAGE_SIZE = 20 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}

UPLOAD_DIR = Path(settings.UPLOAD_DIR).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DatabaseSession = Annotated[Session, Depends(get_db)]

ClinicalWriter = Annotated[
    User,
    Depends(require_roles(*CLINICAL_WRITERS)),
]

AuthenticatedCaseReader = Annotated[
    User,
    Depends(require_roles(*CASE_READERS)),
]


def validate_image_file(path: Path, extension: str) -> None:
    try:
        if extension in {".tif", ".tiff"}:
            with tifffile.TiffFile(path) as image_file:
                if not image_file.pages:
                    raise ValueError("TIFF contains no image pages")
                page = image_file.pages[0]
                if page.imagewidth > MAX_IMAGE_DIMENSION or page.imagelength > MAX_IMAGE_DIMENSION:
                    raise ValueError("Image dimensions exceed limit")
                page.asarray()
        else:
            with Image.open(path) as image:
                if image.format not in {"PNG", "JPEG"}:
                    raise ValueError("Unsupported image format")
                image.verify()

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        tifffile.TiffFileError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is not a valid supported image",
        ) from exc


@router.post(
    "",
    response_model=CaseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_case(
    case_data: CaseCreate,
    current_user: ClinicalWriter,
    db: DatabaseSession,
):
    if db.get(Patient, case_data.patient_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found",
        )

    existing_case = db.scalar(
        select(Case).where(Case.case_code == case_data.case_code)
    )
    if existing_case:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Case code already exists",
        )

    case = Case(**case_data.model_dump())
    db.add(case)

    try:
        db.flush()
        record_event(db, "case.created", current_user.id, case.id)
        db.commit()
        db.refresh(case)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Case could not be created because of a data conflict",
        ) from exc

    return case


@router.get("", response_model=list[CaseResponse])
def list_cases(
    current_user: AuthenticatedCaseReader,
    db: DatabaseSession,
):
    statement = select(Case).order_by(Case.id.desc())
    record_event(db, "case.list_read", current_user.id)
    db.commit()
    return db.scalars(statement).all()


@router.get("/{case_id}", response_model=CaseResponse)
def get_case(
    case_id: int,
    current_user: AuthenticatedCaseReader,
    db: DatabaseSession,
):
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )
    record_event(db, "case.read", current_user.id, case.id)
    db.commit()
    return case


@router.patch(
    "/{case_id}",
    response_model=CaseResponse,
)
def update_case_metadata(
    case_id: int,
    updates: CaseUpdate,
    current_user: ClinicalWriter,
    db: DatabaseSession,
):
    """Partial update of mutable case fields.

    Only fields present in the request body (non-None) are written.
    Immutable fields (patient_id, case_code, status, image_path,
    created_at) are silently ignored if sent.
    RBAC: Clinician / Admin only.
    """
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )

    mutable = {"study_type", "modality", "region", "scan_date",
               "age_years", "sex", "notes"}
    changed = False
    for field, value in updates.model_dump(exclude_none=True).items():
        if field in mutable:
            setattr(case, field, value)
            changed = True

    if changed:
        record_event(db, "case.updated", current_user.id, case.id)
        db.commit()
        db.refresh(case)

    return case


@router.post(
    "/{case_id}/image",
    response_model=CaseResponse,
)
def upload_case_image(
    case_id: int,
    current_user: ClinicalWriter,
    db: DatabaseSession,
    file: Annotated[UploadFile, File(...)],
):
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )

    extension = Path(Path(file.filename or "").name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Supported formats: PNG, JPEG, and TIFF",
        )

    temporary_path = UPLOAD_DIR / f".{uuid4().hex}.upload"
    saved_path = None

    try:
        total_size = 0

        with temporary_path.open("xb") as destination:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break

                total_size += len(chunk)
                if total_size > MAX_IMAGE_SIZE:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Image exceeds the 20 MB limit",
                    )

                destination.write(chunk)

        if total_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )

        validate_image_file(temporary_path, extension)

        # Check dimensions before decoding the full image for preprocessing.
        if extension in {".tif", ".tiff"}:
            with tifffile.TiffFile(temporary_path) as image_file:
                page = image_file.pages[0]
                width, height = page.imagewidth, page.imagelength
        else:
            with Image.open(temporary_path) as image:
                width, height = image.size

        if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Image dimensions must not exceed 8192 pixels per side",
            )

        stored_name = f"{uuid4().hex}{extension}"
        saved_path = UPLOAD_DIR / stored_name
        temporary_path.replace(saved_path)

        previous_path = case.image_path
        case.image_path = str(saved_path)

        try:
            record_event(db, "case.image_uploaded", current_user.id, case.id)
            db.commit()
            db.refresh(case)
        except Exception:
            db.rollback()
            saved_path.unlink(missing_ok=True)
            saved_path = None
            raise

        if previous_path:
            old_path = Path(previous_path).resolve()
            if old_path.parent == UPLOAD_DIR and old_path != saved_path:
                old_path.unlink(missing_ok=True)

        return case

    finally:
        temporary_path.unlink(missing_ok=True)
        file.file.close()


@router.get("/{case_id}/image/metadata", response_model=ImageMetadata)
def get_case_image_metadata(
    case_id: int,
    current_user: AuthenticatedCaseReader,
    db: DatabaseSession,
):
    case = db.get(Case, case_id)

    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )

    if not case.image_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No image has been uploaded for this case",
        )

    image_path = Path(case.image_path).resolve()

    # Never read arbitrary paths stored in a database record.
    if image_path.parent != UPLOAD_DIR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stored image path is invalid",
        )

    if not image_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image file is missing from storage",
        )

    try:
        # Reuse the same validation and preprocessing conventions.
        extension = image_path.suffix.lower()
        validate_image_file(image_path, extension)

        if extension in {".tif", ".tiff"}:
            with tifffile.TiffFile(image_path) as image_file:
                page = image_file.pages[0]
                width, height = page.imagewidth, page.imagelength
                channels = page.samplesperpixel
                pixel_dtype = str(page.dtype)
        else:
            with Image.open(image_path) as image:
                width, height = image.size
                channels = len(image.getbands())
                pixels = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
                if pixels is None:
                    raise ValueError("Image could not be decoded")
                pixel_dtype = str(pixels.dtype)

    except (OSError, ValueError, tifffile.TiffFileError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stored image could not be inspected",
        ) from exc

    record_event(db, "case.image_metadata_read", current_user.id, case.id)
    db.commit()
    return {
        "case_id": case.id,
        "case_code": case.case_code,
        "filename": image_path.name,
        "format": extension.lstrip(".").upper(),
        "width": width,
        "height": height,
        "channels": channels,
        "pixel_dtype": pixel_dtype,
        "file_size_bytes": image_path.stat().st_size,
    }
