# VascuAI - Milestone 2 Web Application Audit

**Project:** Infosys Springboard AI Internship - VascuAI
**Audit date:** 23 October 2026, Asia/Calcutta
**Scope:** web application, integration, reliability, viewer presentation and ownership review.
**Mode:** audit and this report only; no feature implementation.
**Repository:** F:/Documents/artery_demo
**Audited HEAD:** 428f52c1dbfe11b55bfa006c1916ac0973a7cd56

## 1. Executive summary

The existing application should be preserved, not rebuilt. Its React/FastAPI case workspace, authentication adapters, bounded NIfTI ingestion, experimental segmentation integration, protected result history/downloads and CT/prediction viewer are implemented. Browser checks exercise actual frontend rendering and synthetic WebGL volumes, with API responses intercepted; they do not prove current real-database or real-model end-to-end operation.

Confirmed own-scope findings are:

1. **WEB-001:** report preview unconditionally says no segmentation result exists, even when the case's segmentation API offers a saved result.
2. **WEB-002:** a transient 503 during session restoration deletes the browser token and redirects to login. This is a confirmed availability/reliability behavior, not evidence of an authentication bypass.
3. **WEB-003:** one browser test hardcodes origin port 5173 and fails on an otherwise functioning isolated audit origin. Its targeted default-port rerun passes.
4. **VIEW-001:** CT slice interpolation is globally nearest-neighbour. This conflicts with the requested continuous-CT/discrete-label presentation policy, but the cause of all reported 3D blockiness is not established. Viewer implementation remains ownership-gated.

An initial suspicion that optional case fields were silently failing to clear was **disproved at the UI boundary**: the form explicitly warns and prevents the request. Treat it as an intentional capability restriction, not a confirmed silent-save bug.

Teammate work exists in cached branch snapshots and remains protected. No teammate files, model/data files, configuration or database schema were changed. Only this newly requested report was created in the repository.

## 2. Repository and Git status

- Active branch: **research/baseline-false-positive-audit**.
- HEAD: **428f52c1dbfe11b55bfa006c1916ac0973a7cd56**.
- Subject: Merge pull request #10 from baseline-model-diagnostics.
- Starting tracked/staged changes: none.
- Starting untracked work: .vscode/, docs/baseline-false-positive-audit.md, docs/codex-handoff-to-chatgpt.md and research/.
- One existing worktree: F:/Documents/artery_demo. No checkout, branch switch, merge, rebase, reset, stage, commit, push or fetch was performed.
- The requested docs/WEB_APPLICATION_AUDIT.md did not exist. It was created with exclusive-create semantics; no existing report was overwritten.
- A 190-file source hash baseline was captured. Final preservation checks are recorded in section 20.

### Ownership snapshot identities

| Authoritative assignment | Cached branch inspected | Snapshot commit | Snapshot evidence |
|---|---|---|---|
| Saish | origin/feature/vessel-analysis-prototype | a7eed45d7e1b88a7f0a927fe5967249e340908db | New standalone module/tests and shared requirements change |
| Roja | origin/feature/milestone2-evaluation-ui | 893de9fc8af0b7f114f5bffb79b0139fd0cdc9c5 | Evaluation component/tests plus broader frontend scaffold |
| Muskan | origin/docs/milestone2-evaluation-report | aa8d6afb0085f3263219f1f259976786aeddc7f9 | Four evaluation-documentation files; no merge base with this HEAD |

These are local remote-tracking snapshots, not a claim that the latest live GitHub heads were fetched. Recheck ownership and branch changes before later implementation. The supplied human assignments remain authoritative regardless of incomplete code or missing integration.

## 3. Current application architecture

- **Active frontend:** React 19, React Router, Vite, Axios, Lucide, shared CSS/Tailwind, Chart.js and lazy-loaded NiiVue 0.69.0. Entry points are E01/E02 below.
- **Backend:** FastAPI entry point E03 registers auth, patients, cases, administration and segmentation routers under /api/v1.
- **Persistence:** SQLAlchemy models for users, patients, cases, volume metadata, audit events and segmentation results. PostgreSQL is the primary database; SQLite is restricted to testing mode.
- **Migrations:** existing revisions 0001 through 0005 were inspected as source only. Revision 0005 has an index-before-table downgrade and explicitly deletes segmentation history. No migration was executed or modified.
- **Viewer data path:** authenticated Axios -> protected source/mask endpoints -> bounded worker decompression and source checksum -> geometry validation -> NiiVue textures.
- **Deployment:** nginx serves the compiled React frontend and forwards /api/ and /health paths; optional model overlay mounts external weights read-only. No deployment or existing service change occurred.
- **Legacy frontend:** F:/Documents/artery_demo/frontend is retained historical demonstration content, not the active application. Roja's branch also uses a frontend tree; merging that scaffold is not equivalent to integrating her isolated component.

### Evidence index

All E references below resolve to current working-tree files. Teammate-only Git paths are listed separately in sections 12-14 and must not be mistaken for files already merged here.

