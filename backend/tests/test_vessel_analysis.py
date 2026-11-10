"""Synthetic regression tests for 3D vessel-analysis utilities."""

import numpy as np
import pytest
from skimage.measure import label

from app.services import vessel_analysis
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


def _make_t_shaped_mask() -> tuple[np.ndarray, list[tuple[slice, slice, slice]]]:
    mask = np.zeros((35, 35, 35), dtype=bool)
    mask[4:30, 15:20, 15:20] = True
    mask[4:9, 5:30, 15:20] = True
    tips = [
        (slice(25, 30), slice(15, 20), slice(15, 20)),
        (slice(4, 9), slice(5, 10), slice(15, 20)),
        (slice(4, 9), slice(25, 30), slice(15, 20)),
    ]
    return mask, tips


def _make_multibranch_mask() -> tuple[np.ndarray, list[tuple[slice, slice, slice]]]:
    mask = np.zeros((35, 35, 35), dtype=bool)
    mask[3:32, 15:20, 15:20] = True
    mask[14:19, 3:32, 15:20] = True
    mask[14:19, 15:20, 3:32] = True
    tips = [
        (slice(3, 8), slice(15, 20), slice(15, 20)),
        (slice(27, 32), slice(15, 20), slice(15, 20)),
        (slice(15, 20), slice(3, 8), slice(15, 20)),
        (slice(15, 20), slice(27, 32), slice(15, 20)),
        (slice(15, 20), slice(15, 20), slice(3, 8)),
        (slice(15, 20), slice(15, 20), slice(27, 32)),
    ]
    return mask, tips


@pytest.mark.parametrize(
    "mask_and_tips,center_region",
    [
        pytest.param(
            _make_t_shaped_mask,
            (slice(13, 22), slice(13, 22), slice(13, 22)),
            id="T-shaped",
        ),
        pytest.param(
            lambda: (
                _make_y_shaped_mask(),
                [
                    (slice(4, 9), slice(14, 17), slice(6, 9)),
                    (slice(22, 27), slice(4, 9), slice(6, 9)),
                    (slice(22, 27), slice(21, 27), slice(6, 9)),
                ],
            ),
            (slice(12, 19), slice(12, 19), slice(6, 9)),
            id="Y-shaped",
        ),
        pytest.param(
            _make_multibranch_mask,
            (slice(13, 21), slice(13, 21), slice(13, 21)),
            id="multi-branch",
        ),
    ],
)
def test_branch_skeleton_preserves_each_arm_to_the_junction(mask_and_tips, center_region):
    mask, tip_regions = mask_and_tips()

    centerline, diagnostics = extract_centerline(mask, return_diagnostics=True)

    assert centerline.dtype == np.bool_
    assert centerline.shape == mask.shape
    assert centerline.any()
    assert np.all(~centerline | mask)
    assert label(mask, connectivity=3).max() == 1
    assert label(centerline, connectivity=3).max() == 1
    center_labels = np.unique(label(centerline, connectivity=3)[center_region])
    center_labels = center_labels[center_labels > 0]
    assert center_labels.size == 1
    skeleton_labels = label(centerline, connectivity=3)
    for tip_region in tip_regions:
        tip_labels = np.unique(skeleton_labels[tip_region])
        tip_labels = tip_labels[tip_labels > 0]
        assert tip_labels.size == 1
        assert tip_labels[0] == center_labels[0]
    assert diagnostics["input_component_count"] == 1
    assert diagnostics["output_skeleton_component_count"] == 1


@pytest.mark.parametrize("width", [2, 4, 6])
def test_even_width_components_disappear_and_are_reported(width):
    mask = np.zeros((40, 32, 32), dtype=bool)
    mask[5:35, 14 : 14 + width, 14 : 14 + width] = True

    centerline, diagnostics = extract_centerline(mask, return_diagnostics=True)

    assert centerline.shape == mask.shape
    assert not centerline.any()
    assert diagnostics["input_component_count"] == 1
    assert diagnostics["output_skeleton_component_count"] == 0
    assert diagnostics["disappeared_components"] == [1]
    assert diagnostics["fragmented_components"] == {}
    assert diagnostics["warning"]


