# Milestone 3, Phase 6 — final integration and acceptance verification

Date: 2026-10-31. Repository: `F:/Documents/artery_demo`.
Scope: Phases 1–5 integration, isolated verification and confirmed defect fixes.
This is not a clinical validation, production deployment or security certification.
Historical phase test counts are not added to the new results below.

## A. Executive summary

**Web infrastructure: ACCEPTED WITH LIMITATIONS.** The existing five phases work
together with real local React/Axios/FastAPI/PostgreSQL wiring and isolated synthetic
data. Four reproduced integration defects were corrected: calendar-boundary
filter overflow, inconsistent report UUID casing, and a partial candidate-region
layer left behind when viewer insertion failed, and rejection of valid optional
method metadata on unavailable measurements. No public contract was replaced.

**Complete Milestone 3 including AI/ML: PARTIALLY COMPLETE.** Normal stenosis runtime
remains `None`, capability permissions remain false, and genuine detection,
measurement/severity and explanation generation remain blocked. Deployment,
clinical validation and real stenosis-provider operation were not established.

Final results: backend **534 passed, 0 failed, 2 skipped, 2 deselected, 3 warnings (172.78 s)**; frontend
unit/contracts **223 passed**; final selected browser regression
**121 passed, 0 failed (2.2 min)**; real local browser integration **2 passed**. Build/lint
pass with documented warnings. These are different/overlapping suites, not one
invented test total. Detailed boundaries and commands follow.

## B. Architecture verification

Retained React 19, shared authenticated Axios, FastAPI, SQLAlchemy, PostgreSQL,
Alembic, JWT and NiiVue 0.69.0. No dependency, framework, broker, database or model
was added. Source code, not earlier success claims, was the primary review evidence.

| Layer | Connection / reviewed evidence |
| --- | --- |
| Capability management | `backend/app/services/stenosis.py`, schema/router and `StenosisCapabilities.jsx`; version 1.0, separate from artery segmentation. |
| Lifecycle | `stenosis_jobs.py`, `stenosis_job.py`, existing status tracker/history: durable jobs, idempotency, protected claims/leases, source and parent binding. |
| Trusted results | `stenosis_results.py`, result/lesion schemas/models: canonical atomic writer and immutable SQL store, no public result writer. |
| Localization/viewer | Original IJK → RAS-mm affine validation, source/grid fingerprints, result adapter, `StenosisResults`, existing NiiVue viewer and lesion hooks. |
| Explanations | Typed submission/metadata, trusted result-transaction persistence, private snapshots, `ExplanationPanel`/hook/worker and continuous float overlay. |
| Analytics/reports | SQL operational aggregates, bounded freshness observations, typed reports/CSV; dashboard, history, case report, existing export helper and print CSS. |
| Authentication | Existing database-authoritative account/role/token-version dependencies; case-reader and clinical-writer policy unchanged. |

Read all stenosis models/schemas/routers/services, source fingerprint and NIfTI/
geometry/snapshot code, authentication dependencies/audit writer, all migrations,
frontend routes/workspaces/adapters/trackers/hooks/worker/viewer/report components,
and the active contract/lifecycle/results/explanations/reporting documents and
earlier verification evidence. Reviewed the whole tracked diff and start inventory
to distinguish earlier local work from this phase's changes.

## C. End-to-end workflow results

All findings/volumes/maps below are explicitly synthetic fixtures, confined to
temporary storage and disposable PostgreSQL. No neural inference occurred.

