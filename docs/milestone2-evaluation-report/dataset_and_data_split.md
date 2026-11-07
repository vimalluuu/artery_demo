# 2. Dataset and Data-Split Documentation

## 2.1 Dataset identity

The checked-in segmentation documentation identifies the training source as **ImageCAS** and states that the supplied baseline was trained on cases **251–260**. It records a handoff-reported validation mean per-case Dice of approximately 0.1052 on cases **851–900**, with the held-out test set not used.

The supplied ZIP does not contain the ImageCAS dataset, reference masks, split manifest, or optional validation reports. Therefore, the dataset composition and split assignments cannot be independently audited from this ZIP alone.

## 2.2 What is and is not verified

| Item | Repository evidence | Status |
|---|---|---|
| Dataset name | `backend/app/services/segmentation/README.md` identifies ImageCAS | Documented by handoff; underlying dataset not included |
| Training cases | Cases 251–260 stated in segmentation README | Historical handoff statement; split manifest absent |
| Validation cases | Cases 851–900 stated for reported validation mean | Historical handoff statement; per-case report absent |
| Held-out test set | Report says it was not used | No test evaluation result provided |
| Dataset version/release | Not identified in supplied files | Not available |
| Annotation protocol/label guide | Not included | Not available |
| Exact train/validation/test manifest | Not included | Not available |
| Preprocessing during model training | Not fully reproducible from supplied ZIP | Not available |
| Training scripts/logs | No training pipeline included in the reviewed model service | Not available |

## 2.3 Leakage-prevention requirements

Before claiming final evaluation results:

1. Obtain the official dataset version and license/usage conditions.
2. Obtain the exact case-level train, validation, and test manifests.
3. Confirm that a patient/study cannot appear in more than one split.
4. Keep the test set untouched during model selection, threshold selection, and hyperparameter tuning.
5. Fit any data-derived normalization or preprocessing parameters using training data only.
6. Record exclusions, corrupted studies, and missing annotations.
7. Store split manifests under version control if permitted, or store their checksums and secure location if the data cannot be committed.
8. Record the dataset and annotation version alongside every experiment.

## 2.4 Data handling and modality constraints

The inspected inference service accepts 3D NIfTI-1/NIfTI-2 CT volumes (`.nii` or `.nii.gz`). The API requires the case modality to be `CTA` or `CT Angiography`. The implementation rejects 4D inference. The project documentation states that DICOM, MRA, and 2D-image inference are unsupported in this path.

These are implementation constraints; they do not establish that the input is correctly calibrated CT angiography or that annotations are clinically correct.

## 2.5 Required information from the team

- Exact ImageCAS release/version and access source.
- Case-level split manifest and rationale.
- Whether split IDs represent patients, studies, or volumes.
- Annotation source, label meaning, and annotation quality-control process.
- Training-time orientation, spacing/resampling, intensity handling, augmentation, patch sampling, and postprocessing.
- Confirmation that cases 851–900 are validation only and that no test cases influenced model development.
