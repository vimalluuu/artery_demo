# 3. Evaluation Report Template

Copy this template for each formal evaluation run. Replace every bracketed field. If information is unavailable, write **Not measured** or **Not available**; do not estimate.

## Experiment identity

- Experiment/run ID: [ ]
- Date and operator: [ ]
- Source repository branch and commit SHA: [ ]
- Dataset/version: [ ]
- Split: [train / validation / test]
- Number of cases: [ ]
- Exclusions and reasons: [ ]

## Model and checkpoint

- Architecture: [ ]
- Parameter count: [ ]
- Checkpoint filename and SHA-256: [ ]
- Training provenance / epoch or step: [ ]
- Training configuration reference: [ ]
- Checkpoint verified to load strictly: [yes/no]
- Training data and split: [ ]

## Input and preprocessing

- Modality: [ ]
- Input format and dimensions: [ ]
- Spatial units and voxel spacing: [ ]
- Orientation/resampling: [ ]
- Intensity preprocessing: [ ]
- Patch size / stride: [ ]
- Padding/cropping: [ ]
- Postprocessing: [ ]
- Probability threshold: [ ]
- Hardware/device and software versions: [ ]

## Geometry and reference validation

- CT/reference dimensions match: [ ]
- Affine and spacing match: [ ]
- Spatial units match: [ ]
- Unknown-unit override used: [ ]
- Reference foreground definition: [ ]
- Alignment assumptions: [ ]

## Results

| Case ID | Dice | IoU | Precision | Recall/Sensitivity | Specificity | ASSD (mm) | HD95 (mm) | Runtime (s) | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| [ ] | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | [ ] |

### Aggregate results

| Metric | Mean | Standard deviation | Median | IQR | Number of cases |
|---|---:|---:|---:|---:|---:|
| Dice | [ ] | [ ] | [ ] | [ ] | [ ] |
| IoU | [ ] | [ ] | [ ] | [ ] | [ ] |
| Precision | [ ] | [ ] | [ ] | [ ] | [ ] |
| Recall | [ ] | [ ] | [ ] | [ ] | [ ] |
| Specificity | [ ] | [ ] | [ ] | [ ] | [ ] |
| ASSD (mm) | [ ] | [ ] | [ ] | [ ] | [ ] |
| HD95 (mm) | [ ] | [ ] | [ ] | [ ] | [ ] |

## Error analysis

- False-positive patterns: [ ]
- Missed-vessel patterns: [ ]
- Disconnected components: [ ]
- Boundary/geometry mismatch: [ ]
- Empty prediction/reference cases: [ ]
- Representative case IDs and reviewed overlays: [ ]

## Limitations and conclusion

- Evaluation limitations: [ ]
- Dataset/split limitations: [ ]
- Hardware/runtime limitations: [ ]
- Clinical validation status: Not clinically validated unless supported by a separate approved validation study.
- Conclusion: [ ]
- Next steps: [ ]