| Stage | Status | New evidence / boundary |
| --- | --- | --- |
| Login, case/patient access | Pass under existing policy | Real browser login and protected Axios; full auth/workspace regression; seven-case cross-phase authorization matrix. Broad reader catalog access is existing policy, not tenant/owner isolation. |
| NIfTI upload / saved segmentation | Pass for interfaces; inference not tested | Acceptance fixture posts a valid synthetic 10×20×30 NIfTI through the real ingestion API, then attaches an explicitly synthetic saved segmentation fixture. Browser retrieves real protected CT/mask bytes. No segmentation endpoint is executed to generate that fixture. |
| Capability retrieval / unavailable start | Pass | Live React uses normal runtime, disabled Start; direct shared-client valid start gets `capability_unavailable` and inserts no new job. |
| Lifecycle/idempotency/claims/leases | Pass in isolated tests | Existing PostgreSQL transition/replay/expiry/source/concurrency regressions and new trusted fixtures; no production dispatcher. |
| Result persistence | Pass in isolated tests | Canonical trusted writer, multiple/zero lesions, regions/explanations, full rollback/association tests and immutable triggers. Test providers' execute methods raise if called. |
| Result and lesion retrieval | Pass | Real frontend adapters validate Python JSON/grid hashes; live shared Axios also fetches lesion detail. |
| Localization/CT navigation | Pass for supported synthetic geometry | Real WebGL CT/mask, UUID selection, navigation and protected region; flipped/permuted/coincident/invalid geometry covered by unit/mocked browser regressions. No anatomical registration claim. |
| Explanation metadata/artifacts | Pass for infrastructure | Actual protected downloads, worker checksum/value/grid validation, signed/non-negative display, opacity and region/attribution pixel changes in live browser; broader mocks cover cancellation/errors/slice scope. No generator invoked. |
| Dashboard/index/history | Pass for tested cohorts | Independent nine-job SQL/count/report fixture, method versions, excluded-source states; real dashboard/index and case history. |
| Reports/JSON/CSV/print | Pass with print limitation | Real protected JSON/CSV download, zero header-only CSV, cross-case denial, print-media checks; mock print action tested. Native Print/Save-as-PDF dialog and physical printing not exercised. |
| Genuine stenosis/XAI inference | Blocked | No registered provider/generator; SmallUNet3D is segmentation, not stenosis. |
| Production/clinical operation | Not tested / blocked | No deployment, application DB migration, genuine provider workflow, load acceptance or clinical validation. |

## D. Contract consistency

Identifiers and version 1.0 are retained across jobs, results, lesions, explanations,
analytics and reports. Reports embed existing typed job/result/explanation DTOs,
not arbitrary SQL JSON. Source SHA-256, parent UUID, geometry fingerprint, original
array order and RAS-mm units agree between Python and JavaScript in live tests.
Zero-valued measurements remain available; nulls require reasons. Failed/incomplete
or stale findings are withheld, not converted to empty completed results.

Two inconsistencies were reproduced. Reports compared the requested UUID literally
while job/result adapters canonicalized it. Report requests and comparisons now
use lowercase UUIDs; response identity checks remain in place. A unit regression
failed before correction and passes after; browser navigation verifies an uppercase
URL loads the same authorized canonical report.

For unavailable measurements, backend version-1.0 allows independently optional
method ID/version; the frontend incorrectly required a pair and rejected the
whole result. Frontend validation now matches that existing schema, still checks
each supplied identifier, and retains the full pair requirement for available
measurements. Candidate/report views explicitly label missing method details.
Two PostgreSQL/public-report cases, a red-before/green-after unit case and browser
display regression cover this. No breaking schema/API change was made.

Corrected one active documentation overstatement: no patient directory fields are
**exported** in reports. ORM case reads may select case notes internally; claiming
no notes were ever queried was too broad. Existing Phase-3/4/5 verification reports
were preserved unchanged.

## E. Database and migration verification

Actual single-head chain (revision identifiers, not filenames):

```text
base -> 0001_main -> 0002_auth -> 0003_case_meta -> 0004_volume_ingestion
     -> 0005_segmentation_results -> 0006_stenosis_jobs
     -> 0007_stenosis_results -> 0008_stenosis_explanations
```

Destructive autouse fixtures were read before execution. A new owned PostgreSQL
18.6 container, loopback-only random port, no project bind mounts, unique
`vascuai_test_*` schemas and temporary upload/output directories were used. Never
the user's application DB. Fresh upgrades run for each backend case.

Six passing tests whose names contain `migration` were identified in final JUnit:

- `test_migration_matches_models`
- `test_postgres_offline_migration` (offline SQL generation, not a separate DB upgrade)
- `test_populated_migration_chain_and_rollback_preservation` (new)
- `test_migration_roundtrip_preserves_results_lesions_jobs`
- `test_migration_roundtrip_matches_models_and_preserves_parent_data`
- `test_migration_roundtrip_preserves_existing_entities`

