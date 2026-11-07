# 6. Reproducibility Checklist

Use this checklist before running or publishing an evaluation.

## Repository and software

- [ ] Record repository URL, branch, commit SHA, and date.
- [ ] Record Python version and operating system.
- [ ] Record installed package versions.
- [ ] Install core backend requirements from `backend/requirements.txt`.
- [ ] Install the optional model runtime from `backend/requirements-model.txt`.
- [ ] Record PyTorch version and whether CPU or CUDA is used.
- [ ] Record hardware, available RAM/VRAM, and device settings.

## Dataset and split

- [ ] Record dataset name, version, access source, and permitted use.
- [ ] Record exact case-level train/validation/test manifests.
- [ ] Verify patient/study separation across splits.
- [ ] Confirm the test set was not used for tuning or threshold selection.
- [ ] Record annotation source and foreground-label definition.
- [ ] Record exclusions and missing/corrupt cases.
- [ ] Store split manifest checksum or controlled location.

## Model and checkpoint

- [ ] Record architecture (`SmallUNet3D` for the reviewed baseline).
- [ ] Record base channels and parameter count.
- [ ] Record checkpoint filename, size, and SHA-256.
- [ ] Record training provenance (dataset split, step/epoch, configuration).
- [ ] Confirm strict checkpoint loading succeeds.
- [ ] Confirm weights are finite.
- [ ] Do not modify the original checkpoint during inference.

## Input and inference settings

- [ ] Confirm the input is a supported 3D CT NIfTI volume.
- [ ] Record input shape, affine, voxel spacing, and spatial units.
- [ ] Record intensity preprocessing: clip `[-200, 800]`; normalize `(image + 200) / 1000`.
- [ ] Record patch size `64 × 64 × 64` and stride `32`.
- [ ] Record padding and overlap-probability averaging behavior.
- [ ] Record batch size, threshold, device, and CPU thread count.
- [ ] Record any geometry/unit override and its justification.
- [ ] Record source and checkpoint checksums in run metadata.

## Metrics and reporting

- [ ] Confirm prediction and reference dimensions match.
- [ ] Confirm affine, spacing, and spatial units match.
- [ ] Confirm reference foreground definition (`label > 0` in current implementation).
- [ ] Record per-case TP/FP/FN/TN if available.
- [ ] Calculate Dice using a documented zero-denominator convention.
- [ ] Calculate IoU, precision, recall, and specificity only with verified confusion counts.
- [ ] Calculate ASSD/HD95 only with a documented physical-space surface method.
- [ ] Report per-case metrics and number of cases.
- [ ] Distinguish model-only inference time from total pipeline time.
- [ ] Include error analysis and failure cases.
- [ ] Mark unavailable values as **Not measured**.

## Current repository limitations

- The supplied ZIP does not include the dataset, checkpoint binary, full validation outputs, split manifest, or training scripts.
- The inspected reference-metric function currently calculates Dice only.
- IoU, precision, recall, specificity, ASSD, HD, and HD95 are not implemented in that function.
- The model is explicitly experimental and not clinically validated.
