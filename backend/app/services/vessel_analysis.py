"""Standalone 3D binary-vessel analysis utilities."""

from __future__ import annotations

from typing import TypedDict

import numpy as np
from scipy.ndimage import distance_transform_edt
from skimage.measure import label
from skimage.morphology import skeletonize


class RemovedComponent(TypedDict):
    label: int
    voxel_count: int
    volume: float


class ComponentFilterReport(TypedDict):
    component_count: int
    kept_component_count: int
    removed_component_count: int
    kept_voxel_count: int
    removed_voxel_count: int
    min_component_volume: float
    voxel_volume: float
    removed_components: list[RemovedComponent]


def _validate_binary_volume(mask: np.ndarray, name: str = "mask") -> np.ndarray:
    """Return a 3D boolean mask, rejecting malformed or non-binary inputs."""
    array = np.asarray(mask)
    if array.ndim != 3 or any(size == 0 for size in array.shape):
        raise ValueError(f"{name} must be a non-empty 3D array")
    if array.dtype != np.bool_:
        if not np.issubdtype(array.dtype, np.number):
            raise ValueError(f"{name} must contain only binary values")
        if not np.isfinite(array).all() or not np.isin(array, (0, 1)).all():
            raise ValueError(f"{name} must contain only binary values")
    return array.astype(bool, copy=False)


def _validate_voxel_spacing(
    voxel_spacing: tuple[float, float, float],
) -> tuple[float, float, float]:
    """Validate spacing in array-axis order and return it as a float tuple."""
    spacing = np.asarray(voxel_spacing, dtype=float)
    if spacing.shape != (3,) or not np.isfinite(spacing).all() or np.any(spacing <= 0):
        raise ValueError("voxel_spacing must contain three finite positive values")
    return tuple(float(value) for value in spacing)


def extract_centerline(mask: np.ndarray) -> np.ndarray:
    """Extract a topology-preserving 3D skeleton from a binary vessel mask.

    The returned boolean array has the same shape as ``mask``. In 3D,
    scikit-image's Lee thinning algorithm preserves connectivity while
    reducing the foreground to a one-voxel-wide skeleton.
    """
    binary_mask = _validate_binary_volume(mask)
    return skeletonize(binary_mask, method="lee")


def estimate_diameter(
    mask: np.ndarray,
    centerline: np.ndarray,
    voxel_spacing: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> np.ndarray:
    """Estimate local vessel diameter at centerline voxels.

    Returns a float array matching ``mask``; values away from the centerline
    are zero, and centerline values are twice the physical EDT radius.
    Spacing is supplied in the same axis order as the 3D arrays.

    This is an approximate radius-based measure: it can overestimate diameter
    near branch junctions, where several vessel limbs contribute to the
    distance field, and underestimate it near endpoints or truncated vessel
    boundaries.
    """
    binary_mask = _validate_binary_volume(mask)
    binary_centerline = _validate_binary_volume(centerline, "centerline")
    if binary_centerline.shape != binary_mask.shape:
        raise ValueError("centerline and mask must have the same shape")
    if np.any(binary_centerline & ~binary_mask):
        raise ValueError("centerline must be contained within mask")

    spacing = _validate_voxel_spacing(voxel_spacing)
    radii = distance_transform_edt(binary_mask, sampling=spacing)
    diameters = np.zeros(binary_mask.shape, dtype=np.float64)
    diameters[binary_centerline] = 2.0 * radii[binary_centerline]
    return diameters


def filter_connected_components(
    mask: np.ndarray,
    min_component_volume: float,
    voxel_spacing: tuple[float, float, float] = (1.0, 1.0, 1.0),
    connectivity: int = 3,
) -> tuple[np.ndarray, ComponentFilterReport]:
    """Remove 3D connected components smaller than a physical-volume threshold.

    ``min_component_volume`` and ``voxel_spacing`` use consistent physical
    units (for example, mm³ and mm). Connectivity follows scikit-image's
    convention: 1, 2, or 3 means 6-, 18-, or 26-neighbor connectivity.
    Components exactly at the threshold are retained. The returned mask is
    boolean; the report lists each removed component and its voxel/physical
    volume.
    """
    binary_mask = _validate_binary_volume(mask)
    spacing = _validate_voxel_spacing(voxel_spacing)
    if not np.isfinite(min_component_volume) or min_component_volume < 0:
        raise ValueError("min_component_volume must be finite and non-negative")
    if not isinstance(connectivity, (int, np.integer)) or connectivity not in (1, 2, 3):
        raise ValueError("connectivity must be 1, 2, or 3")

    voxel_volume = float(np.prod(spacing))
    component_labels = label(binary_mask, connectivity=int(connectivity))
    component_sizes = np.bincount(component_labels.ravel())
    component_sizes[0] = 0
    component_volumes = component_sizes.astype(np.float64) * voxel_volume
    keep_labels = np.flatnonzero(component_volumes >= min_component_volume)
    keep_labels = keep_labels[keep_labels != 0]
    kept_mask = np.isin(component_labels, keep_labels)

    removed_labels = np.flatnonzero(
        (component_sizes > 0) & (component_volumes < min_component_volume)
    )
    removed_components: list[RemovedComponent] = [
        {
            "label": int(component_id),
            "voxel_count": int(component_sizes[component_id]),
            "volume": float(component_volumes[component_id]),
        }
        for component_id in removed_labels
    ]

    component_count = int(np.count_nonzero(component_sizes))
    kept_voxel_count = int(np.count_nonzero(kept_mask))
    removed_voxel_count = int(binary_mask.sum()) - kept_voxel_count
    report: ComponentFilterReport = {
        "component_count": component_count,
        "kept_component_count": int(keep_labels.size),
        "removed_component_count": len(removed_components),
        "kept_voxel_count": kept_voxel_count,
        "removed_voxel_count": removed_voxel_count,
        "min_component_volume": float(min_component_volume),
        "voxel_volume": voxel_volume,
        "removed_components": removed_components,
    }
    return kept_mask, report