Model/migration comparison is empty at head, including FK/unique/index definitions.
Existing tests exercise association constraints and guards; new populated checks
reject UPDATE/DELETE on result/lesion/explanation tables and verify the full chain.
Downgrading to `0007` removes only explanation metadata; existing result/lesion/job
and pre-stenosis rows survive. Re-upgrade restores an empty explanation table.
Downgrading from head to `0005` removes stenosis jobs/results/lesions/explanations;
exact user/patient/case/segmentation row snapshots and CT bytes remain unchanged.
Re-upgrade to head matches metadata with zero stenosis rows.

**Rollback loses history; upgrade cannot reconstruct it.** Private files remain
and may become orphaned. Partial rollback of findings can leave completed job
references unavailable, correctly failing closed. Restore a coherent DB/artifact
backup if history must survive. `0001`–`0004` deliberately refuse downgrade; no
attempt was made to bypass that policy. No migration source changed in Phase 6.

## F. Security assessment

The new seven-case matrix checks anonymous, revoked, inactive and all four reader
roles across 14 protected GET routes, plus patient endpoint/filter gates (112
requests). It covers capabilities/history/status/results/lesions/regions,
explanations/artifacts, summaries/trends/index/case summaries, reports and CSV.
Anonymous/revoked/inactive requests are 401; existing reader access remains allowed;
patient directory-level scopes are 403 for Researcher/DataScientist. Existing token
version/claim and authorization tests remain enabled.

New and existing tests verify cross-case result/report/artifact relationships,
unavailable start without fake jobs, private-path/claim-token exclusion, absent
public writer APIs, atomic rollback, immutable records, safe filenames, content
checksums, bounded corrupt/oversized inputs, no-store/nosniff artifact/export
headers, and typed/allowlisted exports. CSV formulas are neutralized while typed
negative coordinates and zero remain numeric. Error bodies are not downloads.

CT, region and attribution use private checksum-verified snapshots so served bytes
match checked bytes without reopening the original path; existing race tests are
part of regression. This assessment does not extend that guarantee to the legacy
segmentation mask/probability `FileResponse` path, which assumes private immutable
output storage. A privileged storage attacker and privileged DBA are outside the
current trust boundary. Existing stat-based freshness is not tamper-proof.

No formal penetration testing, cross-tenant ACL, security certification or proof of
clinical safety is claimed. Actual filesystem ACLs, TLS and deployment secrets
were not inspected or changed. Only synthetic test credentials were used.

## G. Medical viewer and geometry verification

Installed NiiVue remains 0.69.0. Original coded sform/qform choice, explicit mm
units, affine/spacing agreement, binary-mask checks, source checksum and original
array order are preserved. Lesions use supplied IJK and verified RAS-mm, not array
indices reinterpreted as anatomy. Orthogonal flips/permutations are supported;
oblique/sheared/unknown-unit/invalid-affine data fail with a fallback/reason.

The selected regression covers actual WebGL projection, marker selection,
coincident locations, crosshair/slice navigation, separate green regions, signed
blue/orange and non-negative attribution, visibility/opacity/reset, slice scope,
checksum/source/grid mismatch, non-finite values, transfer/decompression/memory
limits, session change, cancellation and cleanup. Live tests verify real protected
bytes and visible pixel changes, not just metadata labels. Changing selected
lesions/explanations leaves CT/mask downloads at two, avoiding pair reloads.

The insertion-failure regression uses a real synthetic NIfTI decoded by installed
NiiVue plus a deliberately throwing adapter target. It demonstrates that a partial
candidate volume is removed and the original CT/error retained. Context loss can
still prevent library removal; existing parent viewer teardown releases the WebGL
context. Existing idempotent cleanup/throwing-cleanup unit tests remain intact.

Memory estimates remain guards, not guarantees: base pair ~26 bytes/voxel,
additional region ~32 total, attribution ~48 total, device budgets 768/1536 MiB,
67,108,864 viewer voxels, 512 MiB transfer; XAI 256 MiB transfer/384 MiB expanded.
No limits/thresholds were relaxed and no silent resampling/downsampling was added.
Point/region/attribution visualization remains 2D; existing 3D is artery mask only.

## H. Analytics and reporting verification

The new independent fixture constructs **nine jobs** on five cases/two patients:
three eligible completed results, one stale completed result, one cold/unverified
completed result, one missing-result completed job, and queued/running/failed jobs.
Eligible results include two executions on one case, one zero-lesion result and a
second case for the same patient under method version v2.

