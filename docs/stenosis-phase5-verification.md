# Milestone 3 Phase 5 — implementation and verification

This report describes the Phase-5 changes relative to the existing, uncommitted
Phases 1–4 work, not just relative to Git HEAD. No genuine stenosis provider is
integrated. Test-only persisted records exercise the infrastructure; they are not
clinical findings or production history.

## A. Implementation summary

Extended the existing dashboard, case stenosis history and reporting workspace
with server-authoritative operational analytics, filtering, current-result
eligibility, structured research reports, JSON/CSV downloads and browser printing.
There is no duplicate backend, new count/report table, migration or dependency.
Generic case workflow completion remains separate from stenosis completion.

## B. Analytics definitions

All filters operate on persisted jobs' creation dates, inclusive UTC. Default:
the latest 30 UTC calendar dates. Maximum: 366 days. Optional exact case, authorized
patient, lifecycle status and method/version filters apply consistently. Summary
cohorts above 2,000 jobs return an error rather than partial totals. Case history
retains its previous all-time default.

| Metric | Counting unit, source and denominator |
| --- | --- |
| Total, queued, running, completed, failed | Unique persisted job IDs in the filtered creation cohort; current status groups sum to total. Completed status alone does not establish current findings. |
| Eligible completed results | Immutable result IDs associated with completed jobs and matching provenance, row counts and observed source version. |
| Stale, unverified, integrity-error exclusions | Completed job IDs that fail the corresponding eligibility check. Eligible results plus these exclusions equal completed jobs. |
| Unique analyzed cases | Distinct case IDs among eligible results; repeated executions and multiple lesions do not inflate this count. |
| Unique patients | Distinct opaque patient IDs across eligible cases. Admin/Clinician only; null with an authorization reason for other reader roles. |
| Lesion records | Actual lesion rows across eligible results. This is not unique anatomical disease burden across repeated executions. |
| Analyses/cases with findings | Eligible result IDs/distinct case IDs containing at least one actual lesion row. |
| Completed zero-finding analyses | Eligible results with exactly zero lesions; neither unavailable execution nor proof of absent disease. |
| Measurement available/unavailable | Presence counts for each supplied diameter/narrowing field, denominator eligible lesion rows. Zero is available; null is unavailable. No averages or derived narrowing. |
| Supplied severity labels | Eligible lesion rows with a supplied category. No agreed taxonomy exists, so a severity distribution remains unavailable. |
| Explanation artifacts/analyses | Recorded metadata rows/distinct associated result IDs, not file-integrity or correctness measurements. |
| Anatomy groups | Supplied vessel-label lesion counts separated by analysis method/version; no guessed labels or method harmonization. |
| Explanation methods | Metadata counts grouped by attribution method/version. |
| Trends | Observed UTC job-creation days split by current lifecycle status, not completion-event throughput, duration or model performance. |

The dedicated [versioned contract](stenosis-analytics-reporting-v1.md) documents
the DTO fields, filters, denominators, cache policy and CSV semantics in detail.

## C. Backend APIs

All new routes are authenticated GETs under `/api/v1`:

| Route | Schema / authorization |
| --- | --- |
| `/stenosis/analytics/summary` | `AnalyticsSummary`; existing case readers. |
| `/stenosis/analytics/trends` | `TrendResponse`; existing case readers. |
| `/stenosis/analytics/analyses` | `AnalysisIndex`; existing case readers, limit/offset. |
| `/cases/{case_id}/stenosis/analytics` | Case-bound `AnalyticsSummary`; existing case readers. |
| `/patients/{patient_id}/stenosis/analytics` | Patient-bound `AnalyticsSummary`; existing clinical writers only. |
| `/cases/{case_id}/stenosis/analyses/{analysis_id}/report` | Typed `StenosisReport`, schema 1.0; existing case readers. |
| `/cases/{case_id}/stenosis/analyses/{analysis_id}/report.csv` | Protected findings CSV for current completed results only. |

