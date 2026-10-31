# Milestone 3, Phase 4 — implementation and verification

Date: 2026-10-31. Repository: `F:/Documents/artery_demo`.
This is implementation evidence, not a clinical or genuine-model XAI report.

## A. Implementation summary

Implemented versioned supplied-attribution contracts, immutable SQL metadata,
trusted result-transaction persistence, protected metadata/artifact retrieval,
continuous float32 validation and research-only CT overlays in the existing
React/FastAPI/PostgreSQL/NIfTI/NiiVue application. Multiple method/target artifacts
and result/lesion/slice scopes are supported with explicit value semantics.
No attribution computation or fake provider was added. Normal runtime remains
`None`; stenosis/explainability generation and capability permissions are unchanged.

Technical contract: [stenosis-explanations-v1.md](stenosis-explanations-v1.md).

## B. Actual model compatibility assessment

Inspected the existing SmallUNet3D implementation, strict checkpoint loader,
preprocessing, sliding-window inference, runtime interfaces and research Python
sources. The model returns segmentation logits; inference uses
`torch.inference_mode()` and exposes neither activations/gradients nor a genuine
stenosis prediction target. No separate stenosis/advanced model implementation was
found in these sources. No model/checkpoint/train/inference source was changed.

The available local step-700 handoff checkpoint is 1,095,859 bytes, SHA-256
`e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254` at:

```text
F:/Documents/artery_demo/model/vascuai_model_handoff_for_codex_20261016/vascuai_model_handoff_recovered/model/artery_unet_10case_weighted_step700.pt
```

Its hash was checked without deserializing or running it. It is a segmentation
checkpoint, not a verified stenosis/XAI model. A byte hash does not resolve the
historical optimizer/history/step discrepancy. Root `.venv` package metadata
reports PyTorch 2.14.1+cpu. The global Python used for web tests and backend `.venv`
have no PyTorch package metadata. These were read-only metadata probes, not tests
of runtime/gradient compatibility. No dependency was installed.

Future feature-layer attribution or input gradients require a real target record,
scalar objective, feature layer/baseline, differentiable path, checkpoint identity
and reviewed full-volume/tile-aggregation geometry semantics. In-place activation
hook behavior needs verification. No Grad-CAM, Integrated Gradients or Captum
generator is claimed. Adding a library would not supply a valid stenosis target.

## C. Database and persistence

Added `StenosisExplanationArtifact` and migration `0008_stenosis_explanations`
after `0007_stenosis_results`. Explanation UUID is primary; artifact UUID is unique.
Restricted result/job FKs and optional composite result/lesion FK prevent
cross-result binding. Typed metadata JSON contains no raw arrays. Source/grid
identity is inherited from the immutable result. A result/ID index supports reads.

PostgreSQL triggers prohibit updates/deletes and insertions outside a matching
running result transaction. Phase-3 immutable tables are not relaxed.
`SuppliedExplanation` and `persist_explanation_artifact()` join the canonical
result writer via its optional keyword-only `explanations` argument. Worker claim,
lease, source, geometry, model/checkpoint, method and optional lesion are checked.
A matching future runtime provider must verify the genuine target prediction
identity/digest. No public upload/register/generator route exists.

Result/lesion/explanation persistence and job completion commit once. Failures
roll back all rows and remove only freshly owned artifact copies. Existing source
and historical files remain untouched. Artifacts use private UUID directories under
`OUTPUT_DIR/stenosis-explanations`; original bytes are preserved. Post-hoc additions
to completed jobs are intentionally prohibited.

Disposable PostgreSQL verified upgrade/model agreement and downgrade/re-upgrade.
**Downgrade deletes explanation history**, retaining cases, segmentations, jobs,
results, lesions and files; re-upgrade cannot restore lost explanation metadata.
No application DB migration occurred. The task-owned test container was removed.

## D. Backend APIs

Prefix: `/api/v1/cases/{case_id}/stenosis/analyses/{analysis_id}`.

| Method / suffix | Contract and behavior |
| --- | --- |
| GET `/explanations` | Versioned `ExplanationList`, max 16 typed items, result/source/lesion checks, `available`, `not_generated` or `unsupported_geometry` |
| GET `/explanations/{explanation_id}/artifact` | Exact checksum-verified snapshot bytes; safe `model_attribution.nii[.gz]` filename; gzip/octet-stream; no-store/nosniff |