| Expected metric | Verified value |
| --- | ---: |
| Jobs total / completed / queued / running / failed | 9 / 6 / 1 / 1 / 1 |
| Eligible results / stale / unverified / integrity errors | 3 / 1 / 1 / 1 |
| Eligible unique cases / patients | 2 / 1 |
| Eligible lesions / zero-lesion analyses | 3 / 1 |
| Analyses with lesions / cases with lesions | 2 / 2 |
| Explanation metadata rows / associated eligible analyses | 2 / 1 |
| Base-case history records / completed records | 5 / 2 |
| v2-only jobs / lesions | 1 / 1 |

A real two-lesion report and two explanation references match the persisted result
UUID. Existing tests cover date/status/patient filters, availability denominators,
pagination, source observation changes and failures that never become zero totals.
Real browser tests independently verify their separate two-job/two-lesion/one-zero
fixture through dashboard, history, adapters, reports and exports.

Repeated executions/lesions do not inflate distinct cases/patients. Generic case
Complete is not a stenosis event. Severity distributions and numeric measurement
summaries remain unavailable without approved compatibility/taxonomy; presence
counts are not performance metrics. Explanation counts are metadata availability,
not byte-integrity or correctness claims.

## I. Exact test execution

Environment: Windows, Python 3.14.7, Node 24.13.0, npm 11.6.2, installed Chrome
156.0.8078.76, NiiVue 0.69.0, PostgreSQL 18.6 (cached official postgres:18 image).
No package installation/upgrade. External verification directory:

`C:\Users\vimzz\AppData\Local\Temp\vascuai-phase6-verification-dgd9gash`

### Backend / PostgreSQL integration

Working directory `F:/Documents/artery_demo/backend`. Variables are process-local,
not environment-file edits. The disposable container exposed port 52370 for this
run; a later reproduction must use its own newly created test container/port.

```powershell
@'
import os, pytest
from pathlib import Path
from contextlib import redirect_stdout, redirect_stderr
folder=Path(r'C:\Users\vimzz\AppData\Local\Temp\vascuai-phase6-verification-dgd9gash')
os.environ.update(
    TEST_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:52370/vascuai_phase6_test',
    PYTEST_DISABLE_PLUGIN_AUTOLOAD='1', PYTHONDONTWRITEBYTECODE='1',
    VASCUAI_LIVE_ACCEPTANCE='1',
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe',
    VASCUAI_ACCEPTANCE_OUTPUT=str(folder/'release-live'),
)
with (folder/'backend-acceptance.log').open('w',encoding='utf-8') as log, redirect_stdout(log), redirect_stderr(log):
    code=pytest.main([
        '-q','-p','no:cacheprovider','--capture=sys','--tb=short',
        '--ignore=tests/test_segmentation_inference.py',
        '--deselect=tests/test_segmentation_api.py::test_original_checkpoint_through_upload_api',
        '--deselect=tests/test_segmentation_api.py::test_missing_checkpoint_and_4d_input_through_api',
        '--junitxml='+str(folder/'backend-acceptance.xml'),
    ])
print((folder/'backend-acceptance.log').read_text(encoding='utf-8')[-5000:])
raise SystemExit(code)
'@ | python -B -
```

Final result: **534 passed, 0 failed, 2 skipped, 2 deselected, 3 warnings (172.78 s)**.
Two skips: Windows cannot create symlinks (`test_segmentation_api.py:364,444`).
The ignored inference module and two named deselections deliberately prevent model
execution. No other existing coverage was dropped. Warnings: existing TestClient/
httpx deprecation and two HTTP-413 naming deprecations.

New focused file, same runner/env with the argument list replaced by
`['-q','-p','no:cacheprovider','--capture=sys','--tb=short','tests/test_stenosis_acceptance.py']`:
Intermediate focused result: **13 passed**, one existing warning, 20.61 s.
The final file contains 15 cases, included in the final full suite:
three boundary regressions, one cross-phase count/report test, one populated
migration test, seven security-matrix cases, one real-browser harness test and
two subsequent optional-measurement contract cases.
The six migration-named tests and seven security-matrix tests are subsets, not
additional totals. No exhaustive unique total for all overlapping security checks
is invented.

