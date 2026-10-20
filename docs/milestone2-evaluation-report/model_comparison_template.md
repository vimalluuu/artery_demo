# VascuAI — Model Comparison Report Template

> Copy this template for each experiment or complete one table row per run. Do not fill fields from memory or visual impressions. Enter **Not measured** when unavailable.

## A. Experiment metadata

| Field | Value |
|---|---|
| Experiment ID | Not measured |
| Date / operator | Not recorded |
| Git repository / commit SHA | Not recorded |
| Git branch | Not recorded |
| Model / architecture | Not verified |
| Model configuration path and hash | Not verified |
| Checkpoint path | Not verified |
| Checkpoint SHA-256 | Not measured |
| Checkpoint selection rule | Not recorded |
| Dataset source / version | ImageCAS-X intended; exact local version not verified |
| Dataset root / case-list hashes | Not recorded |
| Training split list and count | `filelist/train.txt` exists in prior local inspection; count Not verified |
| Validation split list and count | `filelist/val.txt` exists in prior local inspection; count Not verified |
| Held-out test split list and count | `filelist/test.txt` exists in prior local inspection; count Not verified |
| Excluded cases | `filelist/exclude.txt` exists in prior local inspection; IDs/count Not verified |

## B. Training configuration

| Parameter | Value |
|---|---|
| Input modality / channels | Not verified |
| Input dimensions / patch size | Not verified |
| Number of output classes / label mapping | Not verified |
| Preprocessing / resampling | Not verified |
| Intensity window / normalization | Not verified |
| Augmentation | Not verified |
| Loss function | Not verified |
| Optimizer | Not verified |
| Learning rate / schedule | Not verified |
| Batch size | Not verified |
| Epochs / stopping criterion | Not verified |
| Random seed / deterministic settings | Not recorded |
| Hardware | Prior notes mention PyTorch CPU environment; experiment-specific hardware Not verified |
| Software environment | Not recorded |

## C. Inference and evaluation settings

| Parameter | Value |
|---|---|
| Inference command / entry point | Not verified |
| Checkpoint loaded | Not verified |
| Test-time augmentation | Not verified |
| Sliding-window / patch overlap | Not verified; prior ImageCAS-X config notes mention 0.5 overlap, verify active config |
| Blending / stitching | Not verified |
| Probability threshold | Not measured / not recorded |
| Postprocessing | Not verified |
| Prediction geometry after resampling | Not verified |
| Metric implementation and version | Not recorded |
| Aggregation (per scan / global; macro / micro) | Not recorded |
| Empty-mask policy | Not recorded |
| Inference timing method and hardware | Not recorded |

## D. Results

| Metric | Validation result | Test result | Unit / aggregation | Notes |
|---|---:|---:|---|---|
| Dice (DSC) | Not measured | Not measured | Proportion, method not recorded | |
| IoU | Not measured | Not measured | Proportion, method not recorded | |
| Precision | Not measured | Not measured | Proportion, method not recorded | |
| Recall / sensitivity | Not measured | Not measured | Proportion, method not recorded | |
| Specificity | Not measured | Not measured | Proportion, method not recorded | |
| ASSD | Not measured | Not measured | mm only if geometry verified | |
| HD95 | Not measured | Not measured | mm only if geometry verified | |
| Hausdorff distance | Not measured | Not measured | mm only if geometry verified | |
| Inference time per volume | Not measured | Not measured | seconds/volume; timing method required | |
| Peak memory | Not measured | Not measured | MB/GB; measurement method required | |

**Test-set rule:** Do not populate test results during model selection. Fill them only after the checkpoint and evaluation protocol are frozen and approved for final evaluation.

## E. Failure-case review

| Failure type | Observed? | Case IDs / evidence | Likely cause (hypothesis only) | Follow-up |
|---|---|---|---|---|
| False positives | Not reviewed | Not recorded | Not assessed | |
| Missed vessels / branches | Not reviewed | Not recorded | Not assessed | |
| Disconnected regions | Not reviewed | Not recorded | Not assessed | |
| Geometry mismatch | Not reviewed | Not recorded | Not assessed | |
| Boundary leakage | Not reviewed | Not recorded | Not assessed | |
| Other | Not reviewed | Not recorded | Not assessed | |

## F. Summary and decision

- **Measured observations:** Not measured.
- **Comparison against previous run:** Not possible until runs and settings are recorded.
- **Known limitations:** Not reviewed for this experiment.
- **Decision:** Not decided.
- **Reviewer / date:** Not recorded.

## G. Reproducibility attachments

Attach or link:
- Exact config file and its SHA-256.
- Checkpoint and SHA-256.
- Git commit SHA and branch.
- Train/validation/test/exclude list hashes.
- Environment export (`pip freeze`, `conda env export`, or equivalent).
- Exact command lines and logs.
- Evaluation output JSON/CSV and metric code version.
- Representative prediction/reference overlays and failure-case notes, with case IDs handled according to team privacy policy.
