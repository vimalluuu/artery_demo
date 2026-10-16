"""
volume_ingestion.py — NIfTI volume validation and metadata extraction.

Supports NIfTI-1 and NIfTI-2 files in both uncompressed (.nii) and
gzip-compressed (.nii.gz) formats.

Design:
  1. Hard, configurable limits are applied before any decompression.
  2. Gzip decompression is enforced using a bounded wrapper: we decompress
     incrementally and abort as soon as the running byte count exceeds the
     configured limit. The ISIZE field in a gzip trailer is intentionally
     NOT trusted — it is 32-bit only (wraps at 4 GiB) and is trivially
     forged.
  3. The NIfTI header (first 348/540 bytes) is parsed from the bounded
     decompression stream without loading voxel data.
  4. Voxel data is never loaded during validation.
  5. No PHI, no filenames, no file contents are logged.
"""
from __future__ import annotations

import gzip
import io
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import nibabel as nib
import numpy as np


# ---------------------------------------------------------------------------
# Configurable limits (can be overridden by Settings if wired through config)
# ---------------------------------------------------------------------------
MAX_COMPRESSED_BYTES:   int = 512 * 1024 * 1024   # 512 MB compressed upload
MAX_UNCOMPRESSED_BYTES: int = 2_000 * 1024 * 1024  # 2 000 MB decompressed NIfTI
MAX_VOXEL_COUNT:        int = 134_217_728           # 512^3  (~512 MiB as float32)
MAX_DIMENSION_SIZE:     int = 1_024                 # per-axis maximum
MAX_DIMS:               int = 4                     # 3D or 4D only; 5D+ rejected

SUPPORTED_EXTENSIONS: frozenset[str] = frozenset({".nii", ".nii.gz"})

# nibabel-recognised dtypes we accept.  Complex, non-numeric and
# implementation-defined dtypes are rejected.
ALLOWED_NP_KINDS: frozenset[str] = frozenset({
    "u",   # unsigned int  (uint8, uint16, uint32)
    "i",   # signed int    (int8, int16, int32, int64)
    "f",   # float         (float32, float64)
})


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------
class VolumeIngestionError(ValueError):
    """Raised when a volume file cannot be safely accepted.

    Message is safe to return to the client — it contains no PHI or paths.
    """


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class VolumeProperties:
    """Extracted spatial metadata.  No voxel data is stored here."""
    ndim:            int              # 3 or 4
    shape:           tuple[int, ...]  # full shape, e.g. (256, 256, 128) or (64, 64, 32, 10)
    voxel_spacing_x: float            # mm per voxel, x-axis  (pixdim[1])
    voxel_spacing_y: float            # mm per voxel, y-axis  (pixdim[2])
    voxel_spacing_z: float            # mm per voxel, z-axis  (pixdim[3])
    affine_flat:     tuple[float, ...] # 16 floats, row-major (4×4 affine)
    voxel_dtype:     str              # numpy dtype name, e.g. "float32"
    nifti_version:   int              # 1 or 2
    qform_code:      int
    sform_code:      int
    xyzt_units:      int              # raw units byte from header
    file_size_bytes: int


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
_NIFTI1_HEADER_SIZE: int = 348
_NIFTI2_HEADER_SIZE: int = 540

_NIFTI1_MAGIC_SINGLE: bytes = b"n+1\x00"   # single-file NIfTI-1
_NIFTI1_MAGIC_PAIR:   bytes = b"ni1\x00"   # header+image pair (unsupported for upload)
_NIFTI2_MAGIC_SINGLE: bytes = b"n+2\x00\r\n\x1a\n"
_NIFTI2_MAGIC_PAIR:   bytes = b"ni2\x00\r\n\x1a\n"


def _bounded_decompress(
    path: Path,
    limit: int,
    header_read_limit: int = max(_NIFTI1_HEADER_SIZE, _NIFTI2_HEADER_SIZE),
) -> bytes:
    """Decompress a gzip file incrementally up to *limit* bytes without buffering the payload.

    Raises VolumeIngestionError if the decompressed stream exceeds the limit.
    This is the primary defence against gzip bombs: we do NOT read the ISIZE
    field from the gzip trailer.

    Retains only the initial bytes (up to header_read_limit) needed for NIfTI
    header inspection, completely avoiding in-memory buffering of the full volume.
    Iterates through the entire stream to verify integrity and detect corrupt/truncated
    gzip archives.

    Returns the extracted header bytes (at most header_read_limit bytes).
    """
    header_buf = bytearray()
    total = 0
    chunk = 64 * 1024  # 64 KiB chunks

    try:
        with gzip.open(str(path), "rb") as gz:
            while True:
                block = gz.read(chunk)
                if not block:
                    break
                total += len(block)
                if total > limit:
                    raise VolumeIngestionError(
                        "Decompressed volume exceeds the maximum allowed size "
                        f"({limit // (1024 * 1024)} MB). Upload rejected."
                    )
                if len(header_buf) < header_read_limit:
                    needed = header_read_limit - len(header_buf)
                    header_buf.extend(block[:needed])
    except VolumeIngestionError:
        raise
    except (OSError, EOFError, zlib.error) as exc:
        raise VolumeIngestionError(
            "Compressed file could not be decompressed. "
            "The file may be corrupt or not a valid gzip stream."
        ) from exc

    return bytes(header_buf)


