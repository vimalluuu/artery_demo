"""Bounded NIfTI validation without loading voxel arrays or extension payloads.

The original file is preserved. Spacing and affine values remain in the spatial
units recorded by the header; callers must not assume millimeters.
"""
from __future__ import annotations

import gzip
import math
import zlib
from dataclasses import dataclass
from pathlib import Path

import nibabel as nib
import numpy as np

MAX_COMPRESSED_BYTES = 512 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 2_000 * 1024 * 1024
MAX_VOXEL_COUNT = 134_217_728
MAX_DIMENSION_SIZE = 1_024
MAX_DIMS = 4
SUPPORTED_EXTENSIONS = frozenset({".nii", ".nii.gz"})
ALLOWED_NP_KINDS = frozenset({"u", "i", "f"})
_NIFTI1_HEADER_SIZE = 348
_NIFTI2_HEADER_SIZE = 540


class VolumeIngestionError(ValueError):
    """An input error safe to return without paths, filenames, or patient data."""


@dataclass(frozen=True)
class VolumeProperties:
    ndim: int
    shape: tuple[int, ...]
    voxel_spacing_x: float
    voxel_spacing_y: float
    voxel_spacing_z: float
    affine_flat: tuple[float, ...]
    voxel_dtype: str
    nifti_version: int
    qform_code: int
    sform_code: int
    xyzt_units: int
    file_size_bytes: int


def _inspect_gzip(path: Path, limit: int, header_read_limit: int) -> tuple[bytes, int]:
    """Check the entire gzip stream and CRC while retaining at most 540 bytes.

    Counting actual expanded bytes avoids trusting the forgeable gzip ISIZE.
    The byte count also detects a complete gzip containing a truncated NIfTI.
    """
    header = bytearray()
    total = 0
    try:
        with gzip.open(path, "rb") as stream:
            while block := stream.read(64 * 1024):
                total += len(block)
                if total > limit:
                    raise VolumeIngestionError(
                        "Decompressed volume exceeds the maximum allowed size "
                        f"({limit // (1024 * 1024)} MB). Upload rejected."
                    )
                if len(header) < header_read_limit:
                    header.extend(block[:header_read_limit - len(header)])
    except VolumeIngestionError:
        raise
    except (OSError, EOFError, zlib.error) as exc:
        raise VolumeIngestionError("Compressed file is corrupt or not a valid gzip stream.") from exc
    return bytes(header), total


def _bounded_decompress(path: Path, limit: int, header_read_limit: int = 540) -> bytes:
    """Compatibility helper returning only the bounded header buffer."""
    return _inspect_gzip(path, limit, header_read_limit)[0]


def _detect_nifti_version(header_bytes: bytes) -> int:
    if len(header_bytes) < 348:
        raise VolumeIngestionError("File header is truncated; NIfTI-1 requires 348 bytes.")
    if header_bytes[344:348] == b"ni1\x00" or header_bytes[4:12] == b"ni2\x00\r\n\x1a\n":
        raise VolumeIngestionError("NIfTI header+image pairs are not supported. Upload .nii or .nii.gz.")
    if header_bytes[344:348] == b"n+1\x00":
        return 1
    if len(header_bytes) >= 540 and header_bytes[4:12] == b"n+2\x00\r\n\x1a\n":
        return 2
    raise VolumeIngestionError("File is not a valid single-file NIfTI-1 or NIfTI-2 volume.")


def validate_nifti_extension(filename: str) -> str:
    name = filename.lower()
    for extension in (".nii.gz", ".nii"):
        if name.endswith(extension):
            return extension
    raise VolumeIngestionError("Unsupported file extension. Upload a NIfTI file (.nii or .nii.gz).")