| ID | File and relevant implementation |
|---|---|
| E01 | [App.jsx](F:/Documents/artery_demo/frontend-react/src/App.jsx), protectedPages and public routes |
| E02 | [main.jsx](F:/Documents/artery_demo/frontend-react/src/main.jsx), React entry |
| E03 | [main.py](F:/Documents/artery_demo/backend/app/main.py), router registration, sanitized errors and health |
| E04 | [AuthContext.jsx](F:/Documents/artery_demo/frontend-react/src/context/AuthContext.jsx), AuthProvider restore effect |
| E05 | [client.js](F:/Documents/artery_demo/frontend-react/src/api/client.js), bearer and current-session 401 handling |
| E06 | [auth.py](F:/Documents/artery_demo/backend/app/routers/auth.py), real auth endpoints |
| E07 | [dependencies.py](F:/Documents/artery_demo/backend/app/core/dependencies.py), database-authoritative JWT/user authorization |
| E08 | [access-policy.json](F:/Documents/artery_demo/frontend-react/src/constants/access-policy.json) and [roles.py](F:/Documents/artery_demo/backend/app/core/roles.py) |
| E09 | [CaseDetail.jsx](F:/Documents/artery_demo/frontend-react/src/pages/CaseDetail.jsx), CaseEdit, Imaging and CaseHistory |
| E10 | [Reports.jsx](F:/Documents/artery_demo/frontend-react/src/pages/Reports.jsx), ReportPreview |
| E11 | [cases-contract.js](F:/Documents/artery_demo/frontend-react/src/api/cases-contract.js), field mapping, updates and uploads |
| E12 | [cases.py](F:/Documents/artery_demo/backend/app/routers/cases.py), case CRUD subset and upload handlers |
| E13 | [volume_ingestion.py](F:/Documents/artery_demo/backend/app/services/volume_ingestion.py), bounded NIfTI admission |
| E14 | [AnalysisResult.jsx](F:/Documents/artery_demo/frontend-react/src/pages/AnalysisResult.jsx), run/history/download/viewer workspace |
| E15 | [segmentation.py](F:/Documents/artery_demo/backend/app/routers/segmentation.py), protected result/source endpoints |
| E16 | [SegmentationViewer.jsx](F:/Documents/artery_demo/frontend-react/src/components/SegmentationViewer.jsx), ViewerSession and controls |
| E17 | [niivue-adapter.js](F:/Documents/artery_demo/frontend-react/src/lib/niivue-adapter.js), createVolumeViewer and releaseViewer |
| E18 | [volume-geometry.js](F:/Documents/artery_demo/frontend-react/src/lib/volume-geometry.js), inspectVolume, validatePair and volumeBudget |
| E19 | [volume-loader.js](F:/Documents/artery_demo/frontend-react/src/lib/volume-loader.js) and [volume.worker.js](F:/Documents/artery_demo/frontend-react/src/workers/volume.worker.js) |
| E20 | [segmentation-contract.js](F:/Documents/artery_demo/frontend-react/src/api/segmentation-contract.js), validated relative API routes and downloads |
| E21 | [segmentation.spec.js](F:/Documents/artery_demo/frontend-react/tests/e2e/segmentation.spec.js), especially line 132 |
| E22 | [workspace.spec.js](F:/Documents/artery_demo/frontend-react/tests/e2e/workspace.spec.js), workflows/accessibility |
| E23 | [volume-viewer.spec.js](F:/Documents/artery_demo/frontend-react/tests/e2e/volume-viewer.spec.js) and [viewer-spike.spec.js](F:/Documents/artery_demo/frontend-react/tests/e2e/viewer-spike.spec.js) |
| E24 | [conftest.py](F:/Documents/artery_demo/backend/tests/conftest.py), disposable database fixtures and automatic migration/drop behavior |
| E25 | [create_admin.py](F:/Documents/artery_demo/backend/app/database/create_admin.py), operator bootstrap |
| E26 | [Research.jsx](F:/Documents/artery_demo/frontend-react/src/pages/Research.jsx), explicit unavailable research services |
| E27 | [ForgotPassword.jsx](F:/Documents/artery_demo/frontend-react/src/pages/ForgotPassword.jsx), explicit recovery limitation |
| E28 | [patients.py](F:/Documents/artery_demo/backend/app/routers/patients.py), create/list only |
| E29 | [nginx.conf](F:/Documents/artery_demo/deploy/nginx.conf), HTTP routing and 300-second upstream timeout |
| E30 | [compose.model.yaml](F:/Documents/artery_demo/deploy/compose.model.yaml), optional runtime configuration |
| E31 | [index.css](F:/Documents/artery_demo/frontend-react/src/index.css), responsive breakpoints, focus, reduced-motion and viewer styling |
| E32 | [Alerts.jsx](F:/Documents/artery_demo/frontend-react/src/pages/Alerts.jsx) and [preferences.js](F:/Documents/artery_demo/frontend-react/src/lib/preferences.js), explicitly local activity/preferences |
| E33 | [case.py](F:/Documents/artery_demo/backend/app/schemas/case.py), CaseUpdate nullable schema |
| E34 | [frontend-segmentation-viewer.md](F:/Documents/artery_demo/docs/frontend-segmentation-viewer.md), prior real-volume verification scope |
| E35 | [codex-handoff-to-chatgpt.md](F:/Documents/artery_demo/docs/codex-handoff-to-chatgpt.md), historical test/deployment records; not proof of current ChatGPT access |
| E36 | [package.json](F:/Documents/artery_demo/frontend-react/package.json), [requirements.txt](F:/Documents/artery_demo/backend/requirements.txt) and [requirements-model.txt](F:/Documents/artery_demo/backend/requirements-model.txt) |
| E37 | [compose.yaml](F:/Documents/artery_demo/deploy/compose.yaml), [backend.Dockerfile](F:/Documents/artery_demo/deploy/backend.Dockerfile) and [frontend.Dockerfile](F:/Documents/artery_demo/deploy/frontend.Dockerfile) |
| E38 | [admin.py](F:/Documents/artery_demo/backend/app/routers/admin.py), access management and audit list |

All three configuration templates exist: backend/.env.example, frontend-react/.env.example and deploy/.env.example. Inspected variable names include VITE_API_URL; JWT signing/issuer/audience and database settings; CORS_ORIGINS, UPLOAD_DIR and OUTPUT_DIR; VASCULAI_MODEL_CHECKPOINT and inference runtime limits; and MODEL_ARTIFACT_DIR/WEB_PORT in deployment configuration. Health routing is configured in the application/proxy, not a separate health-URL template variable. No private .env values, tokens, passwords or credentials are reproduced in this report.

## 4. Completed and verified features

Here COMPLETE AND VERIFIED means implemented plus bounded source/unit/browser evidence within the scope stated. It does not mean every feature was exercised against the real database in this audit.

| Component | Classification | Evidence and verification boundary |
|---|---|---|
| Public pages, route guards and four-role navigation | COMPLETE AND VERIFIED | E01/E08; current browser fixtures exercise roles and denied routes |
| Login/register/profile/password/logout client contracts | COMPLETE AND VERIFIED at client-contract scope | E04-E08; 87 same-session unit/contract passes; real JWT/backend persistence not rerun |
| First-Admin mechanism | Implemented, NEEDS MANUAL VERIFICATION operationally | E25 prompts an operator; public registration cannot create Admin; no account created here |
| Patient creation/listing and case intake/update subset | COMPLETE AND VERIFIED at browser-contract scope | E09/E11/E12/E22/E28; intercepted schema-shaped requests and expected UI states |
| Upload validation and metadata presentation | COMPLETE AND VERIFIED at inspected/tested scope | E11-E13; size/format rules, progress/cancellation, NIfTI-1/2 checks; DICOM explicitly unsupported |
| Segmentation run/history/download frontend wiring | COMPLETE AND VERIFIED at client/browser-contract scope | E14/E15/E20/E21; real model execution is an external dependency, not run here |
| Protected downloads and stale-input handling | Implemented with source/test evidence | E15/E19/E20; current frontend tests exercise stale, error and session-change cases; backend source snapshot uses exact copied-byte verification |
| Slice, overlay and 3D binary-volume controls | COMPLETE AND VERIFIED for admitted synthetic volumes | E16-E23; actual WebGL, physical-coordinate tests and overlay pixels; real-volume evidence is historical |
| Exported case metadata | COMPLETE AND VERIFIED within metadata-only scope | Reports/exports tests verify allowlists and CSV safety; no clinical/evaluation report claimed |
| Responsive layouts and automated accessibility | COMPLETE AND VERIFIED on covered fixture paths | Desktop/mobile and axe checks passed; manual assistive-technology/device coverage remains pending |

