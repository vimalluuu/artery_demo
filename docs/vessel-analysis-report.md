# 3D Vessel Analysis: Technical Report

## Scope

This report documents the standalone utilities in
[`backend/app/services/vessel_analysis.py`](../backend/app/services/vessel_analysis.py)
and their synthetic regression tests in
[`backend/tests/test_vessel_analysis.py`](../backend/tests/test_vessel_analysis.py).
The functions operate on binary 3D vessel masks. They do not load medical-image
files, reorient volumes, register images, or establish clinical measurements.

## Algorithms and dependencies

### Centerline extraction

`extract_centerline` calls scikit-image's `skeletonize` with `method="lee"` on a
3D binary volume. Lee thinning iteratively removes boundary voxels while
producing a thin skeleton intended to retain foreground connectivity. The output
is a Boolean volume with the same shape as the input.

Lee skeletonization has a specific observed limitation in this implementation:
an even-width vessel component, such as a straight tube with a 4×4 cross-section,
can disappear completely. The optional diagnostics compare connected
components before and after skeletonization. They report source-component labels
with no overlapping skeleton voxel in `disappeared_components`, and source
components overlapping multiple skeleton components in `fragmented_components`.
Diagnostics also include `input_component_count` and
`output_skeleton_component_count`. A component label refers to the connected
component numbering produced by the respective 26-neighbor label operation.
Diagnostics expose this loss; they do not restore, interpolate, or fabricate
skeleton data. A nonempty skeleton or an empty diagnostics list is not proof of
anatomical correctness or complete topology preservation.

### Diameter estimation

`estimate_diameter` computes a Euclidean Distance Transform (EDT) of the
foreground mask using `scipy.ndimage.distance_transform_edt`. At each supplied
centerline voxel it returns twice the EDT distance, interpreted as the local
diameter. Values outside the centerline remain zero. Distances are physical
distances when voxel spacing is supplied in physical units; otherwise the
default unit spacing produces voxel-coordinate distances.

### Connected-component filtering

`filter_connected_components` labels foreground components using
`skimage.measure.label` and the selected 3D connectivity. Each component's
physical volume is its voxel count multiplied by the product of the three
spacing values. Components below `min_component_volume` are removed. A
component equal to the threshold is retained using `np.isclose` with relative
tolerance `1e-5` and an absolute tolerance of eight
float64 machine epsilons scaled by the threshold magnitude. This comparison
scales with the physical unit, so equivalent thresholds in mm³ and m³ have
equivalent boundary behavior. A component just below the threshold but within
that relative tolerance is treated as numerically at-threshold; its reported
physical volume remains its computed volume.

The direct dependencies used by these utilities are **NumPy**, **SciPy**
(`scipy.ndimage`), and **scikit-image** (`skimage.measure` and
`skimage.morphology`). In the backend dependency manifest, SciPy and
scikit-image are declared in `backend/requirements.txt`.

## Array axes and voxel spacing

Volumes follow NumPy's three-dimensional indexing order:

```text
volume[axis0, axis1, axis2]
```

`voxel_spacing` must be a three-value tuple in exactly the same order:
`(spacing_axis0, spacing_axis1, spacing_axis2)`. For example, a spacing tuple
of `(4.0, 2.0, 0.5)` means a one-voxel step along axis 0 is four physical
units, along axis 1 is two units, and along axis 2 is half a unit. The functions
do not infer anatomical axis names or reorder spacing from image metadata.
Callers must first ensure that the volume orientation and spacing are correct
for their upstream data source.

All spacing values must be finite and positive. For component filtering,
`min_component_volume` must use the corresponding cubic physical unit; for
example, spacing in millimeters requires a threshold in mm³. For diameter
estimation, returned values use the same physical length unit as the spacing.

## Function inputs and outputs

### `extract_centerline(mask, return_diagnostics=False)`

- **Input:** A non-empty 3D binary array. Boolean arrays are accepted; numeric
  arrays are accepted only when all values are finite and equal to 0 or 1.
- **Default output:** A Boolean skeleton array with the input shape.
- **With `return_diagnostics=True`:** A tuple `(skeleton, diagnostics)`.
  The diagnostics dictionary contains:
  - `disappeared_components`: labels in the original connected-component
    labeling that have no skeleton overlap.
  - `fragmented_components`: original labels associated with multiple
    connected skeleton labels.
  - `input_component_count` and `output_skeleton_component_count`: the number
    of 26-neighbor connected components before and after skeletonization.
  - `warning`: a text warning that detecting component loss does not guarantee
    preserved connectivity.

### `estimate_diameter(mask, centerline, voxel_spacing=(1.0, 1.0, 1.0))`

- **Inputs:** A non-empty 3D binary mask and a same-shaped non-empty 3D binary
  centerline contained entirely within the mask. Optional spacing has three
  finite, positive values in NumPy axis order.
