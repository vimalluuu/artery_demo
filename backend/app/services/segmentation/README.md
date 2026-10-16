# Experimental SmallUNet3D integration

This is the supplied baseline, not a clinically validated system. It was trained
on ImageCAS cases 251–260. The handoff reports a best tested **mean per-case Dice
of approximately 0.1052 at threshold 0.70** over validation cases 851–900. The
held-out test set was not used. The optional full validation reports and split
manifest were **not present** in this handoff; that aggregate score has not been
recomputed here. One sample's score is not an aggregate or clinical validation.

The architecture is copied from the handoff: base channels 8, 85,177 parameters,
Conv3D/BatchNorm3D/ReLU blocks, two pooling levels, transposed convolutions and
skip connections, one-channel logits. There is no training code in this service.
The original weights must remain unchanged. The loader uses `weights_only=True`,
CPU mapping, finite-weight checks, and `load_state_dict(..., strict=True)`; there
is no unrestricted pickle fallback.

## Setup and artifacts

Use the existing backend environment and install its normal dependencies first:

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-model.txt --index-url https://download.pytorch.org/whl/cpu
```

PyTorch is optional for the ordinary authentication/case/upload APIs. The tested
CPU runtime is PyTorch 2.14.1+cpu. For CUDA, install a compatible official PyTorch
wheel, then explicitly configure `VASCULAI_MODEL_DEVICE=cuda`. CUDA has not been
verified locally. No automatic package or checkpoint downloads occur at runtime.

The preserved local handoff root is:

```text
F:\Documents\artery_demo\model\vascuai_model_handoff_for_codex_20261016\vascuai_model_handoff_recovered
```

Verified artifact paths relative to that root:

```text
model\artery_unet_10case_weighted_step700.pt
sample\case_851_ct.nii.gz
sample\case_851_reference_mask.nii.gz
```

Checkpoint SHA-256:
`e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`.
Both sample volumes have shape `(512, 512, 217)`. All eight entries in the supplied
SHA256SUMS.txt were verified before implementation. README.md, metadata, model
source, inference source, checkpoint and both sample files are present. The
optional `reports/` directory is absent. Leave the handoff untouched.

For a durable external artifact store, recommended exact destinations are:

```text
F:\Documents\vascuai-artifacts\checkpoints\artery_unet_10case_weighted_step700.pt
F:\Documents\vascuai-artifacts\samples\case_851_ct.nii.gz
F:\Documents\vascuai-artifacts\samples\case_851_reference_mask.nii.gz
```

These recommended destinations are not assumed to exist: copy and verify the
files before pointing configuration there. The local verification uses the
existing handoff paths, and writes sample outputs outside the repository under
`F:\Documents\vascuai-artifacts\runs\`. The root `.gitignore` excludes the entire
local `model/` handoff, weights, NIfTI files, Python caches and environments. No
weights or volumes belong in normal Git history; Git LFS is not required here.

## Configuration

Copy/update `backend/.env` locally; `.env.example` contains all model settings.
`VASCULAI` is the exact spelling of these environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VASCULAI_MODEL_CHECKPOINT` | unset | Existing trusted checkpoint path, absolute recommended |
| `VASCULAI_MODEL_THRESHOLD` | `0.70` | Binary foreground when probability >= threshold |
| `VASCULAI_MODEL_DEVICE` | `cpu` | `cpu`, `cuda`, or explicit `auto` |
| `VASCULAI_MODEL_BATCH_SIZE` | `1` | 1–16 patches; higher values require more RAM/VRAM |
| `VASCULAI_MODEL_THREADS` | `4` | CPU intra-op threads, 1–32 |
| `VASCULAI_MODEL_MAX_VOXELS` | `67108864` | Inference spatial voxel limit, additionally bounded by upload limit |
| `OUTPUT_DIR` | `./outputs` | Backend result storage, never a public static directory |

For this machine, a PowerShell session can use the preserved checkpoint directly:

```powershell
$env:VASCULAI_MODEL_CHECKPOINT = 'F:\Documents\artery_demo\model\vascuai_model_handoff_for_codex_20261016\vascuai_model_handoff_recovered\model\artery_unet_10case_weighted_step700.pt'
```

No Windows path is hardcoded in executable production code. The API uses the
existing database/upload configuration and requires reviewed migration
`0005_segmentation_results` (`python -m alembic upgrade head`). This task applies
migrations only to disposable test databases, never an existing application DB.