After the final viewer change, reran only
`tests/test_stenosis_acceptance.py::test_live_react_fastapi_postgres_workflow` with
the same runner/env and output folder `live-reviewed`: **1 passed**, one warning,
17.58 s; its child Playwright run **2 passed (15.0 s)**. The harness binds the normal
FastAPI app on a fresh loopback port, removes the test runtime override before
serving, runs Vite with a temporary proxy configuration and closes its own server.
There is no browser API interception in those two scenarios. The routine backend
test is explicitly opt-in if Node/Chrome are not configured; Phase 6 enabled it.
The final full run also executed that harness on all final source changes:
`release-live/live-browser.log` records **2 passed (17.7 s)**, included through its
single Python harness test, not added to the backend test total.

### Frontend unit/contracts, lint and build

Working directory `F:/Documents/artery_demo/frontend-react`:

```powershell
node --test tests/reporting.test.js
npm test
npm run lint
npm run build -- --outDir C:/Users/vimzz/AppData/Local/Temp/vascuai-phase6-verification-dgd9gash/build-acceptance
```

Focused report contracts **21 passed** (117.4145 ms). Full final unit/contracts
**223 passed, 0 failed/skipped** (508.9343 ms). Lint **exit 0**, existing
`AuthContext.jsx:70` `react(only-export-components)` warning. Build **exit 0**, 2,105
modules, 712 ms; existing >500 kB NiiVue/compression chunk warnings. Outputs remain
external; no repository build tree was emptied/overwritten.

### Selected mocked browser regression

Working directory is the external verification directory so existing screenshot
paths stay outside the repository. Temporary config mirrors the repository's
Playwright settings (two workers, 60 s test timeout, 1440×1000, reduced motion),
adds a 10 s expect timeout, uses installed Chrome/SwiftShader and a fresh strict
port 5192 Vite server (`reuseExistingServer=false`). No repository config changed.

```powershell
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase6-verification-dgd9gash/playwright.config.cjs reporting.spec.js explanations.spec.js stenosis.spec.js stenosis-jobs.spec.js stenosis-results.spec.js segmentation.spec.js workspace.spec.js volume-viewer.spec.js stenosis-acceptance.spec.js
```

Final result: **121 passed, 0 failed (2.2 min)**. These browser flows use API interception
and synthetic volumes; they are distinct from the two real local API browser
checks above. Responsive/axe and actual WebGL tests are included. Native print
dialogs, real-volume spikes, neural inference and deployment were not run.

The new adapter/UUID browser file was also run with a temporary port-5193 config:
before adapter fix **1 passed/1 failed**, after fix **2 passed (3.5 s)**. Report
unit regression before fix **19 passed/1 failed**, after fix **20 passed**.
The optional-measurement unit case then failed (20 passed/1 failed) before its
correction and passed afterward; its browser case is included in the final run.
The initial calendar regressions failed all three before correction, then passed
all three. These development failures are resolved, not omitted from the record.

Final logs: `backend-acceptance.log/xml`, `unit-acceptance.log`, `lint-acceptance.log`,
`build-acceptance.log`, `browser-acceptance.log`, `release-live/live-browser.log`.
Intermediate/focused evidence remains in `acceptance-browser-before.log`,
`acceptance-browser-after.log`, `live-reviewed-pytest.log` and
`live-reviewed/live-browser.log`. External temporary configs and build artifacts
remain available for inspection. No credentials or medical datasets are reported.

## J. Performance and reliability

New nine-job synthetic summary observation: **13 SQL statements, 12 SELECTs,
76.6791 ms** in the earlier full run for one TestClient request under disposable PostgreSQL. This includes
authentication/audit overhead; it is not production throughput or an SLA.
Evidence: `final-live/synthetic-summary-observation.json` in the verification
directory. No clinical-size or concurrency load test was performed.

Analytics uses SQL aggregates plus a bounded root-provenance scan, not per-lesion
object loading or CT decoding. Summary limit 2,000 jobs, history/index limits 100,
lesions 200/result, explanations 16/result remain. History does bounded per-parent
lookups/freshness work; full result/explanation reads and snapshot copies have I/O
cost. Index/count queries still need production-scale profiling. No new cache/count
table or unsafe load test was introduced.