Existing case-history responses are unchanged; optional date/status/method/version
filters are additive. Invalid filters return 422, unauthorized patient scopes 403,
mismatched associations 404, an oversized summary cohort 413, and ineligible CSV
409. Revoked/inactive/unauthenticated sessions remain rejected. Query failures are
errors, never successful zero totals. Successful reads/exports are audited with
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on the new routes.

## D. Dashboard

The existing dashboard retains its case workflow cards/chart and gains a stenosis
section: operational cards, accessible status chart, UTC trend table, measurement
presence table, method-separated anatomy/explanation groups, exclusion counts,
definitions and paginated analysis/report links. Filters are submitted together
and retained in URL parameters. Authorized users can filter by patient.

Loading, retryable query errors, no matching jobs, unknown source freshness and
unsupported medical aggregates are distinct. Missing/unsupported severity and
numeric measurement summaries have explicit unavailable notices, not empty medical
charts. New scrollable tables are keyboard accessible. Mobile layout and axe
checks are covered by mocked browser tests.

## E. Analysis history

Reused `StenosisHistory`, existing API adapters and status tracker. Optional UTC
dates, status, method/version and pagination are backend filters. **Apply history
filters** performs one atomic URL update, preserving selected analysis and resetting
offset, so edits do not overwrite earlier fields. Reload/back navigation restores
applied state. Existing polling/refresh and safe failure information remain.
Filtered-empty wording distinguishes no matches from no analysis ever performed.
Links open case workspaces and findings/status research reports.

## F. Reports and exports

Case report routes extend the existing workspace. A landing page without a selected
analysis never generates a findings document. Queued/running/failed/stale/integrity
states provide explicit status-only snapshots with findings withheld. A genuine
completed zero-finding result remains distinct. Completed reports display supplied
lesions, original IJK/RAS-mm localization or reasons, measurement values including
zero, units/method/version/definition/reference region, supplied severity and
explanation metadata references. Unsupported geometry and research limitations
remain visible. No clinical findings are invented.

- **JSON:** authorized, re-fetched, typed schema-1.0 snapshot with explicit nulls,
  reasons, provenance and timestamps. Top-level export fields are allowlisted;
  nested data comes from existing typed backend contracts.
- **CSV:** one actual lesion per row; stable explicit columns; UTF-8 BOM, quoted
  cells and CRLF rows. Nulls are blank with reason columns. Text starting with
  optional whitespace and `=`, `+`, `-` or `@` is neutralized. Typed negative
  coordinates and numeric zero remain numbers. A completed zero-lesion CSV is
  header-only; companion JSON carries analysis-level context. Incomplete/stale
  findings exports are blocked. Error bodies are not saved as reports.
- **HTML/Print:** authorized snapshot is refreshed before `window.print()`;
  print CSS preserves units/warnings/metadata, wraps tables and hides application
  navigation/actions. Browser Save as PDF is supported through the print dialog.
  There is **no server-generated PDF or PDF endpoint**. Native print/PDF dialogs
  and physical output were not exercised; browser print media was tested.

## G. Data integrity and security

SQL aggregates use job/result/case/patient/lesion/artifact identities, not report
views or client totals. Existing idempotent job acceptance and immutable result
relationships remain authoritative. No redundant persistent analytics can drift.

Bounded eligibility checks examine scalar/root provenance plus SQL lesion counts
and UUID consistency without loading every lesion payload. Reports use full
existing typed result/lesion validation. The immutable trusted writer remains the
ingestion boundary; direct privileged database tampering is outside that boundary.

Dashboard freshness uses a stat-only observation of a previously verified SHA-256
for the same device/inode/size/mtime/ctime. It never cold-hashes/decompresses a CT.
Changed observed versions are excluded as stale. A cold/evicted/other-worker
observation is unverified, excluded and shown separately. Explicit source/result/
report retrieval can verify a source; refreshing analytics in that process can
then include it. Cache size is 128 paths and is process-local, not durable/shared.
This is not tamper-proof integrity against a privileged storage attacker or a
promise of lifetime freshness after the snapshot.