Existing bytes, affine transformations, bounded decompression, cancellation and cleanup should not be discarded while changing appearance. These are implemented correctness controls.

## 5. Partially implemented features

- **Patient management:** create/list and case association exist; editing/deletion are not implemented.
- **Case editing:** replacing supported values works. Clearing existing optional values is intentionally refused with a visible warning; status/identity fields are not general editable state.
- **Study history:** current timestamps/metadata exist, with a link to the separate segmentation history workspace; it is not a complete consolidated event timeline.
- **Imaging workspace:** input metadata is available. CT/prediction viewing is tied to a current saved segmentation; a standalone pre-inference CT viewer and general 2D preview are not implemented.
- **Reports:** metadata summaries and exports exist; current summary wording is overbroad when segmentation history exists. No reviewed clinical report or evaluation dashboard API is present.
- **Notifications/settings:** activity read state and display preferences are explicitly device-local, not a backend notification/subscription service.
- **Operations:** basic liveness/database connectivity, proxy routing and reference container configuration exist; model/storage/queue monitoring and production acceptance are incomplete.
- **Research pages:** registry/training/evaluation unavailable states are intentional. Roja and Muskan own their assigned evaluation deliverables; these absences are not permission to duplicate them.

These are capability boundaries, not instructions to build every possible feature.

## 6. Confirmed bugs and counterevidence

### WEB-001 - overbroad report-preview statement

E10 ReportPreview, approximately lines 234-239, unconditionally says no analysis run, model version or segmentation result is available. A browser reproduction supplied one saved run at the case segmentation endpoint while opening /reports/1; the statement remained visible. The page is a metadata summary and does not load segmentation history.

This is a wording/integration defect, not a reason to fabricate a clinical report. A minimal safe fix is neutral metadata-only wording plus a link to the authoritative Segmentation workspace. Fetch actual history only if that behavior is explicitly approved.

### WEB-002 - transient session-restoration failure clears authentication

E04 AuthProvider's mount effect calls clearSession for every failed authApi.me request. The fresh browser probe returned a synthetic 503, then observed a redirect to /login and a deleted stored token.

Distinguish this from E05's correct handling of a rejected current-session 401. A later fix should remain fail-closed for protected content while offering a recoverable blocking/retry state for transient network/5xx failures. It must not authorize from cached role/user values, weaken JWT checks or retain genuinely revoked credentials as authenticated.

### WEB-003 - browser test hardcodes a development origin

E21 line 132 requires every artifact request URL to start with http://127.0.0.1:5173/api/v1/. The isolated suite used the same application on port 41763: 51 tests passed and this assertion alone failed. Its targeted rerun against an isolated, backend-blocked port-5173 server passed.

This is a test portability defect. Bearer forwarding and download behavior were not shown broken. Derive expected origin from the test's configured base URL instead of a literal development port.

### Not a confirmed bug - optional metadata clearing

Two exploratory probes initially expected a PATCH after clearing existing fields and failed because no request was emitted. Inspection of E09 CaseEdit.submit, lines 276-287, established an explicit guard and warning. The corrected browser probe confirmed both the warning and zero PATCH requests.

E11 omits blank optional fields, and E12 uses model_dump(exclude_none=True). A schema-only check confirmed explicit nulls are dropped by that reduction. Together these describe the current no-clear contract. Do not present this as silent saving or change null semantics without a separately approved API/product decision.

## 7. Missing web functionality

The following capabilities are absent or limited, but are not automatically milestone requirements:

- Standalone CT viewing before a successful segmentation and general protected 2D image preview.
- Patient edit/delete and broader case lifecycle/deletion operations.
- Self-service password-reset delivery and its associated secure backend flow.
- Durable cross-device notifications.
- Persistent model/dataset registries, job monitoring and deployment management.
- A connected evaluation data API/dashboard contract.

The final item overlaps Roja's UI and Muskan's methodology/data identity work. It is blocked on agreement, not an unowned feature to implement here. Centerlines, diameters and component filtering remain Saish's work.

## 8. Frontend-backend integration findings

| Workflow | What is established | What remains unverified |
|---|---|---|
| Register/login | Real API adapters and schemas; browser fixture and unit coverage | Fresh real backend account/session transaction |
| Session persistence | Restores identity from /auth/me rather than trusting cached user data | Resilience on transient restore failure: WEB-002 |
| Permissions | Four-role values and reader/writer policy match; protected routes tested | Complete deployed access policy and account setup |
| Patient/case operations | Requests, mappings, loading/errors and UI refresh paths exist | Current real-database persistence after reload/restart |
| Uploads | Supported formats, client/server bounds and geometry metadata paths exist | Live upload transaction/storage behavior in intended deployment |
| Viewer | Authenticated CT/mask routes, source SHA, result/case binding, abort and geometry checks | New real-volume/browser/backend/model transaction; no such inference run was attempted |
| Error handling | Structured client errors; backend validation strips sensitive input and generic errors hide internals | Operator diagnosis/telemetry and transient-session recovery |
| Exports | Explicit metadata allowlist, CSV formula neutralization and temporary URL cleanup | No clinical or evaluation export service |

The API remains authoritative. Tests using in-memory browser fixtures demonstrate frontend behavior; they cannot establish a real PostgreSQL write or trained-model execution.

Existing GET handlers may commit audit records. The audit therefore did not use the real authenticated API or application database to simulate workflows.

## 9. CT + segmentation viewer findings

### Evidence actually inspected

- Current E16-E20, their unit/browser tests and the installed NiiVue 0.69.0 source/types.
- Existing historical images: F:/Documents/vascuai-artifacts/viewer-verification-20261019/validation-851-slices.png and validation-851-mask-3d.png.
- Current synthetic signed/permuted/anisotropic WebGL viewer tests, keyboard controls, overlay on/off pixels, responsive behavior and resource release.
- No source CT or prediction volume was modified, resampled or filtered. No new inference or anatomical assessment occurred.

The historical slice screenshot visibly contains grayscale CT with magenta prediction, not a grayscale substitute for the mask. The historical 3D screenshot contains magenta, voxel-stepped, disconnected regions. These observations do not establish tissue identity, registration failure or the cause of segmentation errors.

