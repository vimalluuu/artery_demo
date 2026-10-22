import numpy as np
import pytest
from skimage.measure import label

from app.services.vessel_analysis import (
    estimate_diameter,
    extract_centerline,
    filter_connected_components,
)


@pytest.fixture
def straight_tube():
    """A finite straight tube with a five-voxel radius."""
    z, y, x = np.indices((32, 41, 41))
    return (z >= 3) & (z < 29) & ((y - 20) ** 2 + (x - 20) ** 2 <= 25)


@pytest.fixture
def anisotropic_tube():
    """A straight tube with a six-unit physical radius and unequal spacing."""
    spacing = (2.0, 1.5, 0.75)
    z, y, x = np.indices((28, 41, 61))
    radial_distance_squared = ((y - 20) * spacing[1]) ** 2 + (
        (x - 30) * spacing[2]
    ) ** 2
    mask = (z >= 3) & (z < 25) & (radial_distance_squared <= 6.0**2)
    return mask, spacing


@pytest.fixture
def mask_with_small_islands():
    mask = np.zeros((24, 24, 24), dtype=bool)
    mask[2:7, 2:7, 2:7] = True
    mask[14:18, 14:18, 14:18] = True
    mask[10, 2, 15] = True
    mask[10:12, 20:22, 2:4] = True
    return mask


def test_centerline_is_connected_and_one_voxel_wide(straight_tube):
    centerline = extract_centerline(straight_tube)

    assert centerline.dtype == np.bool_
    assert centerline.shape == straight_tube.shape
    assert centerline.any()
    assert np.all(~centerline | straight_tube)
    assert label(centerline, connectivity=3).max() == 1
    # A straight tube should have at most one skeleton voxel in each cross-section.
    per_slice = centerline.sum(axis=(1, 2))
    assert np.max(per_slice) <= 1
    assert np.all(per_slice[8:-8] == 1)


def test_diameter_matches_known_radius_with_anisotropic_spacing(anisotropic_tube):
    mask, spacing = anisotropic_tube
    centerline = extract_centerline(mask)

    diameters = estimate_diameter(mask, centerline, voxel_spacing=spacing)
    interior_centerline = centerline[7:21]
    interior_diameters = diameters[7:21][interior_centerline]

    assert interior_diameters.size > 0
    assert np.median(interior_diameters) == pytest.approx(12.0, abs=2.0)
    assert np.count_nonzero(diameters[~centerline]) == 0


def test_component_filter_removes_small_islands_and_reports_them(
    mask_with_small_islands,
):
    filtered, report = filter_connected_components(
        mask_with_small_islands,
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
    assert np.all(filtered[2:7, 2:7, 2:7])
    assert np.all(filtered[14:18, 14:18, 14:18])
    assert not filtered[10, 2, 15]
    assert not filtered[10:12, 20:22, 2:4].any()


@pytest.mark.parametrize(
    "spacing",
    [(1.0, 0.0, 1.0), (1.0, float("nan"), 1.0), (1.0, 2.0)],
)
def test_invalid_spacing_is_rejected(straight_tube, spacing):
    with pytest.raises(ValueError, match="voxel_spacing"):
        estimate_diameter(
            straight_tube,
            extract_centerline(straight_tube),
            voxel_spacing=spacing,
        )