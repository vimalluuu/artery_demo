# Milestone 3, Phase 3 — implementation and verification

Date: 2026-10-31. Repository: `F:/Documents/artery_demo`.
This records local implementation evidence; it is not a clinical validation report.

## A. Implementation summary

Implemented persistent, immutable results and multiple lesion records, an internal
atomic worker writer, authenticated case/analysis/lesion retrieval, validated
original-IJK/RAS-mm localization, UUID-stable React selection and integration with
the existing NiiVue viewer. Genuine supplied candidate regions can be validated,
protected and shown separately from the artery segmentation. No region, finding,
measurement, severity or explanation is computed or fabricated by this phase.
Normal runtime still returns `None`; stenosis execution remains unavailable.

Technical contract: [stenosis-results-v1.md](stenosis-results-v1.md).

## B. Database model

`StenosisAnalysisResult` stores a UUID, unique job FK, restricted case/segmentation
FKs, contract/status, source/grid hashes, typed provenance JSON, finding count and
timestamp; index `(case_id, created_at)`. `StenosisLesion` has composite primary key
`(result_id, lesion_id)`, restricted result FK and typed lesion JSON. Source and
case are inherited through the result rather than duplicated in lesion JSON.

Migration `0007_stenosis_results` follows `0006_stenosis_jobs`. PostgreSQL triggers
prohibit result/lesion mutation/deletion and reject inserts outside a matching
running-job transaction. Count, state, identity and association checks also apply.
The existing opaque job result-reference interface is preserved; canonical
completion and retrieval enforce matching immutable, retrievable results.

Disposable PostgreSQL verified upgrade/model agreement and downgrade/re-upgrade
while retaining cases, segmentations and jobs. **Downgrade deletes lesion/result
history**, then removes the index/table/functions; files and old jobs remain.
Completed references become unavailable unless restored from backup. No migration
was run on the application database.

## C. Backend APIs

Prefix: `/api/v1/cases/{case_id}/stenosis/analyses/{analysis_id}`.

| Method / suffix | Typed response and behavior |
| --- | --- |
| GET `/result` | `StenosisResultResponse`: source-bound provenance/geometry, all lesions, safe viewer-source metadata and visualization support state |
| GET `/lesions/{lesion_id}` | `StenosisLesionResponse`: one lesion with case/analysis/result association and provenance |
| GET `/lesions/{lesion_id}/regions/{artifact_id}` | Exact checksum-verified supplied NIfTI snapshot, safe filename, no-store/nosniff |

Existing JWT/database-account checks and `CASE_READERS` policy are reused for all
four canonical roles. Tests cover unauthenticated and inactive accounts, case/
lesion/artifact scoping and stale sources. Existing revoked-token/authorization
tests also pass. Missing identities return 404, invalid UUIDs use 422, authentication
uses existing 401/403 behavior. Not-completed, stale and missing/inconsistent
completed results return structured 409 errors, never successful empty findings.
No browser result-write endpoint exists (POST result returns 405).
Successful reads are audited and no-store; paths/tokens are not serialized.

## D. Result-store integration

`persist_completed_result()` is the internal worker boundary. It requires a valid
claim/lease and canonical SQL store; validates case/source/parent/method/checkpoint,
typed payload and actual source geometry; verifies any supplied artifact copies;
then inserts result/lesions and completes the job in **one commit**. Completion
loads/validates persisted rows in that same transaction. Late flush, commit,
source or lease failures cannot commit partial findings. Rollback removes only
new UUID-owned region copies. Source/lease failures can record a safe failed job.

The Phase-2 `complete_job()` interface remains compatible; its optional
`commit=False` is used solely to join canonical persistence and completion.
Its guards cannot commit partial findings in this mode. The runtime is not
registered, no fake dispatcher/provider was added, and there is no public writer.

## E. Coordinates and geometry

Original-array voxel centres: zero-based integer `[i,j,k]`. World: RAS mm through
the verified NIfTI affine. Slice axis/index refer to the original array, whereas
viewer controls refer to anatomical RAS planes. Bounds, finite/nonsingular affine,
coded transform, explicit-mm units, exact source identity and parent association
are checked. Voxel/world comparison uses absolute `1e-4` plus relative `1e-6` to
allow header roundoff, not to establish anatomical registration.

SHA-256 geometry identity includes source SHA bytes, shape, affine and fixed
coordinate/unit/version identifiers; Python/JS share a tested binary encoding.
Actual downloaded CT bytes are separately hashed before rendering. Matching
geometry is not proof of anatomical correctness. Unknown/non-mm source units are
rejected; valid oblique/sheared mm results receive an explicit unsupported-viewer
state. Existing viewer geometry protections are retained.

