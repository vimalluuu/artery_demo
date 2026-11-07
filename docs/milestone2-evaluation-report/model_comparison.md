# 4. Model Comparison Table

## 4.1 Models verified in the supplied repository

The inspected source defines one architecture: `SmallUNet3D`. The checkpoint variants mentioned in earlier team discussion are not all present in this ZIP, so they must not be treated as independently verified models.

| Candidate | Architecture | Training configuration | Checkpoint evidence | Evaluation evidence | Status |
|---|---|---|---|---|---|
| Experimental baseline | `SmallUNet3D`, base channels 8, 85,177 parameters | Segmentation README says trained on ImageCAS cases 251–260; full training code/config is not in this ZIP | Integration report records step 700 and checkpoint SHA-256; actual checkpoint file is absent from ZIP | Historical case-851 Dice 0.131794; reported validation mean ~0.1052 over cases 851–900 not independently reproduced | Experimental baseline; not clinically validated |
| Other architectures | Not found in reviewed segmentation source | Not available | Not available | Not measured | Do not compare until artifacts and results are supplied |

## 4.2 Checkpoint identity recorded in the integration report

- Architecture: `SmallUNet3D`
- Base channels: 8
- Parameters: 85,177
- Checkpoint step: 700
- SHA-256: `e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`
- Patch size: 64³
- Stride: 32
- Threshold: 0.70
- Device used for historical sample: CPU
- Historical sample: case 851, dimensions `(512, 512, 217)`

The hash and measurements above are transcribed from `docs/model-integration-verification.md`; the checkpoint binary itself is not included in the supplied ZIP. Re-verify the hash against the actual handoff file before a new experiment.

## 4.3 Comparison fields required for future models

| Field | Model A | Model B | Model C |
|---|---|---|---|
| Architecture/version | Not measured | Not measured | Not measured |
| Parameter count | Not measured | Not measured | Not measured |
| Training dataset/split | Not measured | Not measured | Not measured |
| Checkpoint SHA-256 | Not measured | Not measured | Not measured |
| Input preprocessing | Not measured | Not measured | Not measured |
| Threshold | Not measured | Not measured | Not measured |
| Validation Dice | Not measured | Not measured | Not measured |
| Validation IoU | Not measured | Not measured | Not measured |
| Precision / Recall | Not measured | Not measured | Not measured |
| ASSD / HD95 | Not measured | Not measured | Not measured |
| Inference time per case | Not measured | Not measured | Not measured |
| Peak memory | Not measured | Not measured | Not measured |
| Failure cases | Not measured | Not measured | Not measured |

Do not label a different checkpoint from the same architecture as a different architecture. Compare checkpoint variants only when their provenance, training configuration, and evaluation conditions are documented.
