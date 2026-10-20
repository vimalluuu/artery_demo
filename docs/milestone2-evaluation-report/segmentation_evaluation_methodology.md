# VascuAI — Segmentation Evaluation Methodology

**Status:** Documentation draft for Milestone 2  
**Scope:** Documentation and evaluation protocol only. No model, training script, dataset, API, database, or frontend changes are proposed here.

## 1. Purpose and reporting rules

This document defines how to evaluate 3D coronary artery lumen segmentation consistently. It is a methodology, not a claim that any model has achieved a particular score.

- Report metrics only when they have been computed from a named prediction set and matching ground-truth masks.
- Use **Not measured** for missing results. Do not estimate or infer scores from visual appearance.
- Use the validation split for model selection. Keep the held-out test split untouched until the evaluation protocol and selected checkpoint are frozen.
- Record whether metrics are computed on binary lumen masks or multi-class labels, and whether scores are averaged per scan, per class, or across all voxels.
- A metric value is only comparable when the data split, preprocessing, spatial geometry, thresholding, postprocessing, and calculation implementation are comparable.

## 2. Confusion-matrix terms

For binary foreground-versus-background segmentation, define voxel-level counts after aligning the predicted mask and reference mask in the same grid:

- **TP (true positive):** voxel is foreground in both prediction and reference.
- **FP (false positive):** voxel is foreground in prediction but background in reference.
- **FN (false negative):** voxel is background in prediction but foreground in reference.
- **TN (true negative):** voxel is background in both.

These definitions are voxel-based. If evaluating individual branches, centerlines, connected components, or lesions, define a separate object-level matching protocol; do not mix those counts with voxel-level metrics.

## 3. Metrics: definitions, formulas, interpretation, limitations

Let \(P\) be the predicted foreground voxel set and \(G\) the ground-truth foreground voxel set.

### 3.1 Dice Similarity Coefficient (DSC)

\[
\mathrm{Dice}=\frac{2|P\cap G|}{|P|+|G|}
=\frac{2TP}{2TP+FP+FN}
\]

- **Range:** 0 to 1; higher is better.
- **Interpretation:** overlap between predicted and reference foreground masks.
- **Limitations:** insensitive to true negatives; can conceal small but clinically important branch omissions; scores depend on foreground size and aggregation method. State how empty prediction/reference cases are handled.

### 3.2 Intersection over Union (IoU / Jaccard)

\[
\mathrm{IoU}=\frac{|P\cap G|}{|P\cup G|}
=\frac{TP}{TP+FP+FN}
\]

- **Range:** 0 to 1; higher is better.
- **Interpretation:** fraction of the union occupied by the intersection.
- **Relationship:** for a single binary mask, \(\mathrm{Dice}=2\mathrm{IoU}/(1+\mathrm{IoU})\).
- **Limitations:** shares overlap-metric limitations; should not be treated as an independent source of evidence from Dice.

### 3.3 Precision (positive predictive value)

\[
\mathrm{Precision}=\frac{TP}{TP+FP}
\]

- **Range:** 0 to 1; higher means fewer predicted foreground voxels are false positives.
- **Interpretation:** how much of the predicted lumen is supported by the reference.
- **Limitations:** does not penalize missed ground-truth voxels directly. Undefined if \(TP+FP=0\); report the chosen convention.

### 3.4 Recall / Sensitivity

\[
\mathrm{Recall}=\mathrm{Sensitivity}=\frac{TP}{TP+FN}
\]

- **Range:** 0 to 1; higher means fewer reference foreground voxels were missed.
- **Interpretation:** coverage of the reference lumen.
- **Limitations:** can be high when predictions over-segment the vessel. Undefined if \(TP+FN=0\); report the chosen convention.

### 3.5 Specificity

\[
\mathrm{Specificity}=\frac{TN}{TN+FP}
\]

- **Range:** 0 to 1; higher means fewer background voxels are incorrectly labelled foreground.
- **Interpretation:** ability to reject background voxels.
- **Limitations:** background voxels greatly outnumber vessel voxels, so specificity can be high even for poor vessel segmentation. Always report foreground overlap and sensitivity alongside it.

### 3.6 Boundary-distance metrics in physical units

Boundary metrics evaluate geometric agreement rather than only voxel overlap. Compute them on surfaces derived from the prediction and reference after verifying that both are in the same physical coordinate system.

- **Average symmetric surface distance (ASSD):** average of distances from each surface point in one surface to the nearest point on the other surface, computed in both directions. State whether distances are weighted by surface area or by sampled vertices.
- **Hausdorff distance (HD):** maximum of the two directed maximum nearest-surface distances. Highly sensitive to a single outlier.
- **95th-percentile Hausdorff distance (HD95):** 95th percentile of the pooled or symmetrically combined surface-distance distribution; define the implementation precisely. Less sensitive to extreme outliers than maximum HD.
- **Units:** millimetres (mm) only when voxel spacing, orientation, origin, and transforms are correct and retained. Otherwise mark the physical distance as **Not measured** and do not label voxel distances as mm.
- **Limitations:** distances can be unstable for empty masks or tiny disconnected components. Document surface extraction, distance implementation, point weighting, empty-mask handling, and geometry validation.

### 3.7 Optional centreline / topology metrics