## F. Frontend implementation

The existing Stenosis history now opens typed persisted results. Multiple findings
use UUID buttons and details; selection survives refresh/reload via URL parameters.
Unknown UUIDs cannot silently select another result's lesion. Measurements show
supplied units/method/definition and retain zero; null values have explicit reasons.
Anatomical labels stay absent when unsupplied. Severity/explanation stay unavailable
unless references/values were supplied; explanation rendering is not integrated.
Mixed measurement methods are identified without deriving a combined conclusion.

Incomplete, failed, unavailable, stale, integrity-error, unsupported-geometry and
genuine completed-empty states are distinct. No empty result proves absence.
The shared Axios/session client and existing case workspace remain in use.

## G. CT viewer integration

The existing NiiVue 0.69.0 viewer is extended. Selection converts validated world
positions using installed `mm2frac(mm, 0, true)` and moves the crosshair. Existing
anatomical sliders can select exact unique lesion locations in reverse.
Coincident locations retain deliberate selection and report ambiguity.

Markers are accessible cyan circles with yellow selected rings, labelled by UUID
and plane; projection is checked by an inverse roundtrip. Points only appear on
their current 2D voxel slices. NiiVue's projection helpers are marked internal,
isolated, source/type-verified and tested in actual WebGL; upgrades must reverify.
3D remains the artery-mask view; choosing a lesion there returns to slices.

Supplied region overlays are opt-in green, checksum/binary/geometry validated,
one at a time and hidden in 3D. Missing regions stay absent. Failure leaves CT
visible. Selection does not redownload CT/mask or restart their decoder. Existing
transfer/decompression limits and resource cleanup remain; an additional region
has a conservative memory budget. Requests/workers cancel on navigation.

## H. Tests and actual results

Environment: Windows; Python 3.14.7; pytest 9.1.1; FastAPI 0.143.0;
SQLAlchemy 2.1.4; Alembic 1.20.0; nibabel 5.4.2; Node 24.13.0;
installed NiiVue 0.69.0; Vite 8.3.4; Google Chrome 156.0.8078.76 with
software WebGL. No dependencies installed or lockfiles changed.

Backend tests used a task-owned PostgreSQL-18 container
`vascuai-phase3-tests-41a6ab994b`, bound only to localhost port 54262, with no
workspace bind mount and fresh data. Existing conftest creates/drops a random
`vascuai_test_*` schema and temp uploads/outputs. The container and its anonymous
volume were removed after verification. Application DB credentials were not used.

Commands below were run from `F:/Documents/artery_demo/backend`. Environment was
set inside the short-lived Python process, never in application configuration.

```powershell
@'
import os,pytest
os.environ.update(TEST_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:54262/vascuai_phase3_test',PYTEST_DISABLE_PLUGIN_AUTOLOAD='1',PYTHONDONTWRITEBYTECODE='1')
raise SystemExit(pytest.main(['-q','-p','no:cacheprovider','--capture=sys','tests/test_stenosis_results.py','tests/test_stenosis_jobs.py','tests/test_stenosis_contract.py','--maxfail=3']))
'@ | python -B -
```

Result: **150 passed**, zero failures/skips, one existing TestClient/httpx
deprecation warning, 25.18s. This includes 37 new Phase-3 cases. The initial
Phase-3-only run had 35 passed/2 failed due to two fixture mistakes: nonexistent
role `Viewer` and failure code `execution_failed`. They were corrected to the
existing `DataScientist` role and `dispatch_failed` code; application role/failure
policy was not changed to accommodate them.

```powershell
@'
import os,pytest
os.environ.update(TEST_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:54262/vascuai_phase3_test',PYTEST_DISABLE_PLUGIN_AUTOLOAD='1',PYTHONDONTWRITEBYTECODE='1')
raise SystemExit(pytest.main(['-q','-p','no:cacheprovider','--capture=sys','--ignore=tests/test_segmentation_inference.py','--deselect=tests/test_segmentation_api.py::test_original_checkpoint_through_upload_api','--deselect=tests/test_segmentation_api.py::test_missing_checkpoint_and_4d_input_through_api']))
'@ | python -B -
```

Result: **442 passed, 2 skipped, 2 deselected**, zero failures, 76.99s.
Skips: Windows symlink creation unavailable, two existing segmentation tests.
Three existing deprecation warnings: TestClient/httpx plus two HTTP-413 aliases.
Neural-inference module and two inference-related API cases were deliberately
excluded to avoid running models. Training, real inference and production DB/
deployment behavior were not verified. Existing backend auth, roles, patients,
cases, uploads, segmentation storage/downloads and Phase-1/2 regressions passed.