Source observations remain process-local and bounded to 128 paths; cold workers
exclude unverified data. Explicit result/source reads can hash a cold CT. Snapshot
copies consume disk and ordinary gzip volumes download fully; no slice streaming.
Tracker cancellation/coalescing and viewer ownership/cleanup regressions pass,
including partial insertion cleanup. Memory estimates cannot guarantee GPU/RAM
availability, and crash-orphan reconciliation remains operational work.

## K. Defects and fixes

| ID / impact | Reproduction and responsible file | Small correction / verification |
| --- | --- | --- |
| P6-001, medium reliability | Analytics end `0001-01-01` underflows default lookback; end `9999-12-31` overflows next-day bound in analytics/history. `stenosis_reporting.py` schema, `stenosis_analytics.py`, `stenosis_jobs.py`. | Clamp only default lookback at date.min; compare inclusive UTC end-of-day directly. Three red-before/green-after API cases plus full regression. |
| P6-002, low integration | Valid uppercase report UUID fails validator although backend/job/result APIs accept it. `frontend-react/src/api/stenosis-reporting-contract.js`. | Canonicalize UUID in route and response comparison, retaining strict identity checks. Focused unit and browser navigation regression. |
| P6-003, medium resource reliability | `addVolume` attaches region then throws, leaving two volumes instead of retained CT alone. `frontend-react/src/lib/niivue-adapter.js`. | Adapter removes its partially owned region, preserves original error and CT. Actual NiiVue decode with throwing target test red before/green after; live/broad regressions. |
| P6-004, medium contract integration | An unavailable measurement with only method ID or version is valid backend schema-1.0 but rejected by frontend result/report validation. | Preserve independently optional metadata only for unavailable values; check identifier syntax, keep available-value method requirements, explicitly render absent details. PostgreSQL, unit and browser regression; no backend schema change. |
| Documentation correction | Reporting contract said no notes are queried, wider than ORM behavior. | Accurately state patient directory fields are not exported; no permission/payload change. |

Accepted limitations: existing broad case-reader policy, process-local freshness,
bounded cohorts, supported-geometry subset, private-storage trust, metadata-only
artifact counts, browser printing and non-clinical synthetic verification.
Blockers: genuine ML provider, durable production worker, clinical validation and
deployment operations. Shared durable fingerprints, production scale profiling,
legacy segmentation-output snapshot hardening and broader geometry support require
separately considered work; no redesign was applied in this phase.

## L. Deployment readiness

See [operator checklist](milestone3-deployment-checklist.md). Static configuration
and YAML duplicate-key validation pass; local frontend build/live proxy tests pass.
No new environment variables or migration are required by the application fixes.
The browser harness's `VASCUAI_*` variables are test-only, not activation switches.

Actual deployment remains pending: private secrets/storage/permissions, exact
CORS/HTTPS/reverse proxy, reviewed migration from actual schema, tested coherent
backups/restoration, least-privilege DB roles, disk quotas/orphan retention,
monitoring/audit retention, deployment-platform image verification and capacity.
`/health/ready` checks DB connectivity, not schema/provider/worker readiness.
Existing backend image is non-root; study directories are not web static mounts.
Production Linux images/nginx and staging were not rebuilt or exercised here.

## M. Separate acceptance decisions

| Dimension | Decision | Evidence / remaining gate |
| --- | --- | --- |
| Web infrastructure | **ACCEPTED WITH LIMITATIONS** | Five-phase synthetic integration, real local APIs, protected downloads, migration/security/regression/build checks; documented scope/trust/geometry/performance limits. Independent reviewer/product approval remains the user's decision. |
| Complete Milestone 3 including AI/ML | **PARTIALLY COMPLETE** | Infrastructure exists; genuine stenosis/measurement/severity/XAI methods and provider/worker integration remain absent. No inference was used to simulate completion. |
| Operational/clinical readiness | **Not established** | No target deployment, provider readiness, representative real-data acceptance, production load verification or clinical validation. |

No completion percentage, model-performance number or clinical acceptance is
inferred from green software tests.

## N. Remaining AI/ML activation requirements

1. A genuine stenosis model/candidate method with reviewed architecture/checkpoint,
   preprocessing, prediction target semantics and authorized validation evidence.
2. Verifiable original-grid localization and source/parent/grid provenance; supplied
   region generation if used, with measured limitations and unsupported states.
