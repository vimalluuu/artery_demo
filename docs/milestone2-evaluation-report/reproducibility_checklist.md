# VascuAI — Reproducibility and Dataset-Split Checklist

Use this checklist for every training or evaluation run. Mark each item **Yes**, **No**, or **Not applicable** and include evidence. Do not mark an item complete without checking it.

## 1. Dataset provenance and split integrity

- [ ] Record dataset name, source URL, version/date, licence/usage notes, and local root.
- [ ] Confirm all required volumes have matching ground-truth masks and consistent case IDs.
- [ ] Record hashes for `train.txt`, `val.txt`, `test.txt`, and `exclude.txt`.
- [ ] Count IDs in each file from the actual files; report these counts, not assumed counts.
- [ ] Check duplicate IDs within each split.
- [ ] Check pairwise intersections between train, validation, and test; expected intersection is zero.
- [ ] Confirm excluded IDs are dropped from every split.
- [ ] Confirm splitting is at patient/scan level, not slice/patch level.
- [ ] Confirm derived patches, crops, resampled volumes, caches, and labels preserve split membership.
- [ ] Document any manually removed or missing cases and the reason.
- [ ] Keep held-out test IDs and labels untouched during model selection.

## 2. Model and source identity

- [ ] Record repository URL, branch, and Git commit SHA.
- [ ] Record model architecture and exact config file path.
- [ ] Record config file SHA-256.
- [ ] Record checkpoint path, source, epoch/step, and selection rule.
- [ ] Calculate and record checkpoint SHA-256.
- [ ] Record any pretrained weights and their source/hash.
- [ ] Confirm the checkpoint is the one actually loaded during inference.

## 3. Preprocessing and label semantics

- [ ] Record input modality and file format.
- [ ] Record label mapping, including whether labels are multi-class or binarised.
- [ ] Record intensity windowing/normalization.
- [ ] Record target voxel spacing and resampling interpolation for images and masks.
- [ ] Record orientation, origin, direction/affine, and spatial dimensions.
- [ ] Record crop/pad strategy and patch size.
- [ ] Record any data-dependent preprocessing and confirm it does not fit on validation/test data.
- [ ] Verify prediction and reference are in the same physical coordinate system before metrics.
- [ ] Record postprocessing, component filtering, thresholding, and their parameters.

## 4. Inference settings

- [ ] Record exact inference command / script entry point.
- [ ] Record probability threshold or argmax policy.
- [ ] Record sliding-window/patch size, overlap, and blending method.
- [ ] Record test-time augmentation settings.
- [ ] Record batch size and device (CPU/GPU).
- [ ] Record output format and whether predictions were resampled to original geometry.
- [ ] Record timing methodology, warm-up policy, number of repeats, and whether I/O is included.
- [ ] Record peak memory if measured.

## 5. Metric calculation

- [ ] Record metric library, version, and code commit.
- [ ] Define TP, FP, FN, TN and foreground/background convention.
- [ ] Define Dice and IoU calculation.
- [ ] Define precision, recall/sensitivity, and specificity.
- [ ] Define boundary metric implementation (ASSD, HD, HD95), point sampling, weighting, percentile convention, and units.
- [ ] Define empty-mask and zero-denominator behavior.
- [ ] Define per-scan versus pooled calculation and macro/micro averaging.
- [ ] State whether background is excluded from overlap metrics.
- [ ] Confirm distances use physical units only after geometry validation.
- [ ] Store per-scan results as well as summary statistics where permitted.

## 6. Validation/test governance

- [ ] Use validation results for model selection and threshold/postprocessing decisions.
- [ ] Freeze model, checkpoint, and protocol before final test evaluation.
- [ ] Do not repeatedly inspect test scores to choose configurations.
- [ ] Record who authorized the final test run and when.
- [ ] If a test result influences a new model decision, treat the test set as no longer untouched for that decision and document the limitation.

## 7. Software and hardware environment

- [ ] Record OS and Python version.
- [ ] Record PyTorch and relevant imaging/metric library versions.
- [ ] Record CUDA/cuDNN versions when applicable.
- [ ] Record CPU/GPU model and available memory.
- [ ] Save dependency lock/export (`pip freeze`, `conda env export`, or equivalent).
- [ ] Record random seeds and deterministic settings, where supported.
- [ ] Preserve logs, exact command lines, config, checkpoint hash, and results.

## 8. Failure-case review

- [ ] Review false positives.
- [ ] Review missed vessels/branches.
- [ ] Review disconnected components and topology issues.
- [ ] Check geometry mismatches.
- [ ] Review boundary leakage and small-branch performance.
- [ ] Record representative case IDs, evidence, hypotheses, and follow-up actions.
- [ ] Do not present hypotheses as proven causes.

## Current known status from prior project notes

- Local dataset folder reportedly contains `filelist/train.txt`, `val.txt`, `test.txt`, and `exclude.txt`.
- Exact split counts and intersection checks: **Not verified**.
- Active model configuration/checkpoint for a completed experiment: **Not verified**.
- Verified segmentation evaluation results and inference times: **Not measured**.
- Prior notes refer to `imagecas_manual`, `imagecas_baseline`, stage configs for coarse/dilated/patch sizes 16/32/64, and checkpoint filenames `cas_net.pt`, `ffr_unet.pt`, `swin_unetr.pt`; the active run must be confirmed from the repository and logs.
- Prior environment note: Python 3.12 and PyTorch `2.14.1+cpu` were observed on the user's local machine at one point; this is not proof that these versions were used for a model experiment.

## Open questions to resolve with the team

1. Which exact ImageCAS-X dataset version/source and local split files are authoritative?
2. What are the verified counts and intersections for train, validation, test, and excluded IDs?
3. Which architecture/config/checkpoint is the team's current baseline?
4. Is evaluation binary lumen-versus-background or multi-class by coronary branch?
5. Which metric library/code should be treated as the reference implementation?
6. Which preprocessing, resampling, threshold, postprocessing, and inference overlap settings are active?
7. Which validation results/logs are available, and has any test-set evaluation already occurred?
8. What format/location does the team prefer for reports and run artifacts?
