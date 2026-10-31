# Supplied model attribution — contract 1.0

Phase 5 adds [metadata counts and report references](stenosis-analytics-reporting-v1.md)
without generating, downloading or assessing attribution maps for analytics.

Phase 4 implements private attribution-artifact integration and research
visualization. **No genuine explanation generator or stenosis model is registered.**
`get_runtime()` remains `None`; capability values/permissions are unchanged.
No Captum dependency, Grad-CAM computation, input gradient computation, synthetic
production map or model execution is added. Synthetic maps exist only in tests.

## Actual model compatibility

The inspected `backend/app/services/segmentation/model.py` implements SmallUNet3D:
Conv3D/BatchNorm/ReLU encoder/decoder with skip connections and one-channel voxel
logits. Its checkpoint-compatible loader uses base 8, 85,177 parameters, strict
state loading and `weights_only=True`. The existing sliding-window inference uses
`torch.inference_mode()`, exposes no activations/gradients or lesion prediction
target, and returns segmentation probabilities/masks rather than stenosis findings.
No separate advanced or stenosis model implementation was found in the inspected
application/research Python sources.

The available handoff checkpoint is
`F:/Documents/artery_demo/model/vascuai_model_handoff_for_codex_20261016/vascuai_model_handoff_recovered/model/artery_unet_10case_weighted_step700.pt`
(1,095,859 bytes), SHA-256
`e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`.
That identifies bytes, not a validated stenosis predictor or resolved training
history. No checkpoint was deserialized or executed for Phase 4. Root `.venv`
package metadata reports PyTorch 2.14.1+cpu; the global web-test interpreter and
backend `.venv` have no PyTorch distribution metadata. No environments changed.

CNN feature attribution or input-gradient methods might fit a future explicitly
defined segmentation target, but this is **not verified XAI compatibility**.
A genuine stenosis prediction/target record, differentiable target definition,
selected feature layer or baseline, preprocessing and sliding-window aggregation
semantics, gradient-capable execution path and source-grid correspondence must be
reviewed first. In-place ReLU/hook behavior also needs verification. Installing
Captum alone would establish none of those requirements. Production inference,
architecture, checkpoint and training code are untouched.

## Contracts and semantics

`ExplanationDetails` is the stored versioned metadata; `ExplanationSubmission`
adds source/job/grid assertions for trusted worker validation; `ExplanationMetadata`
adds the result UUID and visualization support state for reads.

Required metadata includes explanation/artifact UUIDs, optional lesion UUID,
aware timestamp, method ID/name/version, `explanation_type=attribution`, target
identifier/description/prediction-record SHA-256, model ID/version, optional
checkpoint SHA-256, explicit scope, value semantics, original-grid dimensions,
format/content SHA-256, float32 dtype and provider limitations. Public metadata
also contains source SHA, grid fingerprint and original source geometry.
Storage paths and claim tokens are never serialized.

Allowed method identifiers are `grad_cam`, `integrated_gradients`, `saliency`,
`feature_attribution`, `reviewed_other`. These are **supported metadata names**,
not implemented generators. Integrated Gradients requires a baseline description.
`reviewed_other` still requires the same reviewed runtime verifier; it is not an
arbitrary-method bypass.

| Scope | Interpretation and constraints |
| --- | --- |
| `volume` | Full source-grid map for a declared target |
| `prediction_target` | Full source-grid map explicitly bound to the supplied prediction record |
| `lesion` | Requires a lesion UUID belonging to this exact result; still a full-grid map |
| `slice` | Full-grid 3D NIfTI with an explicit original-array axis/index; every voxel outside that plane must be exactly zero |

No 2D screenshot/image, arbitrary array file, cropped map, independently oriented
map or implicit resampling is accepted. Every map uses the original 3D CT grid.
Original voxel order is zero-based NIfTI `[i,j,k]`; world geometry is RAS mm, as
defined in [the Phase-3 contract](stenosis-results-v1.md).

Value metadata declares `signed` or `non_negative`, an increasing finite range
bounded by ±1e12, provider normalization status/description and optional baseline.
Signed ranges straddle zero. Non-negative maps reject negative values even within
roundoff tolerance. `normalization=none` prohibits claiming that the file was
normalized for visualization; `provider_defined` requires the transformation to
be described. Supplied normalized data are preserved as supplied; raw data are
never silently normalized or overwritten by VascuAI.

Binary artery segmentation, supplied candidate region, attribution contribution,
prediction score and calibrated confidence are different data types. A signed
value is a method-specific contribution, not a probability. Neither an activation
map nor a visually convincing heatmap establishes that a lesion exists or that a
prediction is correct.

## Persistence and transaction boundary

`StenosisExplanationArtifact` / `stenosis_explanation_artifacts` has:

- Explanation UUID primary key; globally unique opaque artifact UUID.
- Restricted result and analysis-job FKs.
- Optional composite `(result_id, lesion_id)` FK to the exact lesion.
- Typed `ExplanationDetails` JSON and a server timestamp.
- `(result_id, id)` index.

Source SHA, affine and grid fingerprint are inherited through the immutable
result rather than separately stored mutable copies. Reads reconstruct and
validate typed metadata against that result; model checkpoint and lesion
association must still agree.

Migration `0008_stenosis_explanations` follows `0007_stenosis_results`.
PostgreSQL triggers prohibit updates/deletes and require a matching running
job/result for insertion. No unsafe cascade deletion is introduced. The migration
does not alter Phase-3 result/lesion immutability.

**Downgrade deletes explanation metadata/history**, dropping its index, table and
trigger function, while preserving existing users/cases/segmentations/jobs/results/
lesions and artifact files. Re-upgrade cannot recover that history. Back up the
database and private artifacts coherently before any separately approved rollback.
Only disposable PostgreSQL was migrated during Phase-4 tests.

Workers supply `SuppliedExplanation(metadata, path)` to:

```python
persist_completed_result(db, job_id, claim_token, result_payload, runtime,
                         region_inputs=None, explanations=supplied_explanations)
```

The existing Phase-3 signature remains compatible; `explanations` is optional and
keyword-only. The result writer calls internal `persist_explanation_artifact()`
after inserting result/lesions and before lifecycle completion. It requires:

1. A valid, unexpired running-job claim and fresh source/parent segmentation.
2. Exact result/job/source/grid and optional lesion association.
3. Exactly one matching reviewed explanation provider for method/version,
   model/version and checkpoint, with checkpoint equal to job provenance.
4. That provider's `verify_target(target, result, lesion_id) is True`. A future
   verifier must resolve the digest/identity against a **genuine prediction record**,
   not return True merely because a payload has plausible text or a filename.
5. Bounded, checksum-verified original artifact bytes and validated continuous
   values/geometry.

The runtime exposes an `ExplanationProvider` protocol with target verification and
a future worker-only generator method. No implementation is registered or invoked.
The infrastructure cannot independently prove target truth in the absence of that
real provider; its acceptance gate stays closed in normal operation.

At most 16 explanations are accepted. Stored metadata are reparsed and associated
again in the same transaction. Result, lesions, explanations, job completion and
existing result/job audit events commit once; failures roll back all database
writes and remove only freshly owned artifact directories. Callers must use the
canonical result writer, not independently commit the lower-level helper.
Completed results cannot receive post-hoc explanation additions, because they no
longer have a running claim. Such a future workflow would need separate design.

Legacy Phase-3 `ExplanationReference` values remain compatible and unchanged.
They are not automatically treated as available artifacts or migrated into the new
table. Multiple explanations are returned by the separate authoritative API.

## Artifact storage and validation

Private location:

```text
OUTPUT_DIR/stenosis-explanations/<result UUID>/<explanation UUID>/<artifact UUID>.nii[.gz]
```

The trusted worker provides the path internally. No HTTP writer, path parameter,
public static mount, overwrite behavior or artifact generation exists. Keep the
output directory private to the application account; new directories inherit its
existing permissions. Source files are never modified or deleted.

Supported formats: single-file NIfTI-1/2 `.nii` / `.nii.gz`, **unscaled float32**,
bounded full source grid, explicit mm units and coded nonsingular affine. Geometry
and fingerprint must match the source result. The generic bounded header/gzip
validator is reused; the binary candidate-region validator is not used for XAI.
Slope/intercept must resolve to identity. No hidden intensity scaling is applied.
Finite values must lie within the declared range, allowing float32 roundoff of
`1e-6 * max(1, abs(lower), abs(upper))`; non-negative values must remain ≥0.

Limits: **256 MiB file/transfer, 384 MiB expanded, 67,108,864 voxels**. The copied
file's actual bytes and gzip expansion are bounded, not just its header/ISIZE.
The shared `snapshot_source()` now accepts an optional tighter `max_bytes` cap;
existing CT/region callers keep their previous defaults. Attribution callers use
the tighter cap on the opened descriptor and copy loop, covering file replacement
after an initial stat. The existing private snapshot verifies exact SHA-256 bytes
without reopening the served path and is Windows-compatible.

Reads return a private checksum-verified snapshot, recheck source freshness, and
close the snapshot on error/disconnect. Missing file and checksum failure are
distinct errors. Original files are not resaved for rendering. A process crash
before commit may leave an unreferenced UUID directory; orphan reconciliation
remains future operational work and must never remove source data.

## Protected APIs and states

Prefix: `/api/v1/cases/{case_id}/stenosis/analyses/{analysis_id}`.