def validate_nifti_file(
    path: Path,
    extension: str,
    max_uncompressed_bytes: int | None = None,
    max_voxels: int | None = None,
) -> VolumeProperties:
    """Validate raw headers, complete payload size, geometry, and input limits.

    No nibabel image loader is used: it can read attacker-sized NIfTI extension
    blocks before the application has checked the header's payload declaration.
    Raw header parsing also avoids silently repairing invalid spatial metadata.
    """
    if extension not in SUPPORTED_EXTENSIONS:
        raise VolumeIngestionError("Unsupported volume format. Upload .nii or .nii.gz.")
    limit = MAX_UNCOMPRESSED_BYTES if max_uncompressed_bytes is None else max_uncompressed_bytes
    voxel_limit = MAX_VOXEL_COUNT if max_voxels is None else max_voxels
    file_size = path.stat().st_size
    if file_size == 0:
        raise VolumeIngestionError("Uploaded file is empty.")
    if extension == ".nii.gz":
        raw_bytes, expanded_size = _inspect_gzip(path, limit, 540)
    else:
        expanded_size = file_size
        if file_size > limit:
            raise VolumeIngestionError("Volume exceeds the maximum allowed uncompressed size.")
        with path.open("rb") as stream:
            raw_bytes = stream.read(540)

    version = _detect_nifti_version(raw_bytes)
    header_type = nib.Nifti1Header if version == 1 else nib.Nifti2Header
    header_size = 348 if version == 1 else 540
    try:
        header = header_type(raw_bytes[:header_size], check=False)
        if int(header["sizeof_hdr"]) != header_size:
            raise VolumeIngestionError("NIfTI header size does not match its format.")
        ndim = int(header["dim"][0])
        if not 3 <= ndim <= MAX_DIMS:
            raise VolumeIngestionError(f"Volume has {ndim} dimensions; only 3D and 4D are accepted.")
        shape = tuple(int(value) for value in header["dim"][1:ndim + 1])
        for axis, size in enumerate(shape):
            if size < 1 or size > MAX_DIMENSION_SIZE:
                raise VolumeIngestionError(f"Volume axis {axis} size is outside 1–{MAX_DIMENSION_SIZE}.")
        spatial_voxels = math.prod(shape[:3])
        if spatial_voxels > voxel_limit:
            raise VolumeIngestionError(f"Spatial voxel count ({spatial_voxels:,}) exceeds the maximum ({voxel_limit:,}).")

        dtype = np.dtype(header.get_data_dtype())
        if dtype.kind not in ALLOWED_NP_KINDS:
            raise VolumeIngestionError("Unsupported voxel data type; use unsigned integer, integer, or float.")
        if int(header["bitpix"]) != dtype.itemsize * 8:
            raise VolumeIngestionError("Voxel data type and bit depth do not agree.")

        offset = float(header["vox_offset"])
        if not math.isfinite(offset) or not offset.is_integer() or offset < header_type.single_vox_offset:
            raise VolumeIngestionError("NIfTI voxel payload offset is invalid.")
        # Include the time axis for 4D data and the bytes before the voxel array.
        expected_bytes = int(offset) + math.prod(shape) * dtype.itemsize
        if expected_bytes > limit:
            raise VolumeIngestionError("Declared voxel payload exceeds the maximum uncompressed byte limit.")
        if expanded_size < expected_bytes:
            raise VolumeIngestionError("NIfTI voxel payload is truncated; fewer bytes exist than the header declares.")

        spacing = tuple(float(value) for value in header["pixdim"][1:4])
        units = int(header["xyzt_units"])
        millimeter_factor = {1: 1000.0, 2: 1.0, 3: 0.001}.get(units & 7)
        for axis, value in zip("xyz", spacing):
            if not math.isfinite(value) or value <= 0:
                raise VolumeIngestionError(f"Voxel spacing along {axis}-axis must be positive and finite.")
            if millimeter_factor is not None and value * millimeter_factor > 100:
                raise VolumeIngestionError(f"Voxel spacing along {axis}-axis exceeds 100 mm in the declared spatial units.")

        affine = np.asarray(header.get_best_affine(), dtype=float)
        if not np.all(np.isfinite(affine)):
            raise VolumeIngestionError("Volume affine contains non-finite values.")
        # A relative singularity check works equally in meters, mm, and microns.
        scales = np.max(np.abs(affine[:3, :3]), axis=0)
        if np.any(scales == 0) or abs(float(np.linalg.det(affine[:3, :3] / scales))) < 1e-6:
            raise VolumeIngestionError("Volume affine is degenerate; spatial coordinates cannot be interpreted.")
    except VolumeIngestionError:
        raise
    except (ValueError, TypeError, KeyError, OverflowError, np.linalg.LinAlgError, nib.spatialimages.HeaderDataError) as exc:
        raise VolumeIngestionError("NIfTI header could not be interpreted safely.") from exc

    return VolumeProperties(
        ndim=ndim, shape=shape,
        voxel_spacing_x=spacing[0], voxel_spacing_y=spacing[1], voxel_spacing_z=spacing[2],
        affine_flat=tuple(float(value) for value in affine.flatten()),
        voxel_dtype=dtype.name, nifti_version=version,
        qform_code=int(header["qform_code"]), sform_code=int(header["sform_code"]),
        xyzt_units=units, file_size_bytes=file_size,
    )