Existing JWT/account validation and all four CASE_READERS roles are reused.
Tests cover unauthenticated, revoked and inactive sessions and cross-case IDs.
Unknown case/analysis/explanation association gives 404; existing 401/403 policy
and UUID 422 handling remain. There is no public writer (POST returns 405).
Incomplete/failed analyses and corrupt/missing completed results do not become
empty success. Stale source is 409 `source_changed`; missing bytes are 404
`artifact_unavailable`; changed bytes are 409 `artifact_integrity_failure`.
Metadata availability describes a record; actual content is verified on download.
Successful metadata/artifact reads are audited and no-store. No storage paths or
worker tokens are returned. Absence is not a zero attribution or feature finding.

## E. Attribution data validation

- Full original 3D NIfTI source grid, coded affine, explicit mm units and finite
  geometry; exact source/grid fingerprints and result association.
- Unscaled float32 only; slope/intercept must resolve to identity. Binary region
  validators are not used for attribution maps.
- Finite signed/non-negative values within declared increasing bounds; float32
  boundary tolerance is `1e-6 * max(1, abs(lower), abs(upper))`. Non-negative maps
  reject negative values even within tolerance.
- Provider normalization must be explicit. Original artifact bytes are never
  normalized, resampled, downsampled, reoriented or resaved by this integration.
- Limits: 256 MiB file/transfer; 384 MiB expanded; 67,108,864 voxels. Header,
  payload and gzip expansion are bounded. The shared private snapshot accepts an
  optional tighter cap, enforced on the opened descriptor and copy loop; CT/
  region callers retain their previous defaults.
- Slice maps declare an original-array axis/index; every off-plane voxel is zero.
  Other scopes require the same full source-grid representation.
- Browser verifies the content hash again before decoding, then validates actual
  float values and NIfTI/source geometry before sending data to NiiVue.

## F. Frontend and viewer

The existing completed-result workspace now includes a method/target/model/scope
panel, provider limitations, baseline/normalization and source/prediction/artifact
fingerprints. Result-wide and selected-lesion explanations are filtered correctly;
legacy Phase-3 references are not silently promoted into trusted artifacts.
No generated/unavailable/error state is substituted with a heatmap.

The existing NiiVue 0.69 viewer is extended using inspected public methods and
properties; no new internal NiiVue API is introduced. Signed values use negative
blue / transparent zero / positive orange. Non-negative maps use transparent
minimum / orange maximum. The legend places zero according to actual bounds,
including asymmetric signed ranges. Original values remain unchanged; display
color mapping uses the declared scale without auto-ranging.

Controls include opt-in visibility, 35% default opacity, reset-to-hidden/default
opacity, method selection and clear selection. Volume/lesion/target overlays follow
existing anatomical slices. Slice-scoped maps are visible only on their declared
single anatomical plane; Navigate to explanation slice uses the verified affine
and world coordinates, including flipped/permuted grids. Attribution is hidden in
the existing artery-mask-only 3D view.

One additional map is loaded at a time; selection does not redownload CT/mask.
Visibility/opacity changes reuse the loaded map. Requests/workers cancel on change
or unmount; stale responses cannot restore an old layer. Invalid artifacts retain
the CT and show a reason. Text legends and keyboard/mobile controls accompany color.

The conservative extra-layer budget is 48 bytes/voxel inside existing 768/1536 MiB
device-memory budgets, accounting for the pair, optional region, float map and
decode/GPU space. A full case-851-sized overlay can exceed it and require a desktop
tool even when the base viewer fits. No silent downsampling or unbounded caching.

## G. Exact tests and results

Environment: Windows, Python 3.14.7, pytest 9.1.1, FastAPI 0.143.0,
SQLAlchemy 2.1.4, Alembic 1.20.0, nibabel 5.4.2, Node 24.13.0, Vite 8.3.4,
NiiVue 0.69.0, installed Google Chrome 156.0.8078.76 and software WebGL.
PostgreSQL: 18.6 (cached `postgres:18`). No dependencies/lockfiles changed.

Disposable container: `vascuai-phase4-tests-f2833d58e6`, labelled
`vascuai.task=phase4-tests`, bound only to localhost port 52686, fresh data, no
workspace bind mounts. Existing conftest created/dropped a unique test schema and
temp uploads/outputs. The container and its anonymous volume were removed after
verification. Application DB credentials/configuration were never used.

Backend command from `F:/Documents/artery_demo/backend`:

```powershell
@'
import os,pytest
os.environ.update(TEST_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:52686/vascuai_phase4_test',PYTEST_DISABLE_PLUGIN_AUTOLOAD='1',PYTHONDONTWRITEBYTECODE='1')
raise SystemExit(pytest.main(['-q','-p','no:cacheprovider','--capture=sys','--ignore=tests/test_segmentation_inference.py','--deselect=tests/test_segmentation_api.py::test_original_checkpoint_through_upload_api','--deselect=tests/test_segmentation_api.py::test_missing_checkpoint_and_4d_input_through_api']))
'@ | python -B -
```

