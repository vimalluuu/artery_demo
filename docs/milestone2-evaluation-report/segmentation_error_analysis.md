# 5. Segmentation Error Analysis

## 5.1 Purpose

A single overlap score cannot explain why a 3D vessel segmentation succeeds or fails. Review representative CT slices and 3D views together with the prediction and reference mask. Error analysis should be performed case by case and recorded using de-identified identifiers.

## 5.2 Error categories

| Error type | What to look for | Possible effect on metrics | What to record |
|---|---|---|---|
| False-positive vessel regions | Predicted foreground outside the reference vessel | More FP; lower precision and often lower Dice/IoU | Location, size, connected component, likely image artifact/background |
| Missed vessel regions | Reference vessel not included in prediction | More FN; lower recall/sensitivity and Dice/IoU | Vessel segment, approximate extent, local contrast/diameter |
| Disconnected regions | Gaps in a vessel that should be continuous, or isolated predicted islands | May increase FN or FP; topology is not captured by Dice alone | Number and size of components, gap location |
| Boundary mismatch | Prediction is too wide/narrow or shifted relative to reference | Changes FP/FN and overlap; may affect surface distances | Boundary location and physical distance if measured |
| Geometry/alignment mismatch | CT and reference differ in affine, spacing, orientation, or units | Can make all voxelwise scores invalid | Header checks and whether evaluation was rejected |
| Empty-mask cases | Prediction or reference contains no foreground | Some metric denominators become zero | Explicitly state empty prediction/reference and metric convention |

## 5.3 Review procedure

1. Verify CT/reference alignment before looking at metric values.
2. Display axial, coronal, and sagittal slices at matched coordinates.
3. Overlay reference and prediction using consistent colours and opacity.
4. Inspect the entire volume, not only the best-looking slices.
5. Inspect connected components and vessel continuity where appropriate.
6. Record false-positive and missed-vessel examples with case IDs and slice/coordinate references.
7. If surface metrics are implemented, compare boundary-distance maps and report millimetres.
8. Have a qualified reviewer adjudicate ambiguous reference annotations.

## 5.4 Current evidence and limits

The supplied integration report describes one case-851 prediction with 567,894 predicted foreground voxels, 117,888 reference foreground voxels, 45,191 intersection voxels, and Dice 0.131794 at threshold 0.70. These numbers show low overlap for that single sample; they do not, by themselves, identify the anatomical causes of error.

The supplied ZIP does not contain the sample CT/reference pair, prediction output, overlays, or a curated failure-case review. Therefore, no specific false-positive, missed-vessel, disconnection, or boundary-error examples can be claimed from this ZIP.

## 5.5 Error-analysis table for future review

| Case ID | Error category | Location / slice | Visual observation | Likely cause (hypothesis only) | Reviewer / date | Follow-up |
|---|---|---|---|---|---|---|
| [ ] | [FP / FN / disconnected / boundary / geometry] | [ ] | [ ] | [ ] | [ ] | [ ] |