def _detect_nifti_version(header_bytes: bytes) -> int:
    """Return 1 or 2 based on the magic bytes in the header.

    Raises VolumeIngestionError if the header does not match either format.
    """
    if len(header_bytes) < _NIFTI1_HEADER_SIZE:
        raise VolumeIngestionError(
            f"File header is truncated ({len(header_bytes)} bytes). "
            "A valid NIfTI-1 header requires at least 348 bytes."
        )

    # NIfTI-1 magic is at byte 344
    magic1 = header_bytes[344:348]
    if magic1 in (_NIFTI1_MAGIC_SINGLE, _NIFTI1_MAGIC_PAIR):
        if magic1 == _NIFTI1_MAGIC_PAIR:
            raise VolumeIngestionError(
                "NIfTI header+image file pairs (.hdr/.img) are not supported. "
                "Upload a single-file NIfTI (.nii or .nii.gz)."
            )
        return 1

    # NIfTI-2 magic starts at byte 4 and is 8 bytes
    if len(header_bytes) >= _NIFTI2_HEADER_SIZE:
        magic2 = header_bytes[4:12]
        if magic2 in (_NIFTI2_MAGIC_SINGLE, _NIFTI2_MAGIC_PAIR):
            if magic2 == _NIFTI2_MAGIC_PAIR:
                raise VolumeIngestionError(
                    "NIfTI-2 header+image file pairs are not supported. "
                    "Upload a single-file NIfTI (.nii or .nii.gz)."
                )
            return 2

    raise VolumeIngestionError(
        "File does not appear to be a valid NIfTI file. "
        "Expected magic bytes for NIfTI-1 or NIfTI-2 were not found."
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def validate_nifti_extension(filename: str) -> str:
    """Return the canonical extension ('.nii' or '.nii.gz') or raise 415.

    This function only inspects the filename string; it does not open any file.
    """
    name = filename.lower()
    if name.endswith(".nii.gz"):
        return ".nii.gz"
    if name.endswith(".nii"):
        return ".nii"
    raise VolumeIngestionError(
        "Unsupported file extension. Upload a NIfTI file (.nii or .nii.gz)."
    )


def validate_nifti_file(
    path: Path,
    extension: str,
    max_uncompressed_bytes: int | None = None,
) -> VolumeProperties:
    """Validate a NIfTI file and extract spatial metadata.

    This function:
      - For .nii.gz: decompresses incrementally up to max_uncompressed_bytes
        (or MAX_UNCOMPRESSED_BYTES) in a bounded stream, extracting only the
        initial header bytes and verifying stream integrity without buffering
        voxel data in memory.
      - For .nii: reads header bytes directly from the file.
      - Parses the NIfTI-1 or NIfTI-2 header via nibabel (header-only, no mmap).
      - Validates: ndim (3–4), per-axis size, total voxel count, voxel
        spacing (positive finite), affine (finite and non-degenerate),
        and dtype.
      - Does NOT load voxel data arrays into memory.

    Returns a VolumeProperties dataclass on success.
    Raises VolumeIngestionError on any validation failure.

    Limitations documented:
      - Bounded decompression defends against gzip bombs but requires reading
        the full compressed stream to know the final decompressed size. For
        legitimate large files (approaching MAX_UNCOMPRESSED_BYTES) this may
        take several seconds.
      - nibabel is used in header-only mode (mmap=False is set on nibabel.load)
        for the metadata extraction step; this still instantiates the full
        nibabel image object but does not pull voxel data off disk.
    """
    limit = max_uncompressed_bytes if max_uncompressed_bytes is not None else MAX_UNCOMPRESSED_BYTES
    file_size = path.stat().st_size

    if file_size == 0:
        raise VolumeIngestionError("Uploaded file is empty.")

    header_read_limit = max(_NIFTI1_HEADER_SIZE, _NIFTI2_HEADER_SIZE)

    # ── 1. Read / decompress header bytes ─────────────────────────────────────
    if extension == ".nii.gz":
        raw_bytes = _bounded_decompress(path, limit, header_read_limit)
    else:
        # Uncompressed — read only enough bytes for the largest possible header.
        with path.open("rb") as f:
            raw_bytes = f.read(header_read_limit)

    # ── 2. Detect NIfTI version and validate magic bytes ──────────────────────
    nifti_version = _detect_nifti_version(raw_bytes)

    # ── 3. Load header via nibabel (no voxel data) ────────────────────────────
    # nibabel.load with mmap=False still reads header metadata correctly;
    # voxel data is only accessed when .get_fdata() / .dataobj[:] is called.
    try:
        img = nib.load(str(path), mmap=False)
    except Exception as exc:
        raise VolumeIngestionError(
            "NIfTI header could not be parsed. "
            "The file may be corrupt or use an unsupported sub-format."
        ) from exc

    header = img.header

    # ── 4. Dimensionality ──────────────────────────────────────────────────────
    shape: Sequence[int] = img.shape
    ndim = len(shape)

    if ndim < 3 or ndim > MAX_DIMS:
        raise VolumeIngestionError(
            f"Volume has {ndim} dimension(s). "
            f"Only 3D and 4D volumes are accepted."
        )

    # ── 5. Per-axis size ──────────────────────────────────────────────────────
    for axis, size in enumerate(shape):
        if size < 1:
            raise VolumeIngestionError(
                f"Volume axis {axis} has zero or negative size ({size})."
            )
        if size > MAX_DIMENSION_SIZE:
            raise VolumeIngestionError(
                f"Volume axis {axis} size ({size}) exceeds the maximum "
                f"allowed value of {MAX_DIMENSION_SIZE}."
            )

    # ── 6. Voxel count ────────────────────────────────────────────────────────
    spatial_voxels = int(shape[0]) * int(shape[1]) * int(shape[2])
    if spatial_voxels > MAX_VOXEL_COUNT:
        raise VolumeIngestionError(
            f"Spatial voxel count ({spatial_voxels:,}) exceeds the maximum "
            f"allowed value of {MAX_VOXEL_COUNT:,}."
        )

    # Check unmutated pixdim from raw header (nibabel silently repairs 0 dims to 1)
    header_klass = nib.Nifti1Header if nifti_version == 1 else nib.Nifti2Header
    header_size = _NIFTI1_HEADER_SIZE if nifti_version == 1 else _NIFTI2_HEADER_SIZE
    try:
        raw_header = header_klass(raw_bytes[:header_size], check=False)
        raw_zooms = raw_header.get_zooms()
        if len(raw_zooms) >= 3:
            for label, val in zip(("x", "y", "z"), raw_zooms[:3]):
                if not np.isfinite(val):
                    raise VolumeIngestionError(
                        f"Voxel spacing along {label}-axis is not finite ({val})."
                    )
                if float(val) <= 0.0:
                    raise VolumeIngestionError(
                        f"Voxel spacing along {label}-axis must be positive (got {float(val)} mm)."
                    )
    except VolumeIngestionError:
        raise
    except Exception:
        pass

    try:
        pixdim = header.get_zooms()  # returns (x, y, z) for 3D, or (x,y,z,t) for 4D
    except Exception as exc:
        raise VolumeIngestionError(
            "Could not extract voxel spacing (pixdim) from header."
        ) from exc

    if len(pixdim) < 3:
        raise VolumeIngestionError(
            "Header does not contain spatial voxel spacing information."
        )

    spacing_x, spacing_y, spacing_z = float(pixdim[0]), float(pixdim[1]), float(pixdim[2])

    for label, val in (("x", spacing_x), ("y", spacing_y), ("z", spacing_z)):
        if not np.isfinite(val):
            raise VolumeIngestionError(
                f"Voxel spacing along {label}-axis is not finite ({val})."
            )
        if val <= 0.0:
            raise VolumeIngestionError(
                f"Voxel spacing along {label}-axis must be positive (got {val} mm)."
            )
        if val > 100.0:
            raise VolumeIngestionError(
                f"Voxel spacing along {label}-axis ({val} mm) exceeds 100 mm. "
                "This value is implausible for a medical volume."
            )

    # ── 8. Affine ─────────────────────────────────────────────────────────────
    affine: np.ndarray = img.affine
    if not np.all(np.isfinite(affine)):
        raise VolumeIngestionError(
            "Volume affine matrix contains non-finite values (NaN or Inf)."
        )
    det = float(np.linalg.det(affine[:3, :3]))
    if abs(det) < 1e-6:
        raise VolumeIngestionError(
            f"Volume affine matrix is degenerate (determinant = {det:.2e}). "
            "The volume coordinate system cannot be reliably interpreted."
        )

    # ── 9. Data type ──────────────────────────────────────────────────────────
    try:
        dtype = np.dtype(header.get_data_dtype())
    except Exception as exc:
        raise VolumeIngestionError(
            "Could not determine voxel data type from header."
        ) from exc

    if dtype.kind not in ALLOWED_NP_KINDS:
        raise VolumeIngestionError(
            f"Unsupported voxel data type: '{dtype}' (kind '{dtype.kind}'). "
            "Accepted types: unsigned int, signed int, float."
        )

    # ── 10. qform / sform codes ───────────────────────────────────────────────
    try:
        qform_code = int(header.get("qform_code", 0))
        sform_code = int(header.get("sform_code", 0))
        xyzt_units = int(header.get("xyzt_units", 0))
    except Exception:
        qform_code = 0
        sform_code = 0
        xyzt_units = 0

    return VolumeProperties(
        ndim=ndim,
        shape=tuple(int(s) for s in shape),
        voxel_spacing_x=spacing_x,
        voxel_spacing_y=spacing_y,
        voxel_spacing_z=spacing_z,
        affine_flat=tuple(float(v) for v in affine.flatten()),
        voxel_dtype=dtype.name,
        nifti_version=nifti_version,
        qform_code=qform_code,
        sform_code=sform_code,
        xyzt_units=xyzt_units,
        file_size_bytes=file_size,
    )