Final result: **496 passed, 2 skipped, 2 deselected, zero failures**, 228.17s.
The skipped tests require Windows symlink privileges. The neural-inference module
and two inference-related API cases were deliberately excluded; no ML execution
occurred. Three pre-existing deprecation warnings: TestClient/httpx and two HTTP-413
aliases. Auth, roles, cases/patients, ingestion, source snapshots, stored downloads,
Phases 1–3 and new explanation regressions passed.

Focused/affected backend commands used the same wrapper/environment, replacing
the `pytest.main` argument list with:

```python
# Earlier focused run, before three final snapshot regressions were added:
['-q','-p','no:cacheprovider','--capture=sys','tests/test_stenosis_explanations.py','--maxfail=2']
# Final affected suites after the optional snapshot cap was implemented:
['-q','-p','no:cacheprovider','--capture=sys','tests/test_stenosis_explanations.py','tests/test_stenosis_results.py','tests/test_stenosis_jobs.py','tests/test_stenosis_contract.py','tests/test_segmentation_api.py','--deselect=tests/test_segmentation_api.py::test_original_checkpoint_through_upload_api','--deselect=tests/test_segmentation_api.py::test_missing_checkpoint_and_4d_input_through_api']
```

Results respectively: **51 passed**, 29.81s; **255 passed, 2 skipped, 2 deselected**,
201.61s. Both have zero failures and one existing TestClient warning. There are
54 new explanation tests in the final targeted/full runs. **Counts overlap and
must not be added together.** An earlier full run before those three additions
passed 493 tests; the final 496 result supersedes it.

Frontend commands from `F:/Documents/artery_demo/frontend-react`:

```powershell
node --test tests/explanations.test.js
npm test
npm run lint
npm run build -- --outDir C:/Users/vimzz/AppData/Local/Temp/vascuai-phase4-verification-dyfo5ha4/build-reviewed
```

Initial focused unit result: **34 passed**. After adding the asymmetric-scale
regression, final `npm test`: **202 passed**, zero failures/skips, including 35 new
XAI cases. Lint exits 0 with only the pre-existing AuthContext Fast Refresh
`only-export-components` warning. Final production build exits 0, 3.33s; existing
large codec/NiiVue chunk warnings and the expected external-output warning remain.
Build outputs are external; no existing dist directory was overwritten.

Browser commands from
`C:/Users/vimzz/AppData/Local/Temp/vascuai-phase4-verification-dyfo5ha4`:

```powershell
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase4-verification-dyfo5ha4/playwright.config.cjs explanations.spec.js
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase4-verification-dyfo5ha4/playwright.config.cjs explanations.spec.js stenosis.spec.js stenosis-jobs.spec.js stenosis-results.spec.js segmentation.spec.js workspace.spec.js volume-viewer.spec.js
```

Focused result after correction: **13 passed**, zero failures/skips, 32.9s.
Final full selected result: **102 passed**, zero failures/skips, 2.7m. The latter
includes those 13 cases; do not combine counts. Config starts fresh Vite on
`http://127.0.0.1:5190` (strict port, no server reuse), two workers, 60s timeout,
1440×1000 default viewport, reduced motion, installed Chrome and
`--enable-unsafe-swiftshader`. Mobile cases use 390×844 and axe checks.
Browser APIs are intercepted synthetic fixtures; actual React/NiiVue/worker/
WebGL rendering is tested, not live clinical or production-backend behavior.

Resolved failures are retained here for transparency:

1. Initial backend run: 18 passed/2 failed before stopping. Rollback assertions
   mistakenly counted files from prior successful tests in shared temporary
   storage. Assertions were scoped to the failed explanation's UUID; no cleanup
   implementation was weakened or broadened to delete unrelated files.
2. Initial browser suite: 12 passed/1 failed; focused reproduction also failed.
   Exact canvas-image equality was obscured by the sticky topbar after scrolling.
   Captured images confirmed the occlusion. Screenshot-only styles hide that
   chrome during comparisons; the exact original/hidden pixel equality remains.
3. Earlier broad browser run: 100 passed/2 failed. Existing Phase-3 assertions
   prohibited the literal phrase “clinical confidence,” including its appearance
   in the new disclaimer. The new warning was changed to “calibrated confidence
   estimate”; the existing assertions were preserved. Final 102 passed.