Frontend commands from `F:/Documents/artery_demo/frontend-react`:

```powershell
npm test
npm run lint
npm run build -- --outDir C:/Users/vimzz/AppData/Local/Temp/vascuai-phase3-verification-xc4h725h/build-final
```

Results: **167 unit tests passed**, zero failures/skips (23 new Phase-3 cases).
Lint exits 0; only pre-existing AuthContext `only-export-components` warning.
Initial hook/test lint warnings were fixed; no new warning remains. Final build
exits 0, 2098 modules, 3.15s; warnings about external output directory and existing
large NiiVue/codec chunks. Build files are outside the repository.

Browser commands from the fresh external directory
`C:/Users/vimzz/AppData/Local/Temp/vascuai-phase3-verification-xc4h725h`:

```powershell
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase3-verification-xc4h725h/playwright.config.cjs stenosis-results.spec.js
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase3-verification-xc4h725h/playwright.config.cjs stenosis.spec.js stenosis-jobs.spec.js stenosis-results.spec.js segmentation.spec.js workspace.spec.js volume-viewer.spec.js
```

Results: new suite **11 passed**, zero failures/skips, 18.9s; full selected
regression **89 passed**, zero failures/skips, 1.6m. Config starts a fresh Vite
server on `http://127.0.0.1:5189` with strict port/no reuse, two workers, 60s test
timeout, 1440×1000 default viewport and installed Chrome with
`--enable-unsafe-swiftshader`. Mobile cases use 390×844 and include axe checks.
Config/results/screenshots live in that external directory. Existing spike and
real-volume viewer suites were not run. Browser APIs are intercepted synthetic
fixtures; these tests verify actual React/NiiVue/worker/WebGL behavior, not a
live frontend-to-production-backend or clinical-data workflow.

## I. Remaining limitations

- No real provider, extraction, detection, localization method, diameter/narrowing
  calculation, severity classification or explainability generation is enabled.
- No clinical validation, fresh ML inference or real lesion datasets were used.
- 2D markers only; oblique/sheared and non-mm sources are not rendered.
- Projection uses verified pinned NiiVue internal helpers, requiring upgrade tests.
- Reference/geometry agreement is not independent anatomical registration.
- Caller-owned private artifact storage and future orphan reconciliation remain
  operational responsibilities; precommit process crashes can leave orphan copies.
- Privileged direct SQL is not a trusted result-writing API. The existing job
  reference stays opaque; missing results fail closed, including after downgrade.
- Real-provider execution, real-data localization review, deployment, migration
  scheduling, worker readiness and production hardware/load testing remain future
  separately reviewed work. No extra dependency or clinical-confidence claim added.

## J. Phase-3 completion assessment

**COMPLETE for the requested infrastructure scope**, verified with synthetic
fixtures and disposable PostgreSQL. Normal execution remains unavailable until a
genuine reviewed provider is integrated. This does not certify stenosis detection,
clinical safety or milestone-wide medical validation. Phase 4 was not begun.

## K. Repository integrity and exact Phase-3 inventory

Original and final branch: `main`. Original and final commit:
`d164d158729e15323b35b2faf1b3977ecf54ce2a`.
No stage, commit, push, merge, switch, reset, clean or deployment occurred.
No training/inference, user-database migration, source-volume/checkpoint change,
teammate PR edit, dependency installation or protected research-file change.

An initial SHA-256/size inventory covered 218 existing tracked/nonignored source
files (excluding private `.env` values). Final comparison: 17 intended existing
files extended, 201 byte-identical, none deleted. All earlier Phase-1/2 work is
preserved. App routes, model registration, test script and history/contract files
were extended narrowly; existing App.jsx, CaseDetail.jsx, e2e/fixtures.js,
Phase-1/2 backend/unit tests, migrations and remaining feature files are unchanged
from the starting worktree. The history browser assertion change is listed below.
`.vscode/`, `research/` and protected pre-existing reports are
byte-identical. Git HEAD alone does not include the earlier local phases.

### New files (18)

Paths are relative to `F:/Documents/artery_demo`:

```text
backend/app/models/stenosis_result.py
backend/app/routers/stenosis_results.py
backend/app/schemas/stenosis_results.py
backend/app/services/stenosis_geometry.py
backend/app/services/stenosis_results.py
backend/migrations/versions/0007_stenosis_results.py
backend/tests/test_stenosis_results.py
docs/stenosis-results-v1.md
docs/stenosis-phase3-verification.md
frontend-react/src/api/stenosis-results-contract.js
frontend-react/src/components/StenosisResults.jsx
frontend-react/src/hooks/useCandidateRegion.js
frontend-react/src/hooks/useLesionLayer.js
frontend-react/src/lib/lesion-viewer.js
frontend-react/src/lib/stenosis-results.js
frontend-react/tests/e2e/stenosis-results.spec.js
frontend-react/tests/stenosis-results-fixtures.js
frontend-react/tests/stenosis-results.test.js
```

### Existing files extended in Phase 3 (17)

```text
backend/app/main.py                         # register protected reader router
backend/app/models/__init__.py              # register two SQL models
backend/app/schemas/stenosis.py              # additive anatomy/region references
backend/app/services/stenosis.py             # truthful unavailable-visualization reason
backend/app/services/stenosis_jobs.py        # completion within caller's transaction
backend/app/services/stenosis_runtime.py     # update store availability docstring only
docs/stenosis-contract-v1.md                 # update exact capability example reason
docs/stenosis-lifecycle-v1.md                # document canonical result-store integration
frontend-react/package.json                 # include focused test, no dependency change
frontend-react/src/api/stenosis.js           # compose protected result adapter
frontend-react/src/components/SegmentationViewer.jsx # optional marker/region integration
frontend-react/src/components/StenosisHistory.jsx    # completed-result presentation
frontend-react/src/index.css                # narrow lesion marker/list styles
frontend-react/src/lib/niivue-adapter.js     # supplied-region NiiVue adapter
frontend-react/src/lib/volume-loader.js      # cancellable region worker wrapper
frontend-react/src/workers/volume.worker.js  # hash/decode/validate supplied regions
frontend-react/tests/e2e/stenosis-jobs.spec.js # truthful history-card copy assertion
```

The full `git status --short` includes the earlier uncommitted phases and protected
untracked directories; it is not a list of Phase-3-only edits. Recorded below.
Final tracked diff and all newly created source/document files were inspected;
`git diff --check` and no-index whitespace checks of new files pass.

```text
 M backend/app/main.py
 M backend/app/models/__init__.py
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
?? backend/app/models/stenosis_job.py
?? backend/app/models/stenosis_result.py
?? backend/app/routers/stenosis.py
?? backend/app/routers/stenosis_jobs.py
?? backend/app/routers/stenosis_results.py
?? backend/app/schemas/stenosis.py
?? backend/app/schemas/stenosis_jobs.py
?? backend/app/schemas/stenosis_results.py
?? backend/app/services/stenosis.py
?? backend/app/services/stenosis_geometry.py
?? backend/app/services/stenosis_jobs.py
?? backend/app/services/stenosis_results.py
?? backend/app/services/stenosis_runtime.py
?? backend/migrations/versions/0006_stenosis_jobs.py
?? backend/migrations/versions/0007_stenosis_results.py
?? backend/tests/test_stenosis_contract.py
?? backend/tests/test_stenosis_jobs.py
?? backend/tests/test_stenosis_results.py
?? docs/baseline-false-positive-audit.md
?? docs/codex-handoff-to-chatgpt.md
?? docs/milestone2-review-readiness.md
?? docs/stenosis-contract-v1.md
?? docs/stenosis-lifecycle-v1.md
?? docs/stenosis-phase3-verification.md
?? docs/stenosis-results-v1.md
?? frontend-react/src/api/stenosis-contract.js
?? frontend-react/src/api/stenosis-jobs-contract.js
?? frontend-react/src/api/stenosis-results-contract.js
?? frontend-react/src/api/stenosis.js
?? frontend-react/src/components/StenosisHistory.jsx
?? frontend-react/src/components/StenosisResults.jsx
?? frontend-react/src/hooks/useAnalysisTracker.js
?? frontend-react/src/hooks/useCandidateRegion.js
?? frontend-react/src/hooks/useLesionLayer.js
?? frontend-react/src/lib/analysis-tracker.js
?? frontend-react/src/lib/lesion-viewer.js
?? frontend-react/src/lib/stenosis-results.js
?? frontend-react/src/pages/StenosisCapabilities.jsx
?? frontend-react/tests/e2e/stenosis-jobs.spec.js
?? frontend-react/tests/e2e/stenosis-results.spec.js
?? frontend-react/tests/e2e/stenosis.spec.js
?? frontend-react/tests/stenosis-jobs-fixtures.js
?? frontend-react/tests/stenosis-jobs.test.js
?? frontend-react/tests/stenosis-results-fixtures.js
?? frontend-react/tests/stenosis-results.test.js
?? frontend-react/tests/stenosis.test.js
?? research/
```