Domain reads use a separate short-lived PostgreSQL REPEATABLE READ session for
coherent database counts without rolling back authentication work. Audit writes
use the original session. Existing broad case-reader policy is preserved; no new
tenant or ownership isolation is claimed. Patient filters/counts follow existing
clinical-writer restrictions. Reports use opaque subject IDs already allowed in
case reads; no patient directory names/notes/codes, storage paths, worker claims or
arbitrary private JSON are exported. Protected exports recheck access and source.

## H. Tests and environment

Windows; Python 3.14.7; Node 24.13.0; npm 11.6.2; installed Google Chrome with
SwiftShader for browser WebGL checks. Existing dependencies were reused.
Backend autouse fixtures were read before execution: they destructively recreate
test tables, so they were run **only** against an isolated disposable PostgreSQL
18 container (`vascuai-phase5-tests-7096b3d063`, task label `phase5-tests`), unique
`vascuai_test_*` schemas and temporary upload/output directories. Its PostgreSQL
volume had no workspace bind mount. No application database operations occurred.

Commands below run from the specified working directory. Counts overlap: the full
runs include focused suites and must not be added together.

### Backend (working directory `backend`)

The runner sets these variables **inside the test process before importing pytest
fixtures**; no environment/configuration file was changed:

```powershell
@'
import os, pytest
os.environ.update(
    TEST_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:51059/vascuai_phase5_test',
    PYTEST_DISABLE_PLUGIN_AUTOLOAD='1',
    PYTHONDONTWRITEBYTECODE='1',
)
raise SystemExit(pytest.main([
    '-q', '-p', 'no:cacheprovider', '--capture=sys',
    '--ignore=tests/test_segmentation_inference.py',
    '--deselect=tests/test_segmentation_api.py::test_original_checkpoint_through_upload_api',
    '--deselect=tests/test_segmentation_api.py::test_missing_checkpoint_and_4d_input_through_api',
]))
'@ | python -B -
```

The final execution additionally redirected pytest stdout/stderr to the external
verification log before printing it; this does not change collection/execution.
For focused verification, the same runner used
`['-q','-p','no:cacheprovider','--capture=sys','tests/test_stenosis_reporting.py']`.
Focused result: **23 passed** (6.49 seconds, one existing TestClient warning).
Full final result: **519 passed, 2 skipped, 2 deselected, 3 warnings in 153.85 seconds. The skips are Windows symlink-permission checks (`test_segmentation_api.py:364,444`); warnings are existing TestClient/httpx and HTTP-413 deprecations**.

Coverage includes empty/genuine-zero/populated counts; status vs result; repeated
analyses; distinct cases/patients and patient filters; source changes/cold cache;
missing results; zero-valued measurements; unavailable severity; explanation
metadata; dates/method/version/status/pagination; cohort caps; typed reports/status
withholding; CSV quoting/formulas/negative numbers; role/session/access failures;
and errors that never become fabricated zeros. Basic-count tests prohibit full
result-store loads.

No neural inference/training was executed. The whole ML inference module and two
ML API tests were explicitly excluded/deselected. Remaining test outcomes and skip
reasons are recorded above and in the external final log.

### Frontend (working directory `frontend-react`)

```powershell
node --test tests/reporting.test.js
npm test
npm run lint
npm run build -- --outDir C:/Users/vimzz/AppData/Local/Temp/vascuai-phase5-verification-vg3gkhjp/build-reviewed
```

- Reporting unit/contracts: **19 passed**.
- Full unit/contracts: **221 passed**, 0 failed/skipped (703.8153 ms final run).
- Lint: **exit 0**; existing `AuthContext.jsx:70` fast-refresh
  `react(only-export-components)` warning only.
- Production build: **exit 0**, 2,105 modules; final reviewed build 1.09 seconds.
  Existing large NiiVue/compression chunks retain size warnings. External output
  directory warning is expected; it was not emptied and repository build outputs
  were preserved.

### Browser regression