- **Output:** A `float64` array with the mask shape. Values are twice the
  spacing-aware EDT at centerline voxels and zero elsewhere.
- **Interpretation:** This is a local EDT-based diameter estimate, not a
  measurement of a fitted circular or elliptical cross-section.

### `filter_connected_components(mask, min_component_volume, voxel_spacing=(1.0, 1.0, 1.0), connectivity=3)`

- **Inputs:** A non-empty 3D binary mask, a finite nonnegative physical-volume
  threshold, three finite positive spacing values, and connectivity `1`, `2`,
  or `3` (respectively 6-, 18-, or 26-neighbor connectivity).
- **Output:** A tuple `(filtered_mask, report)`. The filtered mask is Boolean.
  The report contains total, kept, and removed component counts; kept and
  removed voxel counts; the threshold and voxel volume; and per-removed-
  component labels, voxel counts, and physical volumes.
- **Boundary behavior:** Components above or at the threshold are retained.
  Values within a relative tolerance of `1e-5` (plus eight float64 machine
  epsilons scaled to the threshold) are treated as numerically equal to the
  threshold. This avoids a fixed absolute tolerance whose effective meaning
  changes between units.

The utilities reject empty dimensions, non-3D arrays, non-binary data,
mismatched centerline shapes, centerline voxels outside the mask, and invalid
spacing or filtering arguments with `ValueError`.

## Synthetic test rationale and tolerances

The test suite uses constructed NumPy volumes only; no patient images or
external data are required.

- A Y-shaped connected mask checks that the Lee skeleton remains nonempty and
  connected under 26-neighbor labeling.
- A tube with a 4×4 cross-section reproduces Lee's even-width component loss.
  The regression verifies that the output remains empty and the lost source
  component is explicitly listed in diagnostics.
- A straight seven-voxel-wide square cross-section gives an analytically
  specified centerline EDT: the nearest background voxel center is four
  voxel units away, so the reported diameter is eight units. An absolute
  tolerance of `0.01` accommodates floating-point representation while
  remaining far smaller than a one-voxel change.
- A deliberately asymmetric anisotropic volume checks axis order. With spacing
  `(1.0, 2.0, 2.0)`, the expected diameter is 16 physical units; reversing the
  tuple produces 14 units. The test executes both calculations and checks the
  reversed result explicitly, with a `0.01` absolute tolerance.
- The component-threshold test uses a nominal threshold of `0.343` and spacing
  `(0.07, 0.07, 0.07)`. Components of 999, 1000, and 1001 voxels have
  physical volumes below, at (subject to floating-point rounding), and above
  the threshold. Additional regressions cover clearly-below, slightly-below,
  exact, and slightly-above boundaries in equivalent mm³ and m³ scales with
  anisotropic spacing.
- T-, Y-, and multi-branch synthetic masks check for centerline voxels in every
  distal arm and verify those voxels connect to the branch junction. A separate
  bookkeeping test injects a deliberately fragmented skeleton to test the
  diagnostics' source-to-skeleton label mapping; it is not evidence that the
  natural skeletonizer fragments that test shape.
- Separate disconnected larger components represent legitimate islands, while
  an isolated voxel and a small cluster represent false positives that should
  be removed by the configured threshold.
- Empty, zero-sized, and single-voxel volumes exercise boundary conditions.
  Invalid dimensionality and non-binary input cases verify validation behavior.

The tolerances are for deterministic numerical comparison of synthetic geometry;
they are not claims about measurement error on real acquisitions.

## Diameter-estimation limitations

EDT-based diameter estimates can be misleading near endpoints and branch
junctions. At endpoints or truncated vessel boundaries, the EDT may
underestimate diameter because the vessel end constrains the distance field.
At branch junctions, multiple limbs contribute foreground around the branch
point and can make the estimate larger than a local limb diameter. These
outputs are algorithmic approximations and do not represent independently
validated anatomical measurements.

## Known limitations

- **Lee skeletonization can completely lose even-width vessel components.**
  This behavior is observable for a 4×4 cross-section tube. The code reports
  disappearance when diagnostics are requested; it intentionally does not
  fabricate a centerline to fill the missing component.
- Skeletonization and connectivity are voxel-grid operations. Results can
  depend on resolution, discretization, orientation, and connectivity
  convention; the functions do not resample or standardize volumes.
- The diameter method assumes the provided centerline is valid and does not
  determine it independently. It does not fit cross-sectional shapes, correct
  junction bias, infer uncertainty, or account for acquisition artifacts.
- Component filtering is a volume thresholding operation, not a semantic
  classifier. It cannot distinguish true vessels from similarly sized noise
  without application-specific context.

## Mandatory disclaimer

**This is a non-clinical research prototype. Synthetic tests verify selected
software behaviors only and do not establish clinical accuracy, safety, or
fitness for diagnosis, treatment planning, or other patient-care decisions.**
