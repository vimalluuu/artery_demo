
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
from app.services.volume_ingestion import (
    MAX_COMPRESSED_BYTES,
    VolumeIngestionError,
    validate_nifti_extension,
    validate_nifti_file,
)
from app.database.session import get_db
from app.models import Case, Patient, User, VolumeMetadata
from app.schemas.case import (
    CaseCreate,
    CaseResponse,
    CaseUpdate,
    ImageMetadata,
    VolumeMetadataResponse,
)


router = APIRouter(prefix="/cases", tags=["Cases"])

MAX_IMAGE_SIZE = 20 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}

UPLOAD_DIR = Path(settings.UPLOAD_DIR).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Sub-directory for NIfTI volumes
VOLUME_DIR = UPLOAD_DIR / "volumes"
VOLUME_DIR.mkdir(parents=True, exist_ok=True)

# Per-upload byte limits for volumes (sourced from settings for testability)
MAX_VOLUME_COMPRESSED        = settings.MAX_VOLUME_COMPRESSED_MB        * 1024 * 1024
MAX_VOLUME_UNCOMPRESSED_FILE = settings.MAX_VOLUME_UNCOMPRESSED_FILE_MB * 1024 * 1024
MAX_VOLUME_UNCOMPRESSED      = settings.MAX_VOLUME_UNCOMPRESSED_MB      * 1024 * 1024

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


# ─── Volume upload ────────────────────────────────────────────────────────────

@router.post(
    "/{case_id}/volume",
    response_model=CaseResponse,
)
def upload_case_volume(
    case_id: int,
    current_user: ClinicalWriter,
    db: DatabaseSession,
    file: Annotated[UploadFile, File(...)],
) -> CaseResponse:
    """Upload a NIfTI volume (.nii or .nii.gz) for a case.

    Accepted formats: NIfTI-1 and NIfTI-2 in uncompressed (.nii) or
    gzip-compressed (.nii.gz) form.  3D and 4D volumes are accepted;
    voxel data is never loaded.

    Size limits:
      - Uncompressed .nii: settings.MAX_VOLUME_UNCOMPRESSED_FILE_MB (default 2000 MB)
      - Compressed .nii.gz: settings.MAX_VOLUME_COMPRESSED_MB (default 512 MB) upload
        stream limit PLUS bounded decompression up to settings.MAX_VOLUME_UNCOMPRESSED_MB
        (default 2000 MB).

    RBAC: Clinician / Admin only.
    """
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )

    # ── Extension check (filename only; content verified later) ───────────────
    try:
        extension = validate_nifti_extension(file.filename or "")
    except VolumeIngestionError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=str(exc),
        ) from exc

    if extension == ".nii.gz":
        upload_limit = MAX_VOLUME_COMPRESSED
        limit_mb = settings.MAX_VOLUME_COMPRESSED_MB
        kind = "compressed (.nii.gz)"
    else:
        upload_limit = MAX_VOLUME_UNCOMPRESSED_FILE
        limit_mb = settings.MAX_VOLUME_UNCOMPRESSED_FILE_MB
        kind = "uncompressed (.nii)"

    # ── Stream to a temp file inside VOLUME_DIR ───────────────────────────────
    temporary_path = VOLUME_DIR / f".{uuid4().hex}.upload{extension}"
    saved_path: Path | None = None

    try:
        total_size = 0
        with temporary_path.open("xb") as dest:
            while True:
                chunk = file.file.read(1024 * 1024)   # 1 MiB chunks
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > upload_limit:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"Volume upload exceeds the {limit_mb} MB limit "
                            f"for {kind} volumes."
                        ),
                    )
                dest.write(chunk)

        if total_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty.",
            )

        # ── NIfTI header validation (no voxel data loaded) ────────────────────
        try:
            props = validate_nifti_file(
                temporary_path,
                extension,
                max_uncompressed_bytes=MAX_VOLUME_UNCOMPRESSED,
            )
        except VolumeIngestionError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        # ── Atomic rename to a UUID-based filename inside VOLUME_DIR ──────────
        stored_name = f"{uuid4().hex}{extension}"
        saved_path = VOLUME_DIR / stored_name
        temporary_path.replace(saved_path)

        # Relative path stored in DB (relative to UPLOAD_DIR, not absolute)
        relative_volume_path = str(
            saved_path.relative_to(UPLOAD_DIR)
        ).replace("\\", "/")   # normalise separators on Windows

        previous_volume_path = case.volume_path
        case.volume_path = relative_volume_path

        # ── Upsert VolumeMetadata row ─────────────────────────────────────────
        existing_meta = db.scalar(
            select(VolumeMetadata).where(VolumeMetadata.case_id == case_id)
        )
        affine = props.affine_flat  # 16 floats
        meta_kwargs = dict(
            case_id=case_id,
            dim_x=props.shape[0],
            dim_y=props.shape[1],
            dim_z=props.shape[2],
            dim_t=props.shape[3] if props.ndim == 4 else None,
            voxel_spacing_x=props.voxel_spacing_x,
            voxel_spacing_y=props.voxel_spacing_y,
            voxel_spacing_z=props.voxel_spacing_z,
            aff_00=affine[0],  aff_01=affine[1],  aff_02=affine[2],  aff_03=affine[3],
            aff_10=affine[4],  aff_11=affine[5],  aff_12=affine[6],  aff_13=affine[7],
            aff_20=affine[8],  aff_21=affine[9],  aff_22=affine[10], aff_23=affine[11],
            aff_30=affine[12], aff_31=affine[13], aff_32=affine[14], aff_33=affine[15],
            voxel_dtype=props.voxel_dtype,
            nifti_version=props.nifti_version,
            qform_code=props.qform_code,
            sform_code=props.sform_code,
            xyzt_units=props.xyzt_units,
            file_size_bytes=props.file_size_bytes,
            uploader_id=current_user.id,
        )

        if existing_meta is None:
            db.add(VolumeMetadata(**meta_kwargs))
        else:
            for key, val in meta_kwargs.items():
                setattr(existing_meta, key, val)

        try:
            record_event(db, "case.volume_uploaded", current_user.id, case.id)
            db.commit()
            db.refresh(case)
        except Exception:
            db.rollback()
            saved_path.unlink(missing_ok=True)
            saved_path = None
            raise

        # ── Delete the previous volume file only after commit succeeds ─────────
        if previous_volume_path:
            old_abs = (UPLOAD_DIR / previous_volume_path).resolve()
            if (
                old_abs != saved_path
                and old_abs.is_relative_to(VOLUME_DIR)
            ):
                old_abs.unlink(missing_ok=True)

        return case

    finally:
        temporary_path.unlink(missing_ok=True)
        file.file.close()