Config/results/screenshots and build outputs are under the external directory
above. The signed mobile fixture screenshot was visually inspected. No genuine
attribution generation, real-data overlay, neural inference tests, training,
live frontend/backend clinical workflow, spike/real-volume viewer suite,
production deployment or application DB behavior was verified.

## H. Security and safety

Private UUID-owned files, exact content hashes, source/result/lesion association,
existing account/role enforcement, no-store/nosniff, safe filenames and audited
reads are preserved. The server serves verified private snapshots, so later path
replacement cannot alter returned bytes; source replacement during snapshot
retrieval is rejected. Focused tests exercise both situations and tight descriptor
size caps. No public file mount, writer, generator or arbitrary-path input exists.
No original artifact is normalized or overwritten. Model attribution remains
research-only, with method/target/value/normalization limitations clearly visible.

## I. Remaining limitations

- Genuine stenosis model/target prediction and reviewed attribution generator/
  verifier remain absent. Metadata method names are not implementations.
- Future target verification must resolve actual model outputs; this phase cannot
  establish genuine target semantics independently of a real trusted provider.
- No actual Grad-CAM, IG, saliency, severity or calibration result was produced.
- Only source-grid 3D unscaled float32 NIfTI is accepted. Slice maps use a full-grid
  zero-off-plane representation, not arbitrary 2D images/crops.
- Overlays are 2D only; oblique/sheared/non-mm source protections remain. Large
  volumes may require desktop tools under the conservative extra-layer budget.
- A process crash before DB commit may leave unreferenced private directories;
  operational orphan reconciliation remains future work.
- No post-completion explanation append workflow; no comparability claim between
  methods, clinical validation or model-selection conclusion.
- Deployment/migration scheduling, real-provider integration, real-data review and
  production hardware/load checks require separate approval/work.

## J. Phase 4 assessment

**COMPLETE for infrastructure and visualization readiness only.** Genuine
model-generated explanations remain pending and unavailable in normal operation.
This is not full operational or clinically validated XAI. Phase 5 was not begun.

## K. Repository integrity

Original/final branch: `main`. Original/final HEAD:
`d164d158729e15323b35b2faf1b3977ecf54ce2a`.
No stage, commit, push, merge, branch switch, reset, clean, deploy, package install,
real-DB migration, training or inference occurred. Source volumes/checkpoint,
Saish's PR, research data, `.vscode/`, existing handoffs and previous phase reports
were preserved. Protected checkpoint hash remains the expected value.

Starting SHA-256/size inventory: 236 tracked/nonignored files, excluding private
`.env` values. Final comparison: **15 intended existing files extended, 221
byte-identical, none deleted; 15 new Phase-4 files**. Prior phase behavior and tests
remain intact; the Phase-3 browser fixture gains only the required explicit empty
explanation API response. Existing safety assertions are unchanged.

### New Phase-4 files (15)

Paths relative to `F:/Documents/artery_demo`:

```text
backend/app/models/stenosis_explanation.py
backend/app/routers/stenosis_explanations.py
backend/app/schemas/stenosis_explanations.py
backend/app/services/stenosis_explanations.py
backend/migrations/versions/0008_stenosis_explanations.py
backend/tests/test_stenosis_explanations.py
docs/stenosis-explanations-v1.md
docs/stenosis-phase4-verification.md
frontend-react/src/api/stenosis-explanations-contract.js
frontend-react/src/components/ExplanationPanel.jsx
frontend-react/src/hooks/useExplanationLayer.js
frontend-react/src/lib/attribution.js
frontend-react/tests/e2e/explanations.spec.js
frontend-react/tests/explanation-fixtures.js
frontend-react/tests/explanations.test.js
```

### Existing files extended in Phase 4 (15)

```text
backend/app/main.py                         # explanation router registration
backend/app/models/__init__.py              # explanation model registration
backend/app/routers/segmentation.py          # optional tighter private-snapshot cap; defaults unchanged
backend/app/services/stenosis_results.py     # explanation writes join atomic completion
backend/app/services/stenosis_runtime.py     # unregistered future provider protocol/default empty tuple
docs/stenosis-results-v1.md                  # additive link to Phase-4 contract
frontend-react/package.json                 # add unit-test entry only
frontend-react/src/api/stenosis.js           # compose shared authenticated adapter
frontend-react/src/components/StenosisResults.jsx # explanation panel and selected artifact
frontend-react/src/components/SegmentationViewer.jsx # optional attribution controls/layer
frontend-react/src/index.css                # narrow attribution layout/legend styles
frontend-react/src/lib/niivue-adapter.js     # continuous scalar overlay
frontend-react/src/lib/volume-loader.js      # cancellable worker wrapper
frontend-react/src/workers/volume.worker.js  # independent attribution validation branch
frontend-react/tests/e2e/stenosis-results.spec.js # explicit no-explanation response fixture only
```