### CT slices

- Window/level is implemented: default range -200 to 800, represented by width 1000 and level 300; sliders update the CT display range.
- E17 sets isNearestInterpolation=true. Installed SliceRenderer.ts selects GL NEAREST for the background when that option is active. Therefore **CT slices use nearest sampling as configured**, not separately selected continuous interpolation.
- This is a confirmed rendering-policy mismatch against the requested CT-continuous/labels-discrete policy. It is a plausible source of magnified pixelation, not proof that every reported visual issue has that cause.
- Grayscale is normal for CT presentation and is not itself a defect.
- Explicit zoom/pan/reset controls and instructions are not supplied by the React controls. NiiVue may provide gestures; usability, keyboard access and reset behavior require manual verification before declaring those capabilities absent.
- Installed resizeListener handles device-pixel ratio. Do not assume a missing HiDPI implementation solely from a screenshot; measure backing-store/CSS dimensions on the affected device.

### Overlay

- The mask must be uint8 with values 0/1. Visibility, opacity and magenta differentiation are implemented.
- CT/mask dimensions and affines are compared, CT geometry is checked against result metadata, and source bytes are SHA-verified.
- Sform precedence is deliberately aligned with backend behavior; signed/permuted orthogonal axes and anisotropic spacing have tests.
- Two-dimensional label sampling is nearest under the current global setting.
- Simply turning global nearest interpolation off is **not** a safe proposed fix: it affects both CT and overlay layers. A layer-aware implementation must survive texture rebuilds/window changes and preserve discrete-label correctness.
- No reference/ground-truth overlay is part of this viewer. Its absence must not be filled with invented annotations.

### Existing 3D view

- E16's mask3d mode hides CT opacity and selects NiiVue volume rendering. E17 loads NVImage volumes; the application does not generate a polygon mesh or call a meshing/smoothing algorithm.
- Installed NiiVue index.ts, approximately lines 10892-10898, temporarily forces linear texture filtering during 3D volume rendering, then restores slice filtering. Thus it would be incorrect to blame the entire 3D appearance on the 2D nearest setting.
- attachToCanvas(canvas,false) explicitly disables antialiasing. This can contribute to raster edge aliasing; it does not explain all voxel steps, disconnected predictions or anatomy.
- Display-only investigation may compare antialiasing, rendering settings and view framing against fixed bytes. It must not smooth/resample/rethreshold the saved mask, remove components, invent connections or implement Saish's analysis.
- Boundary texture interpolation in a renderer is not the same operation as changing stored label IDs. Any alternative display policy must be validated and labelled; smoother pictures do not demonstrate improved segmentation.

### Correctness and limits

- Admission is explicit: 3D, coded transforms, millimetre units, axis-aligned signed/permuted geometry. Unknown/non-mm, oblique/sheared, incomplete and unsupported inputs fail closed.
- The viewer uses NiiVue transforms/RAS controls; it does not manually equate original array axes with anatomical axes.
- Synthetic geometry/overlay tests passed. Existing images alone do not prove independent anatomical correspondence for arbitrary studies.
- Current viewer cap is 67,108,864 voxels, plus a working-set heuristic and per-artifact transfer/decompression limits. Do not silently downsample to bypass them.
- API inference limits are separately configurable. A volume can pass upload yet fail inference or viewer admission; explain these separate capabilities rather than assuming all uploaded data is viewable.
- Full-volume loading, snapshot copying and GPU allocation need capacity tests. Preserve checksum/snapshot correctness while addressing performance.
- **OWNERSHIP UNVERIFIED — DO NOT MODIFY** viewer files until the user approves the exact boundary below.

### Proposed future viewer boundary, not implemented

Potentially affected files are E16-E19, relevant viewer-only CSS in E31 and their existing main-application tests E23. Shared E09/E14 should be touched only if a narrowly specified integration requirement is approved. Protected exclusions are Saish's vessel_analysis.py/tests/dependency work; Roja's evaluation component/tests/scaffold; Muskan's documentation; inference, weights, datasets, APIs and database schema.

A first approved viewer experiment should compare continuous CT slice display with unchanged nearest/discrete label display, using fixed synthetic geometry and original immutable artifacts. A separate 3D render-quality comparison follows only if needed. Do not promise a one-line global interpolation change will solve the user's entire complaint.

## 10. Authentication and security findings

Implemented safeguards include server-side role/active-user/token-version checks, Argon2 password hashing, expiring issuer/audience-bound JWTs, database-authoritative authorization, sanitized validation/internal errors, explicit Admin bootstrap, blocked public Admin registration, safe relative artifact routes, containment checks and no-store source/result responses.

The four canonical values are Clinician, Researcher, DataScientist and Admin. Clinician/Admin write case data and request inference; all case-reader roles can inspect authorized shared-workspace records. Public registration is limited to the three non-Admin values. No default account/password is defined by the inspected bootstrap.

WEB-002 is an availability/session-state issue; no authentication bypass was observed. Do not resolve it by trusting cached identity or changing role policy.

Current access is a shared role-based workspace, not evidence of a reviewed patient/tenant isolation system. Production account enrollment and data-access policy need operator review. No blanket RBAC redesign is approved by this audit.

Private configuration was not printed. Configuration-template names/public keys are discussed, not their private instantiated values. No real users/accounts were created or changed.

## 11. Test results and exact scope

### Current audit checks

| Check | Actual result | Scope/qualification |
|---|---|---|
| Production build using installed Vite | PASS, 2,085 modules transformed | Output/cache outside repository; no source/config edits |
| Full isolated browser fixture suite | 51 passed, 1 failed, 52 total | Port 41763; sole failure is WEB-003's literal 5173 assertion |
| Targeted failing-test rerun at isolated port 5173 | 1 passed | Supports port-assumption diagnosis; not a newly claimed clean full-suite run |
| Final browser reproduction harness | 3 checks completed successfully | Confirmed WEB-001/002; confirmed intentional no-clear guard |
| Schema/adapter-only probes | Completed | Explicit null reduction/blank mapping; no database or API modification |
| Historical image inspection | Two original images inspected | Original bytes not edited; no model/anatomical conclusion |
| Teammate branch review | Three snapshot trees inspected | No checkout, dependency install or teammate tests executed |

The isolated servers blocked real /api and /health forwarding. Browser tests used existing synthetic fixtures, not a real database or model. The opt-in real-volume browser test was deliberately excluded. No held-out data was accessed.

