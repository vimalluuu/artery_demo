# Frontend segmentation integration — 2026-10-17

Implemented on `frontend-segmentation-ui`, starting from the verified clean
`main` merge commit `6ba5ad5` (model integration PR #7). Changes remain unstaged,
uncommitted and unpushed. No branch switching, PR creation or merge was performed.

## Existing integration points

The existing protected `/cases/:id/analysis` route uses `AnalysisResult.jsx`.
`/cases/:id/analysis/:analysisId` remains supported and highlights a matching run
from server history, or explains that the requested run is absent. `CaseDetail`
provides the shared case tabs and now links to the Segmentation workspace from
the overview and study-history pages. Navigation, the AppShell, palette, shared
cards and mobile layout are preserved.

The existing Axios client provides the configured `VITE_API_URL` (default
`/api/v1`), bearer token interception and current-session 401 handling. No second
HTTP client is introduced. Existing `useCase`, `useRemote`, `useAuth`, and
`CLINICAL_WRITERS` permissions are reused. Segmentation history stays separate
from `CaseResponse`: its legacy `analyses` array is not populated with fabricated
or unrelated results.

## User-visible workflow

1. Open a case, then its **Segmentation** tab.
2. Inspect input eligibility. A stored NIfTI volume, recorded `CTA` or
   `CT Angiography` modality, and metadata declaring exactly 3 dimensions are
   required. A 2D image, absent metadata, failed metadata fetch, incompatible
   modality or 4D volume cannot enable Run. Links lead to input metadata and the
   existing case/upload screen. Case and input checks can be refreshed.
3. Clinician and Admin users can choose a finite threshold in **[0,1]**, default
   **0.70**, then choose **Run segmentation**. Researcher and DataScientist users
   see read/download guidance and no run action.
4. The UI sends `POST /cases/{id}/segmentations` with `{ "threshold": value }`
   through the authenticated client. The synchronous request uses no invented
   progress percentage. Controls show “Segmentation running…” and remain disabled
   while the page's request is active. A ref guards immediate repeated events;
   the shared adapter also rejects a second request for the same case while its
   previous request is pending, including after a page remount.
5. HTTP **201** is required before showing that persistence succeeded. The UI
   then reloads `GET /cases/{id}/segmentations`; it does not insert the POST
   response as a locally fabricated history item. If history refresh fails,
   the saved-run confirmation and actual history error remain distinct.
6. History shows backend creation times, authoritative current/stale flags,
   threshold, architecture, checkpoint step, dimensions, patch/stride, runtime,
   source checksum and checkpoint checksum. Missing values are “Not recorded”.
   Metadata rendering is an allowlist; internal storage paths and unsupported
   clinical output fields are not displayed.
7. Current results expose **Download mask** and **Download probabilities**.
   Stale results explain why downloads are blocked and disable both actions.
   A fresh backend 409 during download triggers a history refresh.

Loading, empty, failure and inaccessible states are explicit. Server-provided
messages are preserved; 409 explains that inputs/history should be refreshed,
503 distinguishes a busy worker from administrator configuration work, and 403
explains access restrictions. Network/500 failures explain that server processing
may still finish and history should be refreshed before retrying. There is no
backend job-status, polling or cancellation API, so navigating away does not
claim to cancel inference. Session expiry follows the existing login redirect.

## API contract and download security

No backend/schema/migration changes were made. The frontend uses the existing:

- `POST /api/v1/cases/{id}/segmentations` — Clinician/Admin, JSON request, 201 after persistence.
- `GET /api/v1/cases/{id}/segmentations` — all four case-reader roles.
- `GET /api/v1/cases/{id}/segmentations/{result_id}/mask` — authenticated binary NIfTI download.
- `GET /api/v1/cases/{id}/segmentations/{result_id}/probabilities` — authenticated float32 NIfTI download.

The response fields inspected were `id`, `case_id`, `created_at`, `stale`,
`metadata`, `mask_url` and `probabilities_url`. Downloads construct the known
relative route from case/result IDs and artifact kind, preserving the configured
API base. They do not follow returned URLs with bearer credentials: this avoids
cross-origin token disclosure and accidentally duplicating `/api/v1`.

Downloads request a Blob through the same Axios instance, so the bearer token is
sent. HTTP errors are handled before saving; Blob-wrapped JSON details are decoded
for the error UI. Empty bodies, unexpected status, JSON/HTML/text responses and
invalid artifact IDs are rejected. Successful files use temporary object URLs,
which are revoked, with names:

```text
case-{id}-segmentation-{resultId}-mask.nii.gz
case-{id}-segmentation-{resultId}-probabilities.nii.gz
```

If the component unmounts or the session token changes before a download finishes,
the old response is not handed to the browser. No public static storage mount or
internal filesystem path is introduced.

## Actual verification

From `frontend-react/`:

```powershell
npm test
npm run build
npm run lint
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Users\vimzz\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe'
npm run test:e2e
```

Results after the final implementation changes:

| Check | Actual result |
| --- | --- |
| Frontend unit/contract suite | **66 passed**, including 9 new segmentation tests |
| Playwright browser suite | **38 passed**, including 22 new segmentation scenarios |
| Production build | Passed |
| Lint | Passed with the existing AuthContext Fast Refresh warning |
| Git diff whitespace check | Passed |

Browser verification includes all four role variants, submission body and
duplicate prevention, 201 then authoritative GET history, threshold boundaries,
honest synchronous loading, 409/503/500 and lost responses, refresh and retry,
stale/download blocking, token-authenticated downloads, error bodies never saved
as files, 401 session clearing, no-volume/MRA/4D eligibility, automated WCAG A/AA
checks and overflow checks at 1440px and 390px. Desktop/mobile screenshots were
visually inspected using explicitly synthetic API fixtures. Screenshots and
browser outputs remain in ignored `frontend-react/test-results/`.

All browser APIs are intercepted. The tests did not create real users/cases,
alter database records, run the trained model, download a real medical volume or
perform a deployment. Backend tests and real-server inference were not rerun in
this frontend-only task. Existing backend inference, checkpoints, migrations,
deployment files and model handoff artifacts are unchanged.

## Limits and remaining contract gaps

- The model is an experimental research baseline, not clinically validated.
  No stenosis, severity, confidence, clinical findings or Dice scores are invented.
- No medical-volume viewer exists in this phase. The UI explicitly provides
  downloads and does not claim to display voxel data or a 3D segmentation.
- The history API does not expose model readiness or worker progress. Actual
  input/model availability is established by the run request and its response.
- Synchronous inference inherits server/proxy timeouts. There is no durable job
  queue, completion notification, cross-tab request coordination or cancellation.
  A lost response can leave processing active; inspect refreshed history before
  retrying. Page reload clears the adapter's pending-request guard.
- Downloads buffer the volume as a browser Blob, so very large outputs require
  corresponding browser memory. No alternate public download path was added.
- This task verifies frontend behavior against the inspected backend contract;
  a real browser-to-model run should be verified separately in a configured
  environment with an explicitly authorized study.

## Exact changed-file inventory

Modified:

- `README.md`
- `docs/ui-features.md`
- `frontend-react/package.json`
- `frontend-react/src/api/cases-contract.js` (outdated comment only)
- `frontend-react/src/index.css`
- `frontend-react/src/pages/AnalysisResult.jsx`
- `frontend-react/src/pages/CaseDetail.jsx`
- `frontend-react/src/pages/Help.jsx`
- `frontend-react/tests/e2e/fixtures.js`
- `frontend-react/tests/e2e/workspace.spec.js`

Created:

- `docs/frontend-segmentation-ui.md`
- `frontend-react/src/api/segmentation-contract.js`
- `frontend-react/src/api/segmentation.js`
- `frontend-react/src/lib/segmentation.js`
- `frontend-react/tests/segmentation.test.js`
- `frontend-react/tests/e2e/segmentation.spec.js`

No runtime dependencies were added or changed. Generated builds, screenshots,
test outputs, secrets, model files, medical volumes and Python environments remain
outside ordinary Git history.