@router.get(
    "/{case_id}/volume/metadata",
    response_model=VolumeMetadataResponse,
)
def get_case_volume_metadata(
    case_id: int,
    current_user: AuthenticatedCaseReader,
    db: DatabaseSession,
) -> VolumeMetadataResponse:
    """Return the stored spatial metadata for a case's uploaded NIfTI volume.

    Does not return the volume file itself, voxel data, or any PHI.
    RBAC: all authenticated roles.
    """
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found",
        )

    if not case.volume_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No volume has been uploaded for this case.",
        )

    # Safety: resolve stored relative path under VOLUME_DIR
    resolved = (UPLOAD_DIR / case.volume_path).resolve()
    if not resolved.is_relative_to(VOLUME_DIR):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stored volume path is invalid.",
        )

    if not resolved.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Volume file is missing from storage.",
        )

    meta = db.scalar(
        select(VolumeMetadata).where(VolumeMetadata.case_id == case_id)
    )
    if meta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Volume metadata record not found.",
        )

    record_event(db, "case.volume_metadata_read", current_user.id, case.id)
    db.commit()

    return VolumeMetadataResponse(
        case_id=case_id,
        ndim=3 if meta.dim_t is None else 4,
        shape_x=meta.dim_x,
        shape_y=meta.dim_y,
        shape_z=meta.dim_z,
        shape_t=meta.dim_t,
        voxel_spacing_x=meta.voxel_spacing_x,
        voxel_spacing_y=meta.voxel_spacing_y,
        voxel_spacing_z=meta.voxel_spacing_z,
        affine=[
            meta.aff_00, meta.aff_01, meta.aff_02, meta.aff_03,
            meta.aff_10, meta.aff_11, meta.aff_12, meta.aff_13,
            meta.aff_20, meta.aff_21, meta.aff_22, meta.aff_23,
            meta.aff_30, meta.aff_31, meta.aff_32, meta.aff_33,
        ],
        voxel_dtype=meta.voxel_dtype,
        nifti_version=meta.nifti_version,
        qform_code=meta.qform_code,
        sform_code=meta.sform_code,
        xyzt_units=meta.xyzt_units,
        file_size_bytes=meta.file_size_bytes,
        uploaded_at=meta.uploaded_at,
    )
