# VascuAI — Milestone 2: Segmentation Evaluation & Technical Documentation

**Repository reviewed:** `artery_demo-main` ZIP supplied by the project contributor  
**Scope:** Documentation only; no model, training, dataset, API, or frontend code changes.

## Purpose

This documentation records what can be verified from the supplied repository and its checked-in technical reports. It separates:

- **Implemented facts:** supported directly by source code, tests, or checked-in reports.
- **Historical reported results:** results recorded in an earlier integration report but not independently reproduced from this ZIP.
- **Not measured / unavailable:** information for which the reviewed repository does not contain sufficient evidence.

This is a research software prototype. The repository explicitly states that the model is experimental and not clinically validated.

## Seven requested sections

1. [Segmentation Evaluation Methodology](segmentation_evaluation_methodology.md)
2. [Dataset and Data-Split Documentation](dataset_and_data_split.md)
3. [Evaluation Report Template](evaluation_report_template.md)
4. [Model Comparison Table](model_comparison.md)
5. [Segmentation Error Analysis](segmentation_error_analysis.md)
6. [Reproducibility Checklist](reproducibility_checklist.md)
7. [Open Questions and Work Summary](open_questions_and_work_summary.md)

## Key verified repository facts

- Model: `SmallUNet3D`, a one-channel 3D U-Net baseline with base width 8 and 85,177 parameters.
- Checkpoint: the integration report records a step-700 checkpoint and its SHA-256, but the checkpoint file itself is not included in the supplied ZIP.
- Input: 3D CT in NIfTI-1 or NIfTI-2 format (`.nii` / `.nii.gz`). The API requires case modality `CTA` or `CT Angiography`. DICOM, MRA, 2D images, and 4D inference are not supported by this inference path.
- Preprocessing: clip CT values to `[-200, 800]`, then normalize using `(image + 200) / 1000`.
- Inference: sliding windows of `64 × 64 × 64`, stride 32; sigmoid probabilities from overlapping patches are averaged.
- Default binary threshold: 0.70.
- Output: probability volume and binary mask, with source NIfTI geometry preserved.
- Reference comparison currently implemented in `inference.py`: Dice only. Reference foreground is defined as `label > 0`; CT and reference dimensions, affine, spacing, and spatial units are checked (unknown units require an explicit override).
- The checked-in historical integration report records case-851 Dice `0.131794...` and a handoff-reported mean per-case Dice of approximately `0.1052` on validation cases 851–900. The aggregate report/split manifest were absent and the aggregate was not recomputed in that report.
- The ZIP does not include the medical dataset, model checkpoint, full validation outputs, or training scripts for reproducing the reported model training.

## Important reporting rule

Do not report the historical case-851 result as overall model performance. Do not report the approximately 0.1052 validation mean as independently verified. Do not fill missing metrics with estimates. Use **Not measured** or **Not available in the reviewed repository**.

## Source files reviewed

- `README.md`
- `backend/app/services/segmentation/model.py`
- `backend/app/services/segmentation/inference.py`
- `backend/app/services/segmentation/README.md`
- `backend/app/routers/segmentation.py`
- `backend/app/schemas/segmentation.py`
- `backend/tests/test_segmentation_inference.py`
- `docs/model-integration-verification.md`
- `backend/requirements-model.txt`

## Scope and limitations

This document set describes the repository snapshot supplied for review. It does not prove that the ZIP is the newest remote GitHub commit. Before merging, compare it with the team's current branch and retain the source commit SHA in the final report.