The two initial exploratory metadata probes expected a PATCH, failed to observe one, and were stopped. The source and final corrected browser probe showed the intentional warning/guard. Those failed assumptions are retained as counterevidence, not hidden or reported as application defects.

### Same-session preceding checks, on identical application source

The immediately preceding read-only repository audit ran the existing seven frontend unit/contract files: **87 passed, 0 failed/skipped**. Read-only Oxlint exited 0 with one pre-existing AuthContext Fast Refresh warning. The source baseline remained unchanged between that audit and this web audit; these checks were not repeated merely to inflate counts.

No current backend pytest suite was run. E24 applies migrations and drops/recreates disposable schemas through autouse fixtures; this audit did not invoke destructive database routines or alter application environment/configuration. Historical backend results in E35 are not presented as fresh passes.

### Reproduction paths and commands

Temporary audit root:

    C:/Users/vimzz/AppData/Local/Temp/vascuai-web-audit-NWxdPk

Build used installed Vite's programmatic build with configLoader=runner, external cacheDir and build.outDir beneath that root, emptyOutDir=false. Existing source configuration was read without editing it. The external build passed; it emitted the existing large-chunk warning. Approximate uncompressed lazy outputs included NiiVue 875 kB and codec chunks 603/747 kB. The warning is not a build failure.

Browser configuration and artifacts are outside the repository:

- audit-playwright.config.cjs: four existing spec files; baseURL http://127.0.0.1:41763; 2 workers.
- browser-output/: initial failure evidence and test output.
- default-port-audit.config.cjs and default-port-browser-output/: targeted rerun evidence.
- web-issue-reproductions-v3.json and matching -v3.png screenshots: final probes.
- test-results/: screenshots explicitly emitted by existing tests relative to the external working directory.

The full suite command was the installed Playwright CLI, test --config <external audit-playwright.config.cjs> --reporter=line. The targeted rerun added --grep "both downloads carry bearer authentication and save sensible filenames" --workers=1 using the external default-port config.

The port-5173 server closed in its finally block. The owned port-41763 Node server was stopped after confirming its listener/PID and command identity. No existing/staging service was stopped or reconfigured.

Unverified: current real backend/database transaction, live model-serving availability, remote deployment, Safari/Firefox, actual mobile GPU limits, screen-reader use and the reported appearance on the user's current device/volume/settings.

## 12. Saish's protected work

Assignment: standalone 3D centerline extraction, physical-spacing diameter estimation, configurable connectivity-preserving component filtering, synthetic geometry tests and technical documentation.

Observed snapshot adds:

- origin/feature/vessel-analysis-prototype:backend/app/services/vessel_analysis.py
- origin/feature/vessel-analysis-prototype:backend/tests/test_vessel_analysis.py
- It modifies backend/requirements.txt by adding scikit-image and SciPy pins.

Module functions include extract_centerline, estimate_diameter and filter_connected_components. This establishes code presence, not verified algorithm performance. Its tests were not run from another branch and no dependency was installed. Module documentation exists; completion of all assigned documentation/test evidence remains Saish's review.

No existing viewer/API/inference file appears in that snapshot's change list. Shared backend requirements nevertheless create an explicit coordination point: do not edit that dependency file as though it were unowned.

Classification: **ASSIGNED TO SAISH**. No algorithm implementation, duplication, modification, merge or integration was performed.

## 13. Roja's protected work

Assignment: isolated, responsive Segmentation Evaluation Dashboard with supplied metrics, comparisons, empty/loading/error/unavailable states and a research disclaimer; no backend integration until a contract is agreed.

Observed snapshot contains:

- origin/feature/milestone2-evaluation-ui:frontend/src/components/evaluation/SegmentationEvaluationDashboard.jsx
- Matching CSS and SegmentationEvaluationDashboard.test.jsx.
- frontend/src/evaluation-preview.jsx and frontend/evaluation-preview.html.
- A broader frontend scaffold: App, layouts, other pages and separate package/dependency files.

The component displays supplied values and handles missing values as Not measured. Its preview supplies an empty evaluation list. Numeric values in its unit-test fixtures are test data, not evidence of hardcoded production scores. Seven tests are present as source; they were not executed here.

The broader scaffold exceeds the narrow component integration boundary and uses a different frontend tree from the active frontend-react application. Ask Roja to agree on the isolated deliverable/import boundary before any integration; do not replace the active app or merge the whole scaffold automatically. No protected screenshot deliverable was edited; no completion claim is made for screenshots not observed in the snapshot.

Classification: **ASSIGNED TO ROJA**. Dashboard code, tests, screenshots and backend evaluation integration were not duplicated.

## 14. Muskan's protected work

Assignment: evaluation methodology/definitions, comparison template, architecture/dataset/preprocessing/checkpoint/result documentation, leakage precautions, failure-mode documentation, reproducibility checklist and open questions.

Observed snapshot contains exactly:

- docs/milestone2-evaluation-report/README.md
- docs/milestone2-evaluation-report/model_comparison_template.md
- docs/milestone2-evaluation-report/reproducibility_checklist.md
- docs/milestone2-evaluation-report/segmentation_evaluation_methodology.md

These are Git-tree paths at the protected ref, not files created by this audit. The snapshot has no merge base with the current HEAD; the initial three-dot diff failed for that reason, and a root-tree inspection was used instead. No history rewriting, unrelated-history merge or branch repair was attempted.

The README references ImageCAS-X/800 scans and filelist conventions. Current project records describe a different verified ImageCAS split convention. This is an ownership-review dependency for Muskan to reconcile with the actual project sources, not authority to rewrite her methodology or substitute datasets.

Classification: **ASSIGNED TO MUSKAN**. This report describes web ownership/integration only and does not create competing metric definitions, report templates or evaluation methodology.

## 15. My own pending tasks and issue inventory

### Classification and permission rules

Allowed classifications are COMPLETE AND VERIFIED, PARTIALLY IMPLEMENTED, MISSING, BROKEN, NEEDS MANUAL VERIFICATION, ASSIGNED TO SAISH/ROJA/MUSKAN, OWNERSHIP UNVERIFIED and EXCLUDED MODEL OR DATASET WORK.

**Implementation permitted now:** only this requested audit report. For user-scope issues below, "candidate after review" means the assignment does not duplicate a teammate; it is not authorization to implement in this audit. Recheck latest ownership before changing files. Viewer entries retain **OWNERSHIP UNVERIFIED — DO NOT MODIFY**.

### Issue index