def test_mixed_even_width_loss_and_odd_width_survival_are_reported():
    mask = np.zeros((36, 52, 52), dtype=bool)
    placements = [(4, 4, 2), (4, 20, 4), (24, 4, 6), (24, 24, 3)]
    for y, x, width in placements:
        mask[4:32, y : y + width, x : x + width] = True

    centerline, diagnostics = extract_centerline(mask, return_diagnostics=True)

    assert centerline.any()
    assert centerline[4:32, 24:27, 24:27].any()
    assert not centerline[4:32, 4:6, 4:6].any()
    assert not centerline[4:32, 4:8, 20:24].any()
    assert not centerline[4:32, 24:30, 4:10].any()
    assert diagnostics["input_component_count"] == 4
    assert diagnostics["output_skeleton_component_count"] == 1
    assert diagnostics["disappeared_components"] == [1, 2, 3]
    assert diagnostics["fragmented_components"] == {}


def test_fragmentation_diagnostics_map_each_source_component_correctly(monkeypatch):
    mask = np.zeros((24, 24, 24), dtype=bool)
    mask[2:8, 2:8, 2:8] = True
    mask[2:8, 14:20, 2:8] = True
    mask[14:20, 2:8, 2:8] = True
    synthetic_skeleton = np.zeros_like(mask)
    synthetic_skeleton[3, 3, 3] = True
    synthetic_skeleton[6, 6, 6] = True
    synthetic_skeleton[3, 15, 3] = True
    monkeypatch.setattr(
        vessel_analysis,
        "skeletonize",
        lambda _mask, method: synthetic_skeleton,
    )

    centerline, diagnostics = extract_centerline(mask, return_diagnostics=True)

    assert np.array_equal(centerline, synthetic_skeleton)
    assert diagnostics["input_component_count"] == 3
    assert diagnostics["output_skeleton_component_count"] == 3
    assert diagnostics["disappeared_components"] == [3]
    assert diagnostics["fragmented_components"] == {1: [1, 3]}


def test_centerline_default_return_remains_skeleton_array():
    mask = np.zeros((9, 9, 9), dtype=bool)
    mask[2:7, 4:5, 4:5] = True

    result = extract_centerline(mask)

    assert isinstance(result, np.ndarray)
    assert result.dtype == np.bool_


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


def test_anisotropic_spacing_reversal_returns_fourteen_not_sixteen():
    mask = np.zeros((31, 24, 34), dtype=bool)
    mask[2:29, 5:12, 9:22] = True
    centerline = np.zeros_like(mask)
    centerline[15, 8, 15] = True
    spacing = (1.0, 2.0, 2.0)

    diameter = estimate_diameter(mask, centerline, voxel_spacing=spacing)[15, 8, 15]
    reversed_diameter = estimate_diameter(
        mask, centerline, voxel_spacing=spacing[::-1]
    )[15, 8, 15]

    # Correct order: axis 1 radius is 8; axis 2 radius is 14, giving 16.
    # Reversed order: the nearest boundary is 7 physical units away, giving 14.
    assert diameter == pytest.approx(16.0, abs=0.01)
    assert reversed_diameter == pytest.approx(14.0, abs=0.01)


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


@pytest.mark.parametrize(
    "unit_scale",
    [
        pytest.param(1.0, id="mm3"),
        pytest.param(1e-9, id="m3"),
    ],
)
@pytest.mark.parametrize(
    "component_factor,threshold_factor,should_keep",
    [
        pytest.param(1.0, 1.1, False, id="clearly-below"),
        pytest.param(1.0, 1.0 + 5e-6, True, id="slightly-below-within-tolerance"),
        pytest.param(1.0, 1.0, True, id="exact"),
        pytest.param(1.0 + 5e-6, 1.0, True, id="slightly-above"),
    ],
)
def test_volume_threshold_comparison_is_scale_aware(
    unit_scale, component_factor, threshold_factor, should_keep
):
    mask = np.zeros((3, 3, 3), dtype=bool)
    mask[1, 1, 1] = True
    # The anisotropic voxel product is exactly one mm³ before unit conversion.
    component_volume = unit_scale * component_factor
    threshold = threshold_factor * unit_scale
    spacing = (2.0, 0.5, component_volume)

    filtered, report = filter_connected_components(
        mask,
        min_component_volume=threshold,
        voxel_spacing=spacing,
        connectivity=1,
    )

    assert bool(filtered[1, 1, 1]) is should_keep
    assert report["component_count"] == 1
    assert report["kept_component_count"] == int(should_keep)
    assert report["removed_component_count"] == int(not should_keep)
    assert report["removed_voxel_count"] == int(not should_keep)
    if should_keep:
        assert report["removed_components"] == []
    else:
        assert report["removed_components"][0]["label"] == 1
        assert report["removed_components"][0]["voxel_count"] == 1
        assert report["removed_components"][0]["volume"] == pytest.approx(
            component_volume
        )


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


