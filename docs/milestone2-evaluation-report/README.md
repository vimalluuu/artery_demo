# VascuAI Milestone 2 — Segmentation Evaluation & Technical Documentation

This package contains the proposed documentation deliverables for review:

1. `segmentation_evaluation_methodology.md` — metric definitions/formulas, interpretation, limitations, dataset notes, leakage precautions, and failure modes.
2. `model_comparison_template.md` — reusable per-experiment report template.
3. `reproducibility_checklist.md` — split integrity, checkpoint/config identity, preprocessing, inference, metrics, environment, and governance checklist.

## Evidence and limitations

- No model results or inference times have been invented. Unavailable results are marked **Not measured**.
- Prior local notes indicate that `filelist/train.txt`, `val.txt`, `test.txt`, and `exclude.txt` exist, but exact split counts and overlap checks are not verified here.
- The official ImageCAS-X repository documents 800 CCTA scans, multi-label coronary annotations, centerlines/surfaces, and split-file conventions: https://github.com/kitbransby/ImageCAS-X/blob/main/README.MD
- The actual active model config, checkpoint hash, evaluation implementation, and environment for a completed experiment must be confirmed from the team's repository and logs.
- These are documentation files only. They do not modify model code, training scripts, dataset files, APIs, database schema, or frontend.

## Suggested branch

`docs/milestone2-evaluation-report`

Review and update these documents against the actual repository conventions before committing or opening a pull request. Do not merge until the team reviews them.