| ID | Feature/current classification | Priority | Complexity | Ownership | Implementation permission |
|---|---|---|---|---|---|
| WEB-001 | Report preview - BROKEN wording | P2 | Low | User web scope | No now; candidate after report review |
| WEB-002 | Session restore - BROKEN transient-error behavior | P2 | Medium | User web/auth integration | No now; security-preserving behavior review first |
| WEB-003 | E2E portability - BROKEN test assumption | P2 | Low | User main-app tests | No now; candidate after review |
| VIEW-001 | CT interpolation - OWNERSHIP UNVERIFIED | P1 user viewer priority | Medium | Existing viewer boundary unresolved | DO NOT MODIFY |
| VIEW-002 | 3D appearance - NEEDS MANUAL VERIFICATION | P2 | Medium | Viewer boundary unresolved; not Saish algorithms | DO NOT MODIFY |
| VIEW-003 | Zoom/pan/reset affordances - PARTIALLY IMPLEMENTED/needs verification | P3 | Medium | Viewer boundary unresolved | DO NOT MODIFY |
| WEB-004 | Real backend/refresh persistence - NEEDS MANUAL VERIFICATION | P1 acceptance | Medium | User web integration | No live database changes; approved isolated acceptance setup needed |
| WEB-005 | Clearing metadata - PARTIALLY IMPLEMENTED capability | P3 optional | Medium | User web/API contract; shared case-page boundary review | No bug fix implied; product/API decision needed |
| WEB-006 | CT-only/2D preview - MISSING capability | P3 optional | High | Web/viewer/API boundary unresolved | No; optional scope and ownership approval needed |
| WEB-007 | Password recovery - MISSING service | P3 optional | Medium/High | User account workflow | No; account-recovery policy/infrastructure needed |
| WEB-008 | Additional patient/case lifecycle - MISSING subset | P3 optional | High | User product/API workflow | No; not an agreed requirement or deletion policy |
| OPS-001 | Model-enabled deployment acceptance - NEEDS MANUAL VERIFICATION | P1 before production | Medium/High | User web operations | No deployment/service change in this audit |
| PERF-001 | Viewer bundle/working set - PARTIALLY IMPLEMENTED optimization | P3 | Medium | User operations; viewer changes gated | No; measure before changing |
| A11Y-001 | Manual accessibility/device validation - NEEDS MANUAL VERIFICATION | P2 | Medium | User web QA; viewer controls gated | Read-only review candidate; code changes need approval |
| TEAM-A | Vessel algorithms - ASSIGNED TO SAISH | Owner's plan | Owner estimates | Saish | No |
| TEAM-B | Evaluation dashboard - ASSIGNED TO ROJA | Owner's plan | Owner estimates | Roja | No |
| TEAM-C | Evaluation methodology/docs - ASSIGNED TO MUSKAN | Owner's plan | Owner estimates | Muskan | No |
| EX-001 | Model/data/training work - EXCLUDED MODEL OR DATASET WORK | Outside this audit | Not estimated | Excluded | No |

### WEB-001 - report-preview truthfulness

- **Feature/current status:** report summary exists; its no-segmentation statement is BROKEN.
- **Evidence/defect:** section 6 fresh browser reproduction and E10 ReportPreview. A synthetic case endpoint offered one saved run while the unconditional negative statement remained visible.
- **Expected behavior:** accurately describe a metadata-only report without denying other available case outputs or claiming clinical findings.
- **Recommended fix:** neutral scope wording and link to the authoritative segmentation workspace; add a focused main-app regression test.
- **Relevant files:** E10 and E22; no Roja component or Muskan template.
- **Dependencies:** agree whether wording-only scope is sufficient; no schema/model/data change required.
- **Priority/complexity:** P2, Low.
- **Owner/permission:** user web scope; no implementation now, safe candidate after review.

### WEB-002 - recoverable session restoration

- **Feature/current status:** restore flow exists; transient failures currently delete credentials and redirect.
- **Evidence/defect:** E04 generic catch and successful 503 browser reproduction.
- **Expected behavior:** protected data stays blocked until server identity is validated; temporary availability failures offer retry without being treated as confirmed credential rejection.
- **Recommended fix:** distinguish 401/revocation from network/5xx; provide blocking retry UI, with current-token race protections and explicit tests. Never use a browser-cached role for authorization.
- **Relevant files:** E04, E05, protected-route UI and main-app auth/browser tests.
- **Dependencies:** approve intended failure-state policy; preserve server JWT/RBAC and session-change handling.
- **Priority/complexity:** P2, Medium.
- **Owner/permission:** user web/auth integration; no implementation now.

### WEB-003 - origin-independent browser assertion

- **Feature/current status:** artifact test is BROKEN outside its literal development origin.
- **Evidence/defect:** E21 line 132; port-41763 failure and port-5173 targeted pass.
- **Expected behavior:** verify same-origin protected routes against configured baseURL, independently of an isolated test port.
- **Recommended fix:** derive expected origin from configuration/page URL, retaining bearer/path/security assertions.
- **Relevant files:** E21 and existing Playwright configuration if needed.
- **Dependencies:** none on teammate components/model/schema.
- **Priority/complexity:** P2, Low.
- **Owner/permission:** user main-app tests; candidate after review, no edit now.

### VIEW-001 - continuous CT and discrete-label display

- **Feature/current status:** CT and labels are shown, but global nearest sampling does not satisfy the requested separate interpolation policy.
- **Evidence/defect:** E17 option and installed SliceRenderer behavior; exact visual root cause remains partly unverified.
- **Expected behavior:** continuous-value CT presentation while retaining discrete 0/1 label correctness and unchanged geometry.
- **Recommended fix:** first approve a viewer-only file boundary; then implement/test a layer-aware display policy resilient to redraw/texture rebuilds. Do not globally blur labels or alter saved data.
- **Relevant files:** E16-E19, viewer-only E31, E23.
- **Dependencies:** explicit existing-viewer ownership approval, pinned-library API review and pixel/world-coordinate regression tests.
- **Priority/complexity:** P1 as the user's viewer priority, Medium.
- **Owner/permission:** **OWNERSHIP UNVERIFIED — DO NOT MODIFY**.

### VIEW-002 - investigate 3D appearance without editing the mask

- **Feature/current status:** genuine binary-volume rendering exists; visual-quality cause is NEEDS MANUAL VERIFICATION.
- **Evidence/defect:** existing screenshot shows voxel-stepped magenta regions; no application mesh pipeline; antialias=false; library forces linear filtering in the 3D pass. A specific transform/resampling bug was not demonstrated.
- **Expected behavior:** truthful, stable display of fixed prediction data, with clear distinction between render quality and segmentation quality.
- **Recommended fix:** approved display-only A/B investigation of antialiasing/framing/quality and GPU cost; preserve exact labels/transforms; document limits. No component removal, invented connections, new centerline/diameter or mask smoothing.
- **Relevant files:** E16/E17/E23 and viewer-only CSS.
- **Dependencies:** affected-device/volume/settings reproduction and ownership approval; model quality remains an excluded dependency.
- **Priority/complexity:** P2, Medium.
- **Owner/permission:** existing viewer ownership unresolved; DO NOT MODIFY.