def test_unit_conversion_mm_to_meters_yields_equivalent_filtering():
    mask = np.zeros((10, 10, 10), dtype=bool)
    mask[2:4, 2:4, 2:4] = True  # 2x2x2 = 8 voxels

    filtered_mm, report_mm = filter_connected_components(
        mask,
        voxel_spacing=(1.0, 1.0, 1.0),
        min_component_volume=5.0,
    )
    filtered_m, report_m = filter_connected_components(
        mask,
        voxel_spacing=(1e-3, 1e-3, 1e-3),
        min_component_volume=5.0 * 1e-9,
    )

    assert np.array_equal(filtered_mm, filtered_m)
    assert report_mm["kept_voxel_count"] == report_m["kept_voxel_count"] == 8
    assert report_mm["kept_component_count"] == report_m["kept_component_count"] == 1


@pytest.mark.parametrize(
    "invalid_spacing",
    [
        (0.0, 1.0, 1.0),
        (-1.0, 1.0, 1.0),
        (np.nan, 1.0, 1.0),
        (np.inf, 1.0, 1.0),
        (1.0, 1.0),
    ],
)
def test_invalid_spacing_is_rejected_in_filtering(invalid_spacing):
    mask = np.ones((3, 3, 3), dtype=bool)

    with pytest.raises(ValueError):
        filter_connected_components(
            mask,
            voxel_spacing=invalid_spacing,
            min_component_volume=1.0,
        )


@pytest.mark.parametrize(
    "invalid_threshold",
    [-1.0, np.nan, np.inf, -np.inf],
)
def test_invalid_threshold_is_rejected(invalid_threshold):
    mask = np.ones((3, 3, 3), dtype=bool)

    with pytest.raises(ValueError):
        filter_connected_components(
            mask,
            voxel_spacing=(1.0, 1.0, 1.0),
            min_component_volume=invalid_threshold,
        )


@pytest.mark.parametrize(
    "invalid_connectivity",
    [0, 4, -1, None, 1.5],
)
def test_invalid_connectivity_is_rejected(invalid_connectivity):
    mask = np.ones((3, 3, 3), dtype=bool)

    with pytest.raises(ValueError):
        filter_connected_components(
            mask,
            voxel_spacing=(1.0, 1.0, 1.0),
            min_component_volume=1.0,
            connectivity=invalid_connectivity,
        )


@pytest.mark.parametrize(
    "connectivity,expected_count,expected_kept_voxels",
    [
        pytest.param(1, 2, 0, id="6-connectivity"),
        pytest.param(2, 2, 0, id="18-connectivity"),
        pytest.param(3, 1, 2, id="26-connectivity"),
    ],
)
def test_connectivity_coverage_6_18_26(
    connectivity,
    expected_count,
    expected_kept_voxels,
):
    mask = np.zeros((3, 3, 3), dtype=bool)
    mask[0, 0, 0] = True
    mask[1, 1, 1] = True

    filtered, report = filter_connected_components(
        mask,
        voxel_spacing=(1.0, 1.0, 1.0),
        min_component_volume=1.5,
        connectivity=connectivity,
    )

    assert report["component_count"] == expected_count
    assert report["kept_voxel_count"] == expected_kept_voxels
    assert int(filtered.sum()) == expected_kept_voxels