Used an external configuration derived from the existing Playwright configuration:
same test directory, two workers, 60-second timeout, 1440×1000 viewport and reduced
motion. It uses installed Chrome, explicit SwiftShader, a fresh strict-port Vite
server at `http://127.0.0.1:5191`, no reused application server, and external output
directories. Expect timeout was 10 seconds. Configuration was not written into
the repository. Working directory was the external verification directory, also
keeping existing viewer screenshot outputs outside the repository.

```powershell
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase5-verification-vg3gkhjp/playwright.config.cjs reporting.spec.js
node F:/Documents/artery_demo/frontend-react/node_modules/@playwright/test/cli.js test --config C:/Users/vimzz/AppData/Local/Temp/vascuai-phase5-verification-vg3gkhjp/playwright.config.cjs reporting.spec.js explanations.spec.js stenosis.spec.js stenosis-jobs.spec.js stenosis-results.spec.js segmentation.spec.js workspace.spec.js volume-viewer.spec.js
```

Focused reporting run: **16 passed**. Final broad run: **118 passed (2.2 minutes), exit 0**.
All browser APIs use isolated mocks/synthetic images, not genuine patient history
or live production inference. Backend tests independently exercise actual report
routes, SQL aggregation and CSV generation against disposable PostgreSQL.

Development failures were investigated rather than bypassed: two backend fixtures
assumed insertion order instead of UUID ordering; corrected their assertions.
Initial browser checks exposed a case-endpoint mock mismatch, an ambiguous status
label and keyboard-inaccessible scrollable tables. Those were corrected. An
intermediate broad run passed 117 tests and failed one new history-filter test;
that revealed lost URL updates during multiple edits and led to atomic Apply.
The final broad result above is after the fix. No existing assertion was weakened.

External logs/config/builds are under
`C:\Users\vimzz\AppData\Local\Temp\vascuai-phase5-verification-vg3gkhjp`:
`backend-regression-final.log`, `browser-regression-final.log`, `unit-final.log`,
`playwright.config.cjs`, `browser-results` and `build-reviewed`.

## I. Earlier functionality verification

The backend regression exercises authentication/roles/session revocation, patients,
cases, upload validation, segmentation history/protected artifacts, Phase-1
contracts/capabilities, Phase-2 lifecycle/idempotency/leases and Phase-3/4 result,
lesion, supplied-region and explanation storage/authorization/integrity. The browser
regression covers existing workspace flows, segregation of case metadata exports,
segmentation controls/history/downloads, viewer geometry/cancellation/security,
lesion markers/navigation/regions and explanation metadata/overlays.

These are regression-test observations, not a claim that genuine model inference,
deployment, clinical validity or every manual production workflow was reverified.
Existing Phases 1–4 model/schema/migration/viewer implementation files and their
focused tests remain byte-identical to this phase's baseline except the explicitly
listed additive history/adapter/capability/documentation integration changes.

## J. Remaining limitations

- Genuine stenosis execution, lesions, compatible severity taxonomy and explanations
  remain unavailable until the separate provider integration is supplied/validated.
  Numeric pooled measurement summaries are intentionally unavailable.
- No clinical validation, prediction performance or calibrated confidence claim.
- Freshness observations are bounded/process-local; cold workers can exclude a
  result as unverified. A durable shared freshness registry is future work.
- Explanation counts/reports describe persisted metadata, not artifact-file checks
  or correctness. Existing protected artifact downloads validate actual bytes.
- Existing Phase-2–4 migrations must be separately approved/applied to an actual
  application database; Phase 5 adds none and did not apply them there. Missing
  production tables cause honest errors, not false zero analytics.
- Summary cohorts are bounded; production load/indexing for large histories has
  not been benchmarked. Database snapshots do not freeze a changing filesystem.
- No server PDF, native print/PDF-dialog verification, live provider workflow or
  production/staging deployment was performed.

## K. Completion assessment

**PARTIALLY COMPLETE** at product level. The Phase-5 web/API/reporting infrastructure
and its isolated tests are implemented; end-to-end operation on genuine stenosis
provider outputs remains blocked by the previously absent provider and validation.
Unsupported medical analytics are explicit. No Phase-6 implementation was started.

