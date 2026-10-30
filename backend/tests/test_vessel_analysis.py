"""Synthetic regression tests for 3D vessel-analysis utilities."""

import numpy as np
import pytest
from skimage.measure import label

from app.services.vessel_analysis import (
    estimate_diameter,
    extract_centerline,
    filter_connected_components,
)


def _make_y_shaped_mask() -> np.ndarray:
    """Create a connected Y-shaped vessel from synthetic voxels."""
    mask = np.zeros((31, 31, 15), dtype=bool)

    # The trunk runs along array axis 0; two arms extend diagonally from it.
    mask[4:26, 14:17, 6:9] = True
    for sign in (-1, 1):
        for offset in range(10):
            z_center = 15 + offset
            y_center = 15 + sign * offset
            mask[z_center - 1 : z_center + 2, y_center - 1 : y_center + 2, 6:9] = True

    return mask


def test_y_branch_centerline_remains_connected():
    mask = _make_y_shaped_mask()

    centerline = extract_centerline(mask)

    assert centerline.dtype == np.bool_
    assert centerline.shape == mask.shape
    assert centerline.any()
    assert np.all(~centerline | mask)
    assert label(mask, connectivity=3).max() == 1
    assert label(centerline, connectivity=3).max() == 1


def test_even_width_tube_disappearance_is_reported_in_diagnostics():
    mask = np.zeros((24, 20, 20), dtype=bool)
    mask[3:21, 8:12, 8:12] = True

    centerline, diagnostics = extract_centerline(mask, return_diagnostics=True)

    assert centerline.shape == mask.shape
    assert not centerline.any()
    assert diagnostics["disappeared_components"] == [1]
    assert diagnostics["fragmented_components"] == {}
    assert diagnostics["warning"]


def test_diameter_matches_known_discrete_tube_diameter():
    mask = np.zeros((20, 17, 17), dtype=bool)
    mask[2:18, 5:12, 5:12] = True
    centerline = np.zeros_like(mask)
    centerline[5:15, 8, 8] = True

    diameters = estimate_diameter(mask, centerline)
    measured = diameters[5:15, 8, 8]

    # The square cross-section is seven voxels wide. At its central voxel,
    # the nearest background voxel center is four voxel units away, so the EDT
    # radius is 4 and the reported diameter (twice the radius) is 8.
    assert measured.size == 10
    assert measured == pytest.approx(np.full(10, 8.0), abs=0.01)
    assert np.count_nonzero(diameters[~centerline]) == 0


def test_anisotropic_spacing_uses_numpy_axis_order_strictly():
    mask = np.zeros((31, 24, 34), dtype=bool)
    mask[2:29, 5:12, 5:26] = True
    centerline = np.zeros_like(mask)
    centerline[15, 8, 15] = True
    spacing = (4.0, 2.0, 0.5)

    diameter = estimate_diameter(mask, centerline, voxel_spacing=spacing)[15, 8, 15]

    # Axis 1 reaches background after 4 voxels (physical distance 8);
    # axis 2 reaches it after 11 voxels (physical distance 5.5). Thus the
    # nearest background is 5.5 units away and the diameter is 11. Reversing
    # the spacing tuple would instead make the axis-1 distance 8 and return 16.
    assert diameter == pytest.approx(11.0, abs=0.01)
    assert diameter != pytest.approx(16.0, abs=0.01)


def test_component_threshold_keeps_exact_and_above_removes_below():
    mask = np.zeros((1, 1, 3005), dtype=bool)
    mask[0, 0, 1:1000] = True  # 999 voxels: just below the threshold.
    mask[0, 0, 1001:2001] = True  # 1000 voxels: at the threshold.
    mask[0, 0, 2002:3003] = True  # 1001 voxels: just above the threshold.
    spacing = (0.07, 0.07, 0.07)
    threshold = 0.343

    filtered, report = filter_connected_components(
        mask,
        min_component_volume=threshold,
        voxel_spacing=spacing,
        connectivity=1,
    )

    below_component_volume = 999 * report["voxel_volume"]
    exact_component_volume = 1000 * report["voxel_volume"]
    above_component_volume = 1001 * report["voxel_volume"]
    assert exact_component_volume == pytest.approx(threshold, abs=1e-7)
    assert below_component_volume < threshold
    assert above_component_volume > threshold
    assert not filtered[0, 0, 1:1000].any()
    assert filtered[0, 0, 1001:2001].all()
    assert filtered[0, 0, 2002:3003].all()
    assert report["component_count"] == 3
    assert report["kept_component_count"] == 2
    assert report["removed_component_count"] == 1
    assert report["removed_voxel_count"] == 999
    assert report["kept_voxel_count"] == 2001


