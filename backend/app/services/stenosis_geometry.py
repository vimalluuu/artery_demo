"""Canonical source-grid identity; no resampling or anatomical interpretation."""
import hashlib
from math import isclose
import struct

from app.schemas.stenosis import VolumeGeometry
from app.schemas.stenosis_results import VisualizationState

PREFIX = b"vascuai-geometry-v1\0RAS\0mm\0nifti_i_j_k\0"


def geometry_fingerprint(geometry: VolumeGeometry, source_sha256: str) -> str:
    values = [0.0 if value == 0 else value for row in geometry.affine for value in row]
    raw = PREFIX + bytes.fromhex(source_sha256) + struct.pack("<3I16d", *geometry.shape, *values)
    return hashlib.sha256(raw).hexdigest()


def same_geometry(a: VolumeGeometry, b: VolumeGeometry) -> bool:
    return a.shape == b.shape and all(isclose(x, y, rel_tol=1e-6, abs_tol=1e-4)
        for ra, rb in zip(a.affine, b.affine) for x, y in zip(ra, rb))


def visualization_state(geometry: VolumeGeometry) -> VisualizationState:
    used = set()
    for column in range(3):
        values = [row[column] for row in geometry.affine[:3]]
        length = sum(value * value for value in values) ** .5
        axes = [i for i, value in enumerate(values) if abs(value) > length * .99999]
        if (len(axes) != 1 or axes[0] in used
                or any(abs(value) > 1e-5 for i, value in enumerate(values) if i != axes[0])):
            return VisualizationState(status="unsupported_geometry", reason="Oblique or sheared source geometry is not supported by the current viewer. Use protected downloads in a desktop imaging application.")
        used.add(axes[0])
    return VisualizationState(status="supported", reason="Coded, axis-aligned RAS millimetre geometry; matching headers do not establish anatomical correctness.")