| Route | Behavior |
| --- | --- |
| GET `/explanations` | Versioned `ExplanationList`; completed/fresh result required; validates each record against result/source/lesion; bounded 16-item list |
| GET `/explanations/{explanation_id}/artifact` | Exact original protected artifact bytes, safe `model_attribution.nii[.gz]` filename, gzip/octet-stream content type, no-store/nosniff |

Existing JWT/database-account validation and CASE_READERS policy apply unchanged.
Cross-case/job/explanation associations return 404; malformed UUIDs use 422;
authentication/revocation/inactive-account behavior remains 401/403 as before.
Successful reads are audited. No private paths or claim tokens are exposed.
POST explanation-list endpoints are absent (405).

Incomplete/failed analyses return structured 409 rather than an empty success.
Missing/corrupt completed results remain Phase-3 integrity errors. A completed
result without explanation records returns `status=not_generated`, an explicit
reason and an empty list; this is not evidence about feature importance. Existing
records give `available` or `unsupported_geometry`. Availability describes a
recorded artifact; actual file integrity is verified on protected download and
again by the browser before rendering, not by repeatedly reading every map on a
metadata request. Missing bytes use `artifact_unavailable` (404), checksum failure
uses `artifact_integrity_failure` (409), and changed source uses `source_changed`
(409). No failure is replaced with a zero heatmap.

## React / NiiVue visualization

The existing completed-result workspace adds an attribution metadata panel. It
uses the existing shared authenticated Axios/session client. Method selection shows
method/version, target, model/version, scope, source/prediction/artifact fingerprints,
value semantics, normalization, baseline and limitations. Result-wide explanations
remain selectable; lesion-specific ones are restricted to the selected lesion.
There is no direct comparison or aggregate interpretation of different methods.

Only a selected, explicitly enabled artifact is downloaded. Controls provide
show/hide, opacity (default 35%), reset-to-hidden/default-opacity and clear selection.
Hidden maps are retained as at most one bounded layer for inexpensive toggling;
changing the explanation/lesion clears an incompatible old layer. A decoded map
is hash/geometry/value checked in the existing worker and passed to NiiVue without
altering values. Abort/termination and per-request ownership prevent late old
responses from replacing a newer selection. Unmount removes the layer and the
existing viewer handles context teardown.

Installed **NiiVue 0.69.0** public interfaces were inspected in installed types and
source: `NVImage.new`, `setAffine`, `addColormap`, `addVolume`, `removeVolume`,
`setOpacity`, and NVImage `colormap`, `colormapNegative`, `cal_min`, `cal_max`,
`cal_minNeg`, `cal_maxNeg`, `colormapType`, `colorbarVisible`, `opacity`.
Phase 4 adds no new dependency on internal NiiVue APIs. Phase-3 point projection
continues using its already isolated and tested internal adapter.

Signed values use blue for negative, transparent zero and orange for positive;
non-negative values use transparent declared minimum to orange maximum.
The original numeric scale remains explicit. The legend positions zero according
to the actual signed bounds (not necessarily at the midpoint) and matches the
fixed color lookup tables. This is deterministic display color mapping, not an
array-normalization or confidence operation. The layer is visually separate from
magenta artery labels, green candidate regions and cyan/yellow point markers.

Full-grid volume/lesion/target maps follow existing anatomical slice controls.
For slice maps, the original array axis is mapped through the verified affine to
the corresponding RAS anatomical plane. **Only that single-plane view shows the
map**; multiplanar and unrelated planes hide it with an explicit reason. Navigate
to explanation slice sets the correct anatomical view/world coordinate. No manual
reslicing or projection onto unrelated planes occurs. All attribution is hidden
in the existing artery-mask 3D view; Phase 4 is 2D-overlay infrastructure.

All original CT/segmentation/lesion controls remain available. Unsupported
geometry, mismatched source, invalid values/checksum or network failure shows a
reason and retains the existing CT. No CT reload or decoder restart is caused by
explanation selection, opacity, visibility or slice navigation.

The extra continuous layer has a conservative total working-set estimate of
**48 bytes/voxel**, covering the original pair, optional region and XAI decode/GPU
space, within the existing 768/1536 MiB device-memory budgets. Large case-851-sized
volumes can therefore be rejected for this added layer even when the base viewer
alone fits. Use original protected artifacts in a desktop tool; no downsampling
is silently substituted. This estimate cannot guarantee available GPU/RAM.

Labels, numeric outputs, keyboard controls, text sign/scale descriptions and mobile
layout accompany the color legend. Every view remains explicitly research-only;
method-specific notes describe limitations, never diagnostic certainty.

## Verification

All maps/findings/targets used in tests are clearly labelled synthetic fixtures,
never saved to application/dev history. Tests use disposable PostgreSQL and temp
artifacts; no real DB migration, model inference or training occurs. See
[Phase-4 verification](stenosis-phase4-verification.md) for exact commands, results,
resolved failures, limitations and the complete file/status inventory.