## L. Repository integrity

Original and final branch: `main`.
Original and final HEAD: `d164d158729e15323b35b2faf1b3977ecf54ce2a`.
The working tree was already dirty with Phases 1–4 and protected research files;
Git status alone cannot attribute all its changes to Phase 5. A start-of-phase
SHA-256/size inventory of 251 tracked/nonignored files (excluding `.env`) is the
comparison baseline for the lists below. No baseline files were deleted.

### Phase-5 files created (13)

- `backend/app/routers/stenosis_reporting.py`
- `backend/app/schemas/stenosis_reporting.py`
- `backend/app/services/stenosis_analytics.py`
- `backend/app/services/stenosis_reporting.py`
- `backend/tests/test_stenosis_reporting.py`
- `docs/stenosis-analytics-reporting-v1.md`
- `docs/stenosis-phase5-verification.md`
- `frontend-react/src/api/stenosis-reporting-contract.js`
- `frontend-react/src/components/StenosisAnalytics.jsx`
- `frontend-react/src/pages/StenosisReport.jsx`
- `frontend-react/tests/e2e/reporting.spec.js`
- `frontend-react/tests/reporting-fixtures.js`
- `frontend-react/tests/reporting.test.js`

### Existing files extended during Phase 5 (20)

Some were already untracked Phase-1–4 files; "extended" is relative to the captured
start-of-phase hashes, not whether Git currently labels them tracked.

- `backend/app/main.py`
- `backend/app/routers/stenosis_jobs.py`
- `backend/app/services/source_fingerprint.py`
- `backend/app/services/stenosis.py`
- `backend/app/services/stenosis_jobs.py`
- `docs/stenosis-contract-v1.md`
- `docs/stenosis-explanations-v1.md`
- `docs/stenosis-lifecycle-v1.md`
- `docs/stenosis-results-v1.md`
- `frontend-react/package.json`
- `frontend-react/src/App.jsx`
- `frontend-react/src/api/stenosis-jobs-contract.js`
- `frontend-react/src/api/stenosis.js`
- `frontend-react/src/components/StenosisHistory.jsx`
- `frontend-react/src/index.css`
- `frontend-react/src/lib/exports.js`
- `frontend-react/src/pages/Dashboard.jsx`
- `frontend-react/src/pages/Reports.jsx`
- `frontend-react/src/pages/StenosisCapabilities.jsx`
- `frontend-react/tests/e2e/fixtures.js`

### Preservation

No deleted files. All 231 baseline files outside the 20 intentional extensions
remain byte-identical, including prior model/schema/migration implementations,
viewer/worker/geometry files, earlier tests and verification reports, `.vscode/`,
`research/` and `docs/codex-handoff-to-chatgpt.md`. The 20 extensions above preserve
and build on the earlier work; no prior uncommitted file was reverted. Existing
tracked diffs include earlier phase changes and were reviewed separately.


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
?? backend/tests/test_stenosis_contract.py
?? backend/tests/test_stenosis_explanations.py
?? backend/tests/test_stenosis_jobs.py
?? backend/tests/test_stenosis_reporting.py
?? backend/tests/test_stenosis_results.py
?? docs/baseline-false-positive-audit.md
?? docs/codex-handoff-to-chatgpt.md
?? docs/milestone2-review-readiness.md
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
?? frontend-react/tests/e2e/stenosis-jobs.spec.js
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

Final whitespace/preservation verification: `git diff --check` passed (exit 0); all 13 new files also passed `git diff --no-index --check` against NUL; the index is empty. Final hash comparison found exactly the 13 new files and 20 intended extensions, 231 unchanged baseline files and no deletions. The preserved step-700 checkpoint still hashes to `e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`.
No staging, commits, pushes, merges, branch changes, destructive resets, dependency
installation, neural model execution/training, application/staging changes outside
this phase, or migrations against an application database were performed.
Disposable-test resources: ownership and volume-only mounts were verified; only the named Phase-5 PostgreSQL container and its anonymous volume were removed after testing.
