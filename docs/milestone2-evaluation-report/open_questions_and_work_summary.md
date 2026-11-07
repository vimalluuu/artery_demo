# 7. Open Questions and Work Summary

## 7.1 Work completed by this documentation review

The supplied VascuAI ZIP was inspected for model architecture, preprocessing, inference, API behavior, tests, dependencies, and existing integration reports.

Verified from source/report files:

- A `SmallUNet3D` architecture is implemented with base channels 8 and 85,177 parameters.
- The inference path uses 3D NIfTI CT, fixed 64³ patches, stride 32, overlap probability averaging, and a default threshold of 0.70.
- CT preprocessing clips values to `[-200, 800]` and normalizes using `(image + 200) / 1000`.
- The model outputs probabilities and a binary mask; source geometry is preserved in output files.
- The current reference metric function calculates Dice after checking CT/reference geometry and spatial units.
- The model is explicitly marked experimental and not clinically validated.

## 7.2 Open questions for the project team

1. What is the exact current GitHub branch and commit SHA represented by this ZIP?
2. Can the team provide the checkpoint binary from the documented handoff and verify its SHA-256?
3. Where are the official ImageCAS dataset version and access details recorded?
4. Can the team provide the exact case-level train/validation/test split manifest?
5. Are the stated training cases 251–260 and validation cases 851–900 confirmed by the original experiment records?
6. Where are the full per-case validation outputs and the report supporting the approximate 0.1052 mean Dice?
7. What training scripts, hyperparameters, random seeds, augmentation, optimizer, loss, and stopping criteria produced the checkpoint?
8. Can the case-851 CT/reference/prediction artifacts be made available for independent visual review?
9. Should IoU, precision, recall, specificity, ASSD, and HD95 be implemented in a separate evaluation module?
10. What is the team's agreed policy for empty masks and unknown spatial units?
11. What hardware/runtime target should be used for fair model comparison?
12. What independent clinical/reader validation is planned before any diagnostic claims?

## 7.3 Items not measured or not available in the supplied ZIP

- Full-dataset training or retraining.
- Independently reproduced validation mean.
- Held-out test performance.
- IoU, precision, recall, specificity, ASSD, HD, and HD95 for the reported sample.
- Per-case error analysis with image overlays.
- Model-only inference time for the historical case (the report's 190.332 seconds includes reference checks and output writing).
- Cross-model comparison.
- Clinical performance or clinical validation.

## 7.4 Next steps

1. Confirm the ZIP's source branch and commit SHA with the repository owner.
2. Obtain and checksum the external checkpoint and the exact dataset split manifest.
3. Re-run evaluation on the designated validation set without using the held-out test set.
4. Implement and test the additional requested metrics in a separate evaluation module, if approved by the team.
5. Perform case-level visual error analysis and record representative failure cases.
6. Update the evaluation report with measured per-case and aggregate results.
7. Keep all documentation-only changes separate from model, dataset, API, and frontend implementation changes.

## 7.5 Scope statement

This assignment documents evaluation methodology and the evidence currently available. It does not claim that training is complete, that all requested metrics have been measured, or that the model is clinically validated.