3. Validated diameter/reference-region/narrowing methodology and units; agreed
   compatible severity taxonomy/method/version and evaluation before aggregation.
4. Genuine explanation generation and target verification against exact prediction
   records/model/checkpoint, reviewed feature layer/baseline/gradient semantics.
5. A durable production dispatcher/worker, runtime composition, readiness gates,
   heartbeat/lease recovery, concurrency limits and operational monitoring.
6. Separate authorization for genuine real-data integration/evaluation, deployment,
   clinical validation and any change of capability permissions.

SmallUNet3D remains the existing artery-segmentation model; its checkpoint does not
supply or validate any of these stenosis methods. PR #12 was not changed.

## O. Phase 1–5 preservation

Earlier contracts, capability states, status/claim semantics, source fingerprint
policy, trusted writer, storage layout, result/explanation DTOs, viewer geometry,
units, medical thresholds, reports/export behavior and permissions remain. Changes
are the four narrow corrections above plus tests and active-doc accuracy.

Existing Phase-3/4/5 verification reports, research files, `.vscode/`, handoff,
model architecture/inference/training sources, migration files, dependencies,
checkpoint, datasets and deployment configuration were not modified. Tests use
temporary files and named disposable resources only. Final byte comparison below
is against the start of Phase 6, not HEAD or earlier historical phase baselines.

## P. Repository integrity

Original/final branch: `main`. Original/final HEAD:
`d164d158729e15323b35b2faf1b3977ecf54ce2a`.
The worktree was already dirty with uncommitted Phases 1–5; nothing was staged.
Start inventory: 264 tracked/nonignored files, SHA-256 plus size. `.env` and ignored
artifacts are not included; no environment file was changed or exposed.
Start status/staged/unstaged diffs and inventory were saved in the external
verification directory. Final comparison: 254 baseline files byte-identical; exactly the 10 listed intended modifications and five new files; no deletions or unexpected paths. The checkpoint still matches `e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`. `git diff --check` and checks of all 15 touched files passed; CRLF is recognized as a Windows line ending, and no unrelated file was reformatted.

### New files (5)

- `backend/tests/test_stenosis_acceptance.py`
- `docs/milestone3-deployment-checklist.md`
- `docs/milestone3-phase6-acceptance.md`
- `frontend-react/tests/e2e/stenosis-acceptance.spec.js`
- `frontend-react/tests/e2e/stenosis-live.spec.js`

### Existing files modified during Phase 6 (10)

- `backend/app/schemas/stenosis_reporting.py`
- `backend/app/services/stenosis_analytics.py`
- `backend/app/services/stenosis_jobs.py`
- `docs/stenosis-analytics-reporting-v1.md`
- `frontend-react/src/api/stenosis-reporting-contract.js`
- `frontend-react/src/api/stenosis-results-contract.js`
- `frontend-react/src/components/StenosisResults.jsx`
- `frontend-react/src/lib/niivue-adapter.js`
- `frontend-react/src/pages/StenosisReport.jsx`
- `frontend-react/tests/reporting.test.js`

No deleted files. These lists are relative to the captured Phase-6 baseline;
Git status below also includes the earlier uncommitted phases. No staging occurred.


### Full final `git status --short`