The complete tracked diff and newly created source/document files were inspected.
`git diff --check`, no-index whitespace checks for new files, index/HEAD and
baseline preservation checks pass. Full worktree status below includes all prior
local phase work and protected untracked directories; it is not a Phase-4-only list.

```text
 M backend/app/main.py
 M backend/app/models/__init__.py
 M backend/app/routers/segmentation.py
 M frontend-react/package.json
 M frontend-react/src/App.jsx
 M frontend-react/src/components/SegmentationViewer.jsx
 M frontend-react/src/index.css
 M frontend-react/src/lib/niivue-adapter.js
 M frontend-react/src/lib/volume-loader.js
 M frontend-react/src/pages/CaseDetail.jsx
 M frontend-react/src/workers/volume.worker.js
 M frontend-react/tests/e2e/fixtures.js
?? .vscode/
?? backend/app/models/stenosis_explanation.py
?? backend/app/models/stenosis_job.py
?? backend/app/models/stenosis_result.py
?? backend/app/routers/stenosis.py
?? backend/app/routers/stenosis_explanations.py
?? backend/app/routers/stenosis_jobs.py
?? backend/app/routers/stenosis_results.py
?? backend/app/schemas/stenosis.py
?? backend/app/schemas/stenosis_explanations.py
?? backend/app/schemas/stenosis_jobs.py
?? backend/app/schemas/stenosis_results.py
?? backend/app/services/stenosis.py
?? backend/app/services/stenosis_explanations.py
?? backend/app/services/stenosis_geometry.py
?? backend/app/services/stenosis_jobs.py
?? backend/app/services/stenosis_results.py
?? backend/app/services/stenosis_runtime.py
?? backend/migrations/versions/0006_stenosis_jobs.py
?? backend/migrations/versions/0007_stenosis_results.py
?? backend/migrations/versions/0008_stenosis_explanations.py
?? backend/tests/test_stenosis_contract.py
?? backend/tests/test_stenosis_explanations.py
?? backend/tests/test_stenosis_jobs.py
?? backend/tests/test_stenosis_results.py
?? docs/baseline-false-positive-audit.md
?? docs/codex-handoff-to-chatgpt.md
?? docs/milestone2-review-readiness.md
?? docs/stenosis-contract-v1.md
?? docs/stenosis-explanations-v1.md
?? docs/stenosis-lifecycle-v1.md
?? docs/stenosis-phase3-verification.md
?? docs/stenosis-phase4-verification.md
?? docs/stenosis-results-v1.md
?? frontend-react/src/api/stenosis-contract.js
?? frontend-react/src/api/stenosis-explanations-contract.js
?? frontend-react/src/api/stenosis-jobs-contract.js
?? frontend-react/src/api/stenosis-results-contract.js
?? frontend-react/src/api/stenosis.js
?? frontend-react/src/components/ExplanationPanel.jsx
?? frontend-react/src/components/StenosisHistory.jsx
?? frontend-react/src/components/StenosisResults.jsx
?? frontend-react/src/hooks/useAnalysisTracker.js
?? frontend-react/src/hooks/useCandidateRegion.js
?? frontend-react/src/hooks/useExplanationLayer.js
?? frontend-react/src/hooks/useLesionLayer.js
?? frontend-react/src/lib/analysis-tracker.js
?? frontend-react/src/lib/attribution.js
?? frontend-react/src/lib/lesion-viewer.js
?? frontend-react/src/lib/stenosis-results.js
?? frontend-react/src/pages/StenosisCapabilities.jsx
?? frontend-react/tests/e2e/explanations.spec.js
?? frontend-react/tests/e2e/stenosis-jobs.spec.js
?? frontend-react/tests/e2e/stenosis-results.spec.js
?? frontend-react/tests/e2e/stenosis.spec.js
?? frontend-react/tests/explanation-fixtures.js
?? frontend-react/tests/explanations.test.js
?? frontend-react/tests/stenosis-jobs-fixtures.js
?? frontend-react/tests/stenosis-jobs.test.js
?? frontend-react/tests/stenosis-results-fixtures.js
?? frontend-react/tests/stenosis-results.test.js
?? frontend-react/tests/stenosis.test.js
?? research/
```