### VIEW-003 - discoverable image navigation

- **Feature/current status:** slices/window/opacity controls work; explicit zoom/pan/reset UI is partial and native gesture behavior is not fully verified.
- **Evidence:** E16 controls and E17 drag settings; keyboard slice tests pass.
- **Expected behavior:** discoverable, accessible zoom/pan/reset if these are approved product requirements.
- **Recommended fix:** verify current library gestures first; then propose bounded labelled controls/instructions without changing image geometry.
- **Relevant files:** E16/E17/E23/E31.
- **Dependencies:** product requirement, manual keyboard/touch checks and viewer ownership.
- **Priority/complexity:** P3, Medium.
- **Owner/permission:** ownership unresolved; DO NOT MODIFY.

### WEB-004 - real web/backend persistence acceptance

- **Feature/current status:** API-wired application; current real transaction is NEEDS MANUAL VERIFICATION.
- **Evidence/gap:** E06/E12/E15/E28 commit database operations; browser tests intercept all API requests. No current real DB/account workflow was exercised.
- **Expected behavior:** authorized login/intake/upload/history remains correct after page refresh and service restart in an approved isolated environment.
- **Recommended fix:** run a separately approved, non-destructive acceptance workflow against a provisioned throwaway environment, retaining actual request/outcome evidence. Do not run fixture drop/migration routines against the application DB.
- **Relevant files:** E06/E09-E15/E20/E22/E24 and deployment guides; no changes presumed necessary.
- **Dependencies:** isolated backend/database/storage, approved account setup and explicit inference authorization if a model run is later required.
- **Priority/complexity:** P1 acceptance, Medium.
- **Owner/permission:** user integration QA; no real database work authorized here.

### WEB-005 - optional metadata clearing contract

- **Feature/current status:** PARTIALLY IMPLEMENTED capability, explicitly unavailable rather than silently broken.
- **Evidence:** E09 guard, E11 omission and E12 exclude_none; corrected browser check shows warning/no PATCH.
- **Expected behavior:** current behavior remains truthful; any future "clear" operation must distinguish omitted from explicitly empty/null.
- **Recommended fix:** only if approved, define nullable-field semantics and tests, protecting nonnullable study_type and immutable fields. No schema change assumed.
- **Relevant files:** E09/E11/E12/E33 and corresponding tests.
- **Dependencies:** product/API agreement and shared case-page ownership check.
- **Priority/complexity:** P3 optional, Medium.
- **Owner/permission:** user web contract candidate; no change now and not a confirmed bug.

### WEB-006 - pre-analysis CT and 2D preview

- **Feature/current status:** metadata exists; standalone preview capabilities are MISSING.
- **Evidence:** E09 Imaging presents metadata, E14 opens viewers from saved results, E15 source retrieval is tied to a current segmentation.
- **Expected behavior:** only an approved product requirement, not an existing promise that every upload is viewable immediately.
- **Recommended fix:** decide scope first. If needed, design an additive protected data route and viewer mode with existing case authorization; never expose a public static upload mount or bypass geometry checks.
- **Relevant files:** E09/E14-E20 and image/volume API contracts.
- **Dependencies:** explicit product/API/viewer boundary approval; no duplicate backend or database schema change.
- **Priority/complexity:** P3 optional, High.
- **Owner/permission:** web/API/viewer ownership boundary unresolved; no implementation.

### WEB-007 - forgotten-password recovery

- **Feature/current status:** MISSING automated recovery service; E27 states that honestly.
- **Evidence/gap:** auth implements current-password change and operator Admin bootstrap, not an email/token reset flow.
- **Expected behavior:** do not offer a functioning reset form until an approved secure recovery process exists.
- **Recommended fix:** agree account-recovery policy and delivery/operator responsibilities before any API/UI implementation. No default credentials or password exposure.
- **Relevant files:** E27/E06/E25 and auth schemas/tests if later approved.
- **Dependencies:** security policy and delivery infrastructure.
- **Priority/complexity:** P3 optional, Medium/High.
- **Owner/permission:** user account workflow candidate; not authorized now.

### WEB-008 - additional patient/case lifecycle

- **Feature/current status:** create/list/update subset exists; further lifecycle operations are MISSING.
- **Evidence/gap:** E28 exposes create/list, E12 exposes limited case updates; no general patient edit/delete or case deletion workflow.
- **Expected behavior:** only implement a separately agreed workflow with authorization and file/result retention rules.
- **Recommended fix:** clarify needs before adding controls; do not introduce deletion, schema changes or fake enabled buttons as audit fixes.
- **Relevant files:** E28/E12 and main patient/case pages/contracts.
- **Dependencies:** product scope, access/retention rules and API agreement.
- **Priority/complexity:** P3 optional, High.
- **Owner/permission:** user web scope candidate; no implementation/destructive operation now.

### OPS-001 - deployment, capability and timeout acceptance

- **Feature/current status:** reference deployment exists; complete model-enabled operation NEEDS MANUAL VERIFICATION.
- **Evidence/gap:** E03 readiness is database connectivity; E29 has 300-second proxy timeout; inference is synchronous; E30 is optional; browser and model limits are separate from upload limits.
- **Expected behavior:** operator distinguishes API/DB health from model/storage readiness; long requests and resource rejection are explained accurately.
- **Recommended fix:** review deployment acceptance and timeout/capability contracts in an isolated environment. Do not blindly extend timeouts, raise memory caps or add a queue requiring schema changes.
- **Relevant files:** E03/E14/E15/E18/E29/E30/E37 and web error/health tests.
- **Dependencies:** deployment owner, storage/resources and approved API contract. Inference optimization/training are excluded.
- **Priority/complexity:** P1 before production, Medium/High.
- **Owner/permission:** user web operations; no deploy/service/config change now.

### PERF-001 - bounded viewer loading and bundles

