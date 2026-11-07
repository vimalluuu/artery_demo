# 1. Segmentation Evaluation Methodology

## 1.1 Evaluation objective

Evaluate how closely a predicted 3D artery segmentation mask matches an independently prepared reference mask. Evaluation must be performed on paired CT/reference volumes that have been verified to represent the same anatomy and spatial coordinate system.

The current repository implementation calculates **Dice** in `backend/app/services/segmentation/inference.py`. The other metrics below are recommended for a complete evaluation report; they are not currently implemented by the inspected reference-evaluation function.

## 1.2 Confusion-matrix terms

Treat vessel foreground as the positive class and background as the negative class:

- **TP (true positive):** voxel is vessel in both prediction and reference.
- **FP (false positive):** voxel is predicted as vessel but is background in the reference.
- **FN (false negative):** voxel is vessel in the reference but missed by prediction.
- **TN (true negative):** voxel is background in both.

All metrics must use the same aligned binary masks and a documented foreground definition.

## 1.3 Metrics, formulas, interpretation, and limitations

| Metric | Formula | Interpretation | Main limitation |
|---|---|---|---|
| Dice similarity coefficient (DSC) | `2TP / (2TP + FP + FN)` | Overlap between predicted and reference foreground; 1 is perfect, 0 is no overlap. | Does not describe where errors occur; small structures can be strongly affected by a few voxels. |
| Intersection over Union (IoU/Jaccard) | `TP / (TP + FP + FN)` | Fraction of the union occupied by the intersection; 1 is perfect. | Closely related to Dice and does not add boundary-location detail. |
| Precision (positive predictive value) | `TP / (TP + FP)` | Of predicted vessel voxels, how many are reference vessel. Higher precision means fewer false positives. | Can be high when only a small portion of the vessel is predicted. |
| Recall / Sensitivity | `TP / (TP + FN)` | Of reference vessel voxels, how many are detected. Higher recall means fewer missed vessel voxels. | Can be high despite many false positives. |
| Specificity | `TN / (TN + FP)` | Of reference background voxels, how many are correctly rejected. | Often appears very high because background voxels greatly outnumber vessel voxels; report alongside overlap and sensitivity. |
| Average symmetric surface distance (ASSD) | Mean of distances from each surface point to the nearest point on the opposite surface, in both directions | Measures average boundary separation in physical units. Lower is better. | Depends on surface extraction, spacing, connectivity, and treatment of empty masks/outliers. |
| Hausdorff distance (HD) | Maximum of the two directed surface distances | Captures the worst boundary mismatch. Lower is better. | Extremely sensitive to one outlier; specify whether full HD or a percentile such as HD95 is used. |

For zero denominators, define and document the convention before evaluation. Do not silently divide by zero. A common convention is to report the metric as undefined when its denominator is zero, while separately identifying empty prediction/reference cases.

## 1.4 3D boundary-distance evaluation

Boundary distances must be computed in physical space, not merely voxel-index units, when reliable spatial units and voxel spacing are available.

Recommended procedure:

1. Verify prediction and reference dimensions, affine transform, voxel spacing, and spatial units.
2. Extract 3D surfaces using one fixed connectivity/surface convention.
3. Transform surface coordinates into physical coordinates using the NIfTI affine.
4. Compute nearest-surface distances in both directions.
5. Report ASSD and HD95 (or clearly identified full HD), in millimetres.
6. State how empty masks, disconnected components, and outliers are handled.

The reviewed repository does not implement ASSD, HD, or HD95.

## 1.5 Current implementation behavior

The current `reference_metrics()` function:

- Loads a 3D NIfTI reference.
- Requires the reference shape, affine, voxel spacing, and spatial units to match the CT.
- Allows an explicit unknown-spatial-units override; the override is recorded as an alignment assumption.
- Defines reference foreground as `label > 0`.
- Calculates Dice from the binary prediction and reference.
- Does not calculate IoU, precision, recall, specificity, ASSD, HD, or HD95.

The production API segmentation route currently creates predictions; the checked-in integration report describes the CLI sample evaluation separately. Do not assume that every API inference run includes a reference mask or evaluation scores.

## 1.6 Reporting recommendations

For every evaluated case, record:

- Case identifier (de-identified).
- Dataset split and source of split assignment.
- CT and reference file identifiers/checksums.
- Geometry verification outcome and any override.
- Model architecture and checkpoint checksum.
- Preprocessing, patch size, stride, batch size, device, and threshold.
- TP, FP, FN, TN if available.
- Dice, IoU, precision, recall, specificity.
- ASSD and HD95 in millimetres if implemented.
- Runtime, with model-only inference time distinguished from total pipeline time.
- Error notes and whether the case was excluded (with reason).

Report per-case values and aggregate mean/standard deviation or median/interquartile range. State the number of evaluated cases. Do not pool all voxels across patients without also reporting case-level results.