def test_component_filter_keeps_legitimate_islands_and_removes_small_positives():
    mask = np.zeros((24, 24, 24), dtype=bool)
    mask[2:7, 2:7, 2:7] = True
    mask[14:18, 14:18, 14:18] = True
    mask[10, 2, 15] = True
    mask[10:12, 20:22, 2:4] = True

    filtered, report = filter_connected_components(
        mask,
        min_component_volume=10,
        connectivity=1,
    )

    assert filtered.dtype == np.bool_
    assert report["component_count"] == 4
    assert report["kept_component_count"] == 2
    assert report["removed_component_count"] == 2
    assert report["removed_voxel_count"] == 9
    assert report["kept_voxel_count"] == 189
    assert sorted(
        component["voxel_count"] for component in report["removed_components"]
    ) == [1, 8]
    assert filtered[2:7, 2:7, 2:7].all()
    assert filtered[14:18, 14:18, 14:18].all()
    assert not filtered[10, 2, 15]
    assert not filtered[10:12, 20:22, 2:4].any()


def test_all_zero_volume_returns_empty_analysis_results():
    mask = np.zeros((4, 5, 6), dtype=bool)

    centerline, diagnostics = extract_centerline(mask, return_diagnostics=True)
    diameters = estimate_diameter(mask, centerline)
    filtered, report = filter_connected_components(mask, min_component_volume=0.0)

    assert not centerline.any()
    assert diagnostics["disappeared_components"] == []
    assert diagnostics["fragmented_components"] == {}
    assert not diameters.any()
    assert not filtered.any()
    assert report["component_count"] == 0
    assert report["kept_component_count"] == 0
    assert report["removed_component_count"] == 0


def test_zero_sized_volume_is_rejected():
    mask = np.zeros((0, 3, 3), dtype=bool)

    with pytest.raises(ValueError, match="non-empty 3D array"):
        extract_centerline(mask)
    with pytest.raises(ValueError, match="non-empty 3D array"):
        estimate_diameter(mask, mask)
    with pytest.raises(ValueError, match="non-empty 3D array"):
        filter_connected_components(mask, min_component_volume=1.0)


def test_single_voxel_volume_is_handled():
    mask = np.zeros((3, 3, 3), dtype=bool)
    mask[1, 1, 1] = True

    centerline = extract_centerline(mask)
    diameters = estimate_diameter(mask, centerline)
    filtered, report = filter_connected_components(mask, min_component_volume=1.0)

    assert centerline.sum() == 1
    assert centerline[1, 1, 1]
    assert diameters[1, 1, 1] == pytest.approx(2.0, abs=0.01)
    assert filtered[1, 1, 1]
    assert report["component_count"] == 1
    assert report["kept_component_count"] == 1


@pytest.mark.parametrize(
    "mask",
    [
        pytest.param(np.zeros((3, 3), dtype=bool), id="two-dimensional"),
        pytest.param(np.zeros((2, 2, 2, 2), dtype=bool), id="four-dimensional"),
        pytest.param(np.array([[[0, 2]]]), id="non-binary-numeric"),
        pytest.param(np.array([[["not binary"]]]), id="non-numeric"),
        pytest.param(np.asarray(None), id="scalar"),
    ],
)
def test_invalid_mask_types_and_dimensions_are_rejected(mask):
    valid_centerline = np.zeros((3, 3, 3), dtype=bool)

    with pytest.raises(ValueError):
        extract_centerline(mask)
    with pytest.raises(ValueError):
        estimate_diameter(mask, valid_centerline)
    with pytest.raises(ValueError):
        filter_connected_components(mask, min_component_volume=1.0)


def test_diameter_rejects_mismatched_or_out_of_mask_centerline():
    mask = np.zeros((5, 5, 5), dtype=bool)
    mask[1:4, 1:4, 1:4] = True
    mismatched_centerline = np.zeros((4, 5, 5), dtype=bool)
    outside_centerline = np.zeros_like(mask)
    outside_centerline[0, 0, 0] = True

    with pytest.raises(ValueError, match="same shape"):
        estimate_diameter(mask, mismatched_centerline)
    with pytest.raises(ValueError, match="contained within mask"):
        estimate_diameter(mask, outside_centerline)


@pytest.mark.parametrize(
    "spacing",
    [
        pytest.param((1.0, 0.0, 1.0), id="zero"),
        pytest.param((1.0, float("nan"), 1.0), id="nan"),
        pytest.param((1.0, 2.0), id="wrong-length"),
    ],
)
def test_invalid_spacing_is_rejected(spacing):
    mask = np.ones((3, 3, 3), dtype=bool)
    centerline = np.zeros_like(mask)
    centerline[1, 1, 1] = True

    with pytest.raises(ValueError, match="voxel_spacing"):
        estimate_diameter(mask, centerline, voxel_spacing=spacing)