- **Feature/current status:** lazy loading and budgets exist; optimization is PARTIALLY IMPLEMENTED.
- **Evidence/gap:** build passes with large NiiVue/codec chunks; complete volumes are loaded; source snapshots intentionally copy/hash bytes for integrity.
- **Expected behavior:** preserve bounded memory, cancellation, source identity and label fidelity while measuring startup/memory on intended devices.
- **Recommended fix:** profile before changing chunking or quality. Do not remove provenance checks or silently downsample to hide limits.
- **Relevant files:** E16-E20/E36 and Vite config; source snapshot API only with coordination.
- **Dependencies:** representative device measurements and viewer ownership for rendering changes.
- **Priority/complexity:** P3, Medium.
- **Owner/permission:** user performance QA; code changes only after review.

### A11Y-001 - manual accessibility and device assurance

- **Feature/current status:** automated checks/keyboard slices/mobile layouts pass; broader assurance NEEDS MANUAL VERIFICATION.
- **Evidence/gap:** E22/E23/E31; no fresh screen-reader, Safari/Firefox or actual mobile GPU verification.
- **Expected behavior:** usable keyboard focus/navigation, discoverable controls, readable errors and adequate visual contrast in supported workflows.
- **Recommended fix:** conduct manual checks and log reproducible failures before changing shared components. Automated axe success is not complete accessibility certification.
- **Relevant files:** E01/E09/E14/E16/E22/E23/E31 plus shell/navigation components as indicated by actual failures.
- **Dependencies:** test devices/assistive technology; viewer/shared-file ownership where relevant.
- **Priority/complexity:** P2, Medium.
- **Owner/permission:** user web QA; no speculative redesign authorized.

### TEAM-A / TEAM-B / TEAM-C / EX-001

- **Current status:** ASSIGNED TO SAISH / ASSIGNED TO ROJA / ASSIGNED TO MUSKAN / EXCLUDED MODEL OR DATASET WORK.
- **Evidence and exact files:** sections 12-14 and 16.
- **Expected behavior:** preserve authoritative assignments; agree interfaces before integration.
- **Defect/gap:** their presence on separate snapshots does not mean missing work is unowned or automatically mergeable.
- **Recommended action:** owner-led review and boundary/contract agreement, not duplicate implementation.
- **Priority/complexity:** owner-managed; no estimate or promised completion is invented.
- **Dependencies:** teammate approval, correct project/data references and safe branch integration review.
- **Implementation permission:** none in this task; no edits to their modules, components, tests, screenshots or documentation.

## 16. Excluded model and dataset tasks

Do not implement or change architecture, training/retraining, optimizers, inference algorithms, checkpoints, Kaggle notebooks, ImageCAS files, preparation/splits, held-out assignments, threshold tuning, component postprocessing or segmentation-evaluation methodology.

A blocky or disconnected prediction is not permission to alter its mask in the frontend. Any model-dependent issue is recorded as a dependency only. Saish's standalone vessel analysis is not a cosmetic viewer filter. Roja's dashboard is not a substitute for a real evaluation contract. Muskan owns methodology and comparison templates.

No model inference/training, raw dataset preparation, new segmentation metrics or test-volume processing occurred during this web audit.

## 17. Prioritized recommendations

1. Review/approve the ownership map and the narrow viewer-only boundary. Keep all three teammate deliverables isolated.
2. Approve a small WEB-001 wording/link correction with a focused regression test; it has no schema, algorithm or teammate dependency.
3. Approve WEB-003's configuration-aware assertion and WEB-002's fail-closed retry behavior as separate, reviewable web changes.
4. After explicit viewer ownership approval, investigate VIEW-001 with synthetic layer/geometry pixel tests; handle 3D appearance separately under VIEW-002.
5. Establish WEB-004/OPS-001 acceptance evidence in an approved isolated backend environment before claiming complete live or production operation.
6. Keep optional recovery/CRUD/preview/notification features out of the milestone unless product scope is separately agreed.

No recommendation above authorizes feature implementation automatically.

## 18. Dependencies and blockers

- Existing viewer/shared-case boundary needs explicit approval before any rendering/control change.
- Cached teammate branches may have newer remote work; recheck before later edits.
- Saish's shared requirements changes need coordination.
- Roja's wider frontend scaffold needs isolation/import-path agreement and a future data contract.
- Muskan's unrelated-history branch and project-source references need owner review; no automatic history repair.
- Backend persistence/model-serving acceptance is not established by mocked browser tests.
- Rendering quality needs affected-device/settings reproduction; antialiasing/interpolation trade-offs must retain immutable data and geometry.
- No production credentials, services, dataset recovery or model experiments are needed to implement the proposed small report/test fixes.

## 19. Unverified assumptions and limits

- No access to the pinned ChatGPT conversation is claimed. No teammate or reviewer was contacted.
- Branch snapshots were inspected locally; latest live GitHub state and teammate sign-off are not claimed.
- Teammate tests/screenshot completion were not verified by executing their code.
- The current user's specific poor-appearance screenshot/device/settings were not supplied. Existing historical case-851 images and synthetic current tests were inspected instead.
- No new real medical volume was decoded or modified; synthetic geometry tests do not prove anatomical registration for arbitrary cases.
- No fresh real JWT/database/model transaction or production deployment was tested.
- Device/browser and assistive-technology coverage is limited to the checks documented.
- Unit, browser-fixture and build success is software evidence, not clinical validation.
- Optional missing features are not assumed to be approved requirements.
- No inferred evaluation score, vessel identity, medical conclusion or model-improvement claim is made.

## 20. Recommended next steps and preservation

**Recommended next authorized task:** a narrow WEB-001 report-preview truthfulness correction in E10 plus a main-application regression test, after the user reviews this report. This is separate from Roja's dashboard and Muskan's report templates. In parallel, obtain explicit viewer-boundary approval for VIEW-001; do not start rendering changes merely because the user identified them as a priority.

The audit is complete as a report, not an implementation sprint. The intended final repository delta is only this new docs/WEB_APPLICATION_AUDIT.md. All 190 pre-existing tracked/untracked source files must remain byte-identical, existing untracked work must remain present, and HEAD/branch/teammate snapshots must remain unchanged. Final verification results are appended below only after checking them.

**Final verification:** all 190 pre-existing tracked/untracked source files match their recorded SHA-256 and byte length. The only added repository file is docs/WEB_APPLICATION_AUDIT.md. Branch and HEAD remain research/baseline-false-positive-audit / 428f52c1dbfe11b55bfa006c1916ac0973a7cd56; all three teammate snapshot SHAs remain unchanged. Tracked and staged diffs are empty, and git diff --check passes. Existing .vscode/, research/, docs/baseline-false-positive-audit.md and docs/codex-handoff-to-chatgpt.md remain unchanged. No commits, pushes, merges, branch switches, resets, feature changes, dependency installs, database migrations, staging changes, model inference/training or dataset changes were performed.
