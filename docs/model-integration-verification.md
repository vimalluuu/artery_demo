# Model integration verification — 2026-10-16

Work is uncommitted on `model-integration`, starting from
`e7621fa9d37ec64e1df6e8f6e749692636882628` (UI PR #6 merge). No commit, push,
merge, PR creation, staging, existing application DB migration, or deployment
was performed. The original local `model/` handoff remains preserved and is now
ignored by Git. Model weights and medical volumes are not source files.

## Actual artifact inspection

Handoff root:
`F:\Documents\artery_demo\model\vascuai_model_handoff_for_codex_20261016\vascuai_model_handoff_recovered`.

| Artifact | Actual path relative to handoff root | Result |
| --- | --- | --- |
| README | `README.md` | Present, checksum matches |
| Metadata | `handoff_metadata.json` | Present, checksum matches |
| Checksums | `SHA256SUMS.txt` | All eight listed files verified before and after work |
| Architecture | `model/model.py` | Present; repository copy is byte-identical |
| Supplied inference | `model/inference.py` | Present; adapted for API and robust validation |
| Original checkpoint | `model/artery_unet_10case_weighted_step700.pt` | Strictly loaded, step 700, 85,177 parameters |
| CT | `sample/case_851_ct.nii.gz` | Present, shape `(512, 512, 217)` |
| Reference | `sample/case_851_reference_mask.nii.gz` | Present, same dimensions and affine |
| Optional reports/split manifest | `reports/` | Absent; aggregate validation not recomputed |

Checkpoint SHA-256 is
`e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`.
The architecture source SHA-256 is
`016c5336ccc55efd96d749e657d9c8e820234a439ba3cc57e439ff3f09344837`.
All original checksum entries still match. No checkpoint modification or training
was performed.

The [setup guide](../backend/app/services/segmentation/README.md) gives exact
current paths, recommended external destinations (not assumed to exist), and
commands for `VASCULAI_MODEL_CHECKPOINT`. Executable production code contains no
local Windows artifact path. Default threshold is explicitly 0.70, device CPU,
batch size 1, CPU threads 4. Existing core dependency pins are unchanged; optional
`requirements-model.txt` adds PyTorch 2.14.1. Local verification installed
PyTorch 2.14.1+cpu into the existing ignored root virtual environment, together
with its dependencies. CUDA is unavailable on this machine and untested.

## Actual sample inference

The complete supplied case 851 CT was processed using the original checkpoint,
64³ patches, stride 32, sigmoid, mean overlap blending and threshold 0.70.
There were **1,350 patches**, processed with batch size 1 and four CPU threads.
The successful CLI run took **190.332 seconds**, including reference checks and
output writing. Hardware timings are environment-specific.

The first evaluation attempt correctly stopped on a real metadata discrepancy:
CT spatial units are `mm`; reference spatial units are `unknown`. Their shapes,
affine matrices and voxel spacing match exactly. The rerun used explicit
`--allow-reference-unknown-units`, assuming voxelwise correspondence for this
provided pair. The run metadata records the override. Neither input header was
edited, and no reorientation/resampling was applied. Default evaluation rejects
this discrepancy. Dimensions/affine/spacing mismatches cannot be overridden.

| Measurement | Actual result |
| --- | --- |
| Input/output dimensions | `(512, 512, 217)` |
| Probability range | `0.011056370101869106` to `0.9993986487388611` |
| Predicted foreground voxels | `567894` |
| Reference foreground voxels (`label > 0`) | `117888` |
| Intersection voxels | `45191` |
| Case 851 Dice at 0.70 | `0.13179406866905227` |

These are single-case software verification measurements under the documented
alignment assumption. They are **not** the Fold 4 mean. The supplied report of
approximately 0.1052 mean per-case Dice over cases 851–900 was not independently
reproduced; those complete data/reports were not present. Training used cases
251–260; no held-out test cases were used in this task. The model remains an
experimental baseline with substantial limitations, not clinically validated.

Outputs are outside the Git workspace:

```text
F:\Documents\vascuai-artifacts\runs\case-851-step700-threshold070-20261016\probabilities.nii.gz
F:\Documents\vascuai-artifacts\runs\case-851-step700-threshold070-20261016\prediction_mask.nii.gz
F:\Documents\vascuai-artifacts\runs\case-851-step700-threshold070-20261016\metadata.json
F:\Documents\vascuai-artifacts\runs\case-851-step700-threshold070-20261016\verification.json
```

An independent readback verified finite float32 probabilities bounded by [0,1],
uint8 mask values restricted to 0/1, exact mask agreement with saved probabilities
at threshold 0.70, and independently recomputed Dice. Input/output shape,
NIfTI version, affine, qform and sform matrices/codes, voxel spacing and spatial
units match the CT. Synthetic NIfTI-1/2 tests additionally verify preservation
of header extensions and that CT slope/intercept does not corrupt mask values.
The independent verification JSON contains the checks and unchanged artifact
hash results.

## Tests actually run

| Check | Result |
| --- | --- |
| Full backend suite, disposable SQLite (2026-10-17 review) | **280 passed**, 3 existing deprecation warnings |
| Full backend suite, isolated PostgreSQL 18 (2026-10-17 review) | **280 passed**, 3 existing deprecation warnings; overall coverage 92% |
| Segmentation, fingerprint and migration tests (2026-10-17 review) | **45 passed**, included above; original-checkpoint tests enabled |
| Live Axios-to-FastAPI contracts | **3 passed**, disposable DB |
| Frontend unit/contract tests | **57 passed** |
| Production frontend build | Passed |
| `pip check` | No broken requirements |
| Compose with optional CPU-model overlay | Configuration validation passed |
| Docker image/full stack execution | Unverified: Docker daemon unavailable |
| Git diff whitespace check | Passed |

Existing ingestion implementation, case upload router and frontend source files
were not changed. Existing tests still cover role synchronization, gzip/payload
bounds, original-byte preservation and NIfTI metadata. New tests cover strict
original-checkpoint loading, clipping/normalization, overlapping probability
averaging and boundaries, padding/cropping, invalid voxels, model failures,
geometry/dtype/scaling, missing checkpoint/runtime, 4D inference rejection while
4D upload still works, authorization, persistence cleanup, changed-volume races,
stale downloads, and busy-worker rejection.

Browser tests were not rerun in this backend-only implementation; frontend source
and routes are unchanged. Remote CI, CUDA, full container deployment and an
existing application database migration were not executed.

## API additions and remaining integration

- `POST /api/v1/cases/{id}/segmentations`: Clinician/Admin; synchronous 201 after
  output and DB persistence. Requires a stored 3D CT NIfTI and explicit CT case
  modality. Optional request threshold; runtime paths/devices remain server configuration.
- `GET /api/v1/cases/{id}/segmentations`: existing case-reader roles; history,
  metadata, stale flag and protected download URLs.
- `GET /api/v1/cases/{id}/segmentations/{result_id}/mask` and `/probabilities`:
  authenticated case readers; stale results are blocked.

The additive `0005_segmentation_results` migration stores provenance and history.
Case status and existing upload/API contracts are unchanged. Failed pre-commit
runs remove only their owned result files and roll back persistence. No fake
progress, scores, clinical findings or confidence fields are introduced.

The frontend still shows analysis readiness; no run button or 3D viewer is
connected yet. A future UI integration must use these endpoints, bearer-authenticated
artifact downloads and protected voxel rendering. DICOM and 4D inference remain
unsupported. API health establishes API/database readiness only.

Execution is synchronous, limited to one active run per process. There is no
durable queue, restart recovery, cancellation or cross-worker coordination. Use
one API worker and verify memory, storage and proxy timeouts in hosting. Long
requests can finish after a client timeout. Historical artifact retention and
orphan cleanup on case deletion remain operational follow-ups. Clinical reports,
stenosis detection, severity percentages, calibrated confidence and clinical
findings are unavailable.

## Complete source/document inventory

The 2026-10-17 focused review added conventional migration rollback and checksum
freshness checks. Its exact changed-file scope is the migration, segmentation
router, inference service, new `source_fingerprint.py`, the two existing
segmentation test files, two new fingerprint/migration test files, backend README,
segmentation README, and this report (11 files). The inventory below includes
the earlier integration work as well.

### Migration rollback and input freshness review — 2026-10-17

`0005_segmentation_results.downgrade()` drops
`ix_segmentation_results_case_id` before `segmentation_results`, then Alembic
records revision 0004. This permanently deletes segmentation history and
provenance rows. Existing users, patients, cases, volume metadata, audit records,
uploaded files and output files are retained. Re-upgrade creates an empty result
table/index. Both SQLite and PostgreSQL tests executed downgrade/re-upgrade only
in disposable test databases and compared all pre-existing table rows. An
offline PostgreSQL DDL test also verifies index-before-table order. Earlier
migrations remain forward-only.

Inference already persisted `metadata.source_sha256`; no additional schema or
API fields were needed. History and downloads now compare this checksum with the
current file checksum as well as the path. The current checksum is cached for
up to 128 file versions per process, using resolved path, device/file identity,
size, and nanosecond modification/change timestamps. Checks consistently use
handle-based `fstat()` after tests identified differing Windows `stat`/`fstat`
ctime behavior. Opening a handle for metadata does not read the volume payload.

Inference seeds the cache. Unchanged history/download requests reuse the digest;
file changes, restart or eviction cause a streaming rehash. Concurrent cold
reads are serialized. Changed bytes at the same path produce `stale: true` and
409 for either artifact download. Missing/unreadable inputs and records lacking
the expected checksum also fail closed. Unchanged bytes after a timestamp touch
still match after a rehash. A changed input during inference is rejected and
its uncommitted output directory removed.

This is application-owned filesystem freshness detection, not tamper-proof
storage verification: rewriting bytes while forging every cache-key attribute
cannot be detected without further reads or enforced immutable/versioned storage.
The existing response fields, metadata keys and routes are unchanged; the stale
flag and 409 behavior now cover changed or unverifiable content. Full-sample
inference was not repeated during this focused review; original-checkpoint
loading and synthetic-volume inference tests were rerun, and all eight original
handoff checksums were reverified unchanged. No existing application DB, model
weights, branches, commits or GitHub state were changed.

### Inventory

Modified:

- `README.md`
- `backend/.env.example`
- `backend/README.md`
- `backend/app/core/config.py`
- `backend/app/main.py`
- `backend/app/models/__init__.py`
- `deploy/.env.example`
- `deploy/README.md`
- `deploy/backend.Dockerfile`
- `docs/pre-milestone-verification.md`
- `docs/ui-features.md`

Created:

- `.gitignore`
- `backend/requirements-model.txt`
- `backend/app/models/segmentation.py`
- `backend/app/routers/segmentation.py`
- `backend/app/schemas/segmentation.py`
- `backend/app/services/segmentation/__init__.py`
- `backend/app/services/segmentation/model.py`
- `backend/app/services/segmentation/inference.py`
- `backend/app/services/segmentation/README.md`
- `backend/app/services/source_fingerprint.py`
- `backend/migrations/versions/0005_segmentation_results.py`
- `backend/tests/test_segmentation_api.py`
- `backend/tests/test_segmentation_inference.py`
- `backend/tests/test_segmentation_migration.py`
- `backend/tests/test_source_fingerprint.py`
- `deploy/compose.model.yaml`
- `docs/model-integration-verification.md`

All 28 source/document changes remain unstaged and uncommitted. The preserved
handoff and generated medical-volume outputs are excluded from ordinary Git
history. No branch switching, reset, artifact deletion or GitHub mutation was
performed.