```text
 M backend/app/main.py
 M backend/app/models/__init__.py
 M backend/app/routers/segmentation.py
 M backend/app/services/source_fingerprint.py
 M frontend-react/package.json
 M frontend-react/src/App.jsx
 M frontend-react/src/components/SegmentationViewer.jsx
 M frontend-react/src/index.css
 M frontend-react/src/lib/exports.js
 M frontend-react/src/lib/niivue-adapter.js
 M frontend-react/src/lib/volume-loader.js
 M frontend-react/src/pages/CaseDetail.jsx
 M frontend-react/src/pages/Dashboard.jsx
 M frontend-react/src/pages/Reports.jsx
 M frontend-react/src/workers/volume.worker.js
 M frontend-react/tests/e2e/fixtures.js
?? .vscode/
?? backend/app/models/stenosis_explanation.py
?? backend/app/models/stenosis_job.py
?? backend/app/models/stenosis_result.py
?? backend/app/routers/stenosis.py
?? backend/app/routers/stenosis_explanations.py
?? backend/app/routers/stenosis_jobs.py
?? backend/app/routers/stenosis_reporting.py
?? backend/app/routers/stenosis_results.py
?? backend/app/schemas/stenosis.py
?? backend/app/schemas/stenosis_explanations.py
?? backend/app/schemas/stenosis_jobs.py
?? backend/app/schemas/stenosis_reporting.py
?? backend/app/schemas/stenosis_results.py
?? backend/app/services/stenosis.py
?? backend/app/services/stenosis_analytics.py
?? backend/app/services/stenosis_explanations.py
?? backend/app/services/stenosis_geometry.py
?? backend/app/services/stenosis_jobs.py
?? backend/app/services/stenosis_reporting.py
?? backend/app/services/stenosis_results.py
?? backend/app/services/stenosis_runtime.py
?? backend/migrations/versions/0006_stenosis_jobs.py
?? backend/migrations/versions/0007_stenosis_results.py
?? backend/migrations/versions/0008_stenosis_explanations.py
?? backend/tests/test_stenosis_acceptance.py
?? backend/tests/test_stenosis_contract.py
?? backend/tests/test_stenosis_explanations.py
?? backend/tests/test_stenosis_jobs.py
?? backend/tests/test_stenosis_reporting.py
?? backend/tests/test_stenosis_results.py
?? docs/baseline-false-positive-audit.md
?? docs/codex-handoff-to-chatgpt.md
?? docs/milestone2-review-readiness.md
?? docs/milestone3-deployment-checklist.md
?? docs/milestone3-phase6-acceptance.md
?? docs/stenosis-analytics-reporting-v1.md
?? docs/stenosis-contract-v1.md
?? docs/stenosis-explanations-v1.md
?? docs/stenosis-lifecycle-v1.md
?? docs/stenosis-phase3-verification.md
?? docs/stenosis-phase4-verification.md
?? docs/stenosis-phase5-verification.md
?? docs/stenosis-results-v1.md
?? frontend-react/src/api/stenosis-contract.js
?? frontend-react/src/api/stenosis-explanations-contract.js
?? frontend-react/src/api/stenosis-jobs-contract.js
?? frontend-react/src/api/stenosis-reporting-contract.js
?? frontend-react/src/api/stenosis-results-contract.js
?? frontend-react/src/api/stenosis.js
?? frontend-react/src/components/ExplanationPanel.jsx
?? frontend-react/src/components/StenosisAnalytics.jsx
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
?? frontend-react/src/pages/StenosisReport.jsx
?? frontend-react/tests/e2e/explanations.spec.js
?? frontend-react/tests/e2e/reporting.spec.js
?? frontend-react/tests/e2e/stenosis-acceptance.spec.js
?? frontend-react/tests/e2e/stenosis-jobs.spec.js
?? frontend-react/tests/e2e/stenosis-live.spec.js
?? frontend-react/tests/e2e/stenosis-results.spec.js
?? frontend-react/tests/e2e/stenosis.spec.js
?? frontend-react/tests/explanation-fixtures.js
?? frontend-react/tests/explanations.test.js
?? frontend-react/tests/reporting-fixtures.js
?? frontend-react/tests/reporting.test.js
?? frontend-react/tests/stenosis-jobs-fixtures.js
?? frontend-react/tests/stenosis-jobs.test.js
?? frontend-react/tests/stenosis-results-fixtures.js
?? frontend-react/tests/stenosis-results.test.js
?? frontend-react/tests/stenosis.test.js
?? research/
```

Disposable infrastructure: owned container `vascuai-phase6-tests-dgd9gash`, task
label `phase6-tests`, loopback-only PostgreSQL port 52370, anonymous volume and no
workspace bind mounts; unique schemas and temporary file roots. Live tests use
owned Uvicorn threads/fresh Vite ports and terminate them on completion. Resource
cleanup: the owned container and anonymous PostgreSQL volume were verified and removed after tests; test schemas/storage and live server threads/processes were cleaned by their harnesses. External logs/config/builds are retained for review.

No staging, commit, push, merge, reset/clean, branch switch, dependency install,
neural training/inference, application DB migration, actual dataset/checkpoint
write, public artifact mount, provider activation or staging/deployment change
occurred. Stop at Phase 6; no further feature work was started.