Migration 0005 has a conventional downgrade to 0004: it first drops
`ix_segmentation_results_case_id`, then `segmentation_results`. **This permanently
deletes all segmentation history and provenance rows.** It does not alter existing
case/user/volume data or remove study/output files. A later upgrade creates an
empty result table. Earlier migrations remain forward-only. Back up history
before any intentional downgrade; this task exercises rollback only in test DBs.

## Input, preprocessing and outputs

Only a **three-dimensional CT** NIfTI-1 or NIfTI-2 (`.nii` or `.nii.gz`) can be
segmented. Existing ingestion still accepts 3D/4D NIfTI; 4D inference is rejected
explicitly. DICOM remains unsupported, as do MRA and 2D-image inference. The API
requires case modality `CTA` or `CT Angiography`; modality is a user assertion,
not an automatic verification of HU calibration. CT values must already represent
the expected intensities. NIfTI slope/intercept is applied by the reader.

The existing bounded header/payload/geometry validation runs before voxel reads.
Inference additionally checks dimensions, resource limits and finite voxel data.
It preserves the handoff's exact algorithm:

1. Clip to `[-200, 800]`, normalize with `(image + 200) / 1000`.
2. Cover the original voxel axes with `64 × 64 × 64` patches, stride 32,
   explicitly covering the far boundary; zero-pad only axes shorter than 64.
3. Apply sigmoid independently to each patch's logits and **average overlapping
   probabilities**. No resampling or reorientation is introduced.
4. Crop padding, then use `probability >= threshold` for the uint8 binary mask.

Threshold 0.70 is an explicit configurable default based on the supplied
validation summary, rather than the handoff CLI's 0.50 default. This does not
establish an optimal or clinically validated threshold.

Each run writes a **new** directory containing:

- `probabilities.nii.gz`: float32 foreground probabilities, not calibrated clinical confidence.
- `prediction_mask.nii.gz`: uint8 values 0/1.
- `metadata.json`: checkpoint/source SHA-256, step, configuration, geometry,
  actual probability range, foreground count, elapsed time, limitations, and
  optional reference metrics.

Output dimensions, affine, qform/sform matrices and codes, voxel spacing, units,
NIfTI version and header extensions are preserved. Data dtype, intensity scaling
and display calibration are reset for probabilities/masks so CT scaling cannot
corrupt their values. Outputs inherit source header metadata: supply de-identified
inputs and handle outputs as protected study artifacts.

Reference annotations are optional CLI inputs. Their shape, affine and units must
match the CT, and foreground is **label > 0**. Dice is computed on the whole
sample with no smoothing; two empty masks yield 1. No reference is uploaded or
evaluated by the API in this phase.

The supplied sample has an actual metadata discrepancy: the CT declares `mm`,
but the reference declares `unknown` spatial units. Dimensions, affine and voxel
spacing match exactly. Evaluation rejects this by default. For this supplied
pair, the local verification explicitly uses `--allow-reference-unknown-units`
to assume voxelwise correspondence; metadata records both units and this
override. This option never bypasses dimension, affine or spacing checks and
does not edit either source header. No resampling is performed.

## Standalone execution

From `backend/`, using the existing handoff (output directory must not exist):

```powershell
python -m app.services.segmentation.inference --ct ../model/vascuai_model_handoff_for_codex_20261016/vascuai_model_handoff_recovered/sample/case_851_ct.nii.gz --checkpoint ../model/vascuai_model_handoff_for_codex_20261016/vascuai_model_handoff_recovered/model/artery_unet_10case_weighted_step700.pt --reference-mask ../model/vascuai_model_handoff_for_codex_20261016/vascuai_model_handoff_recovered/sample/case_851_reference_mask.nii.gz --allow-reference-unknown-units --output-dir F:/Documents/vascuai-artifacts/runs/case-851-new-run --threshold 0.70 --batch-size 1 --device cpu --threads 4
```

The CLI reads the checkpoint and threshold environment variables as defaults;
other CLI options are explicit and do not read backend `.env`. Progress reports
actual patch counts. Failures exit nonzero. Existing outputs are never overwritten.

## Backend API contract

Existing case/image/volume endpoints and case status semantics are unchanged.
The new authenticated endpoints use the existing four-role policy:

| Endpoint | Access | Behavior |
| --- | --- | --- |
| `POST /api/v1/cases/{id}/segmentations` | Clinician/Admin | JSON `{}` or `{"threshold":0.70}`; synchronous inference, 201 only after output + DB persistence |
| `GET /api/v1/cases/{id}/segmentations` | All four case-reader roles | Run metadata/history, stale flag and authenticated download URLs |
| `GET /api/v1/cases/{id}/segmentations/{result_id}/mask` | All case readers | Protected uint8 NIfTI download |
| `GET /api/v1/cases/{id}/segmentations/{result_id}/probabilities` | All case readers | Protected float32 NIfTI download |

Responses contain `id`, `case_id`, `created_at`, `stale`, `metadata`, `mask_url`
and `probabilities_url`. Internal storage paths are not returned. Artifacts are
UUID-scoped, never served by a static upload/output mount, and downloaded with
`Cache-Control: no-store`. Authorization follows the repository's existing
role-wide case access; this phase does not introduce patient ownership rules.

Missing case/input is 404, invalid input 400, missing CT/modality or replaced input
409, request validation 422, missing runtime/checkpoint or busy worker 503,
execution/storage failure 500. Failed pre-commit runs are rolled back and their
owned output files removed. Original volume and checkpoint files are never
modified. Volume replacement marks prior runs stale; stale downloads are blocked.
Staleness also compares the persisted inference `metadata.source_sha256` with
the current source file's SHA-256, so changed bytes at the same path are detected.
Missing/unreadable inputs and legacy records without a source checksum are
treated as unverifiable: history returns `stale: true` and downloads return 409.
The response schema, metadata keys and endpoint paths are unchanged; this
strengthens the existing stale flag and 409 behavior rather than adding fields.

Checksum calculation is cached per API process for up to 128 file versions,
keyed by resolved path, device/file identity, byte size, and nanosecond modification
and change timestamps. Inference populates this cache. Ordinary history/download
requests stat the source and reuse its checksum; a changed version, cold worker
or cache eviction triggers one bounded-memory streaming rehash. Concurrent cold
reads are serialized, and changes during hashing or inference are rejected.
Touching a file without changing its bytes rechecks the hash but keeps results
current. No additional schema migration or checksum backfill is necessary because
the strong source hash already lives in result metadata.

The cache relies on observable filesystem changes and application-owned immutable
UUID uploads. It is not a defense against an actor rewriting bytes while forging
every cache-key attribute, and it is not a storage-integrity monitoring service.
Detecting such tampering without reads requires enforced immutable/versioned
storage; operators must keep upload storage private. Restart clears the cache.
Audit events are recorded for creation, listing and artifact access.

There is **one active inference per API process**, with immediate busy rejection.
This is synchronous research infrastructure: no durable queue, polling job API,
cancellation or cross-worker resource coordination. Use one API worker, budget
several GB of RAM and configure HTTP/proxy timeouts for actual CPU duration.
If a client times out, the server may still finish; inspect run history before
retrying. Storage retention and case-deletion orphan cleanup are operational
follow-ups; no deletion API is added. API/database health does not establish
model readiness.

The frontend is intentionally unchanged in this backend integration. Its existing
analysis readiness screens do not yet call these endpoints. A later UI change
must add a real run action, retrieve history, download with bearer authentication,
and render protected voxel data before claiming a working 3D viewer. Stenosis,
severity, confidence, clinical findings and clinical reports remain unavailable.

## Deployment and tests

The normal Docker image keeps inference optional. To include CPU PyTorch, use
`deploy/compose.model.yaml` alongside the existing Compose file; set
`MODEL_ARTIFACT_DIR` to the host directory containing the named checkpoint. The
overlay mounts it read-only at `/models`, sets the configurable model environment,
and enables the optional image build dependency. Apply the reviewed migration
before starting the API. Standard `/api/v1` and `/health` routing is preserved.
The current nginx timeout is 300 seconds; longer runs need an adjusted timeout or
a future background job worker. Images/full deployment must be tested on the
actual hosting environment; no production deployment is claimed here.

From `backend/`:

```powershell
$env:VASCULAI_TEST_CHECKPOINT = $env:VASCULAI_MODEL_CHECKPOINT
python -m pytest -q
python scripts/test_postgres.py --bin 'C:\Program Files\PostgreSQL\18\bin'
python scripts/test_frontend_contract.py
python -m pip check
```

Algorithm tests use explicitly synthetic arrays and NIfTI files, not patient data.
Original-checkpoint tests skip unless `VASCULAI_TEST_CHECKPOINT` is set. Inference
algorithm tests skip without optional PyTorch; API authorization/failure tests
remain runnable. The supplied full sample is exercised separately by the CLI.