If used, report them separately from voxel overlap. Examples include centreline coverage, branch detection rate, connected-component count, or clDice. These require explicit definitions and validated reference centrelines. Do not report them unless implemented and measured.

## 4. Aggregation and implementation choices

Every report must state:

1. Binary lumen-vs-background or multi-class evaluation.
2. Label mapping and whether labels are binarised.
3. Per-scan versus global voxel aggregation; macro versus micro averaging.
4. Whether background is included (normally report foreground metrics explicitly).
5. Empty-mask policy and handling of undefined precision/recall/specificity.
6. Surface extraction and boundary-distance implementation.
7. Physical-space geometry checks and units.
8. Software/package versions and exact metric code or command.

For multi-class masks, specify whether each class is scored independently and how the final macro-average is formed. Do not silently mix class labels with binary lumen masks.

## 5. ImageCAS / ImageCAS-X dataset notes

The official ImageCAS-X project describes **800 coronary CT angiography (CCTA) scans** from the publicly available ImageCAS cohort and provides coronary lumen/branch labels, centerlines, and mesh surfaces. The documented directory layout includes `volumes/`, `segmentations/`, `centerlines/`, `surfaces/`, and `filelist/`. Its README states that `train.txt`, `val.txt`, and `test.txt` define the splits and that `exclude.txt` IDs are dropped from all splits. The published ImageCAS-X label map describes 0 as background and labels 1–14 as coronary branches; the benchmark may binarise these to lumen versus background for some methods.

Source: https://github.com/kitbransby/ImageCAS-X/blob/main/README.MD

**Local project verification status:** In the local dataset inspection previously reported by the project owner, `filelist/train.txt`, `filelist/val.txt`, `filelist/test.txt`, and `filelist/exclude.txt` were present. Exact per-split counts, overlap checks, the active configuration's label handling, and the exact data version used for any training run have **Not verified** status in this draft. Confirm them from the actual files and configuration before asserting counts. Do not assume split counts based on the total cohort size.

The local inspection reported `.vtk`, `.nii.gz`, and other dataset assets, including `segmentations`, `centerlines`, and `surfaces`. Availability of original CT volumes for every listed case was not confirmed in the earlier local checks. Verify volume-to-mask pairing before evaluation.

### Data leakage precautions

- Split at **patient/scan level**, not at slice, patch, crop, or augmented-sample level.
- Use the supplied split files as the source of truth unless the team explicitly approves another documented split.
- Check for duplicate scan IDs and intersections between train, validation, test, and excluded IDs. Report counts from the actual lists.
- Exclude `exclude.txt` IDs according to the dataset pipeline.
- Do not use held-out test metrics to choose checkpoints, thresholds, postprocessing, or hyperparameters.
- Fit data-dependent preprocessing only on training data where applicable. Do not let validation/test information influence training or selection.
- If a multi-stage pipeline generates patch centres, masks, cached crops, or other derived assets, record which split was used to generate each asset and ensure no held-out labels leak into training.
- Keep the test list and labels read-only during model selection; evaluate once the selected model and protocol are frozen.
- Record dataset source/version, list-file hashes, and any exclusions or manual changes.

## 6. Known failure modes to inspect

- **False positives:** background structures or noise labelled as artery; inspect precision, FP locations, and whether false components occur near the heart or other vessels.
- **Missed vessels:** true branches absent from prediction; inspect recall and branch/centreline coverage where reference annotations support it.
- **Disconnected regions:** vessel tree fragmented into multiple components; report component counts and inspect connectivity. Do not automatically remove components without documenting the postprocessing rule.
- **Geometry mismatches:** prediction and reference have different size, spacing, origin, direction, affine, or orientation; all metrics can become invalid. Compare metadata and resample using a documented, label-safe method before scoring.
- **Boundary leakage / over-segmentation:** prediction spills outside vessel wall; overlap and surface distances may reveal different aspects.
- **Small-branch imbalance:** large proximal vessels dominate global overlap; use per-scan and, where applicable, branch-aware summaries.

## 7. Current model/configuration evidence and reporting status

Prior project notes mention configuration names `imagecas_manual`, `imagecas_baseline`, and stage configs for coarse, dilated-coarse, and patch sizes 16/32/64, as well as checkpoint filenames `cas_net.pt`, `ffr_unet.pt`, and `swin_unetr.pt`. These are **references observed in prior project context, not proof that any one configuration/checkpoint was used for a completed experiment**. The ImageCAS-X benchmark documentation separately lists CAS-Net, FFR-UNet, Swin UNETR, a multi-stage ImageCAS method, and other methods.

For any experiment, verify the actual config file, architecture, checkpoint path and hash, inference command, preprocessing, threshold, and output location. Current measured evaluation scores and inference times: **Not measured / not provided in the verified project context**.

## 8. References

1. ImageCAS-X dataset and benchmark repository: https://github.com/kitbransby/ImageCAS-X
2. Dice, L. R. (1945). Measures of the amount of ecologic association between species. *Ecology*, 26(3), 297–302.
3. Jaccard, P. (1912). The distribution of the flora in the alpine zone. *New Phytologist*, 11(2), 37–50.
4. For Hausdorff/surface-distance metrics, record the exact software implementation and version used in each experiment; different implementations can differ in point sampling and percentile conventions.
