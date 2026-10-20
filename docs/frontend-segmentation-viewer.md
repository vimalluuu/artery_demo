# CT and binary-segmentation viewer — 2026-10-19

Experimental research visualization — not for diagnostic use.

## Scope and existing work

Implemented on `baseline-model-diagnostics`, starting at
`461a7d1d3ee5047aa4dd5d37465f5c146e57230b`. The four pre-existing README,
AppShell, Landing and static-dashboard metric-honesty edits were preserved and
copied with a binary patch/status/starting SHA to
`F:\Documents\artery_demo_codex_safety\web-sprint-20261019` before broad changes.
No branch switching, staging, commit, push, merge, destructive reset, retraining
or existing application-database migration was performed.

This integrates with the existing case `/cases/:id/analysis` workspace. Existing
run controls, authoritative history, authenticated downloads and role checks
remain. One selected CT/mask pair is loaded only after **View CT + Segmentation**.

## Setup and dependencies

Run `npm ci` in `frontend-react`, then the normal Vite or production build.
New exact runtime pins:

- `@niivue/niivue`: `0.69.0` (lazy-loaded, no React wrapper required).
- `nifti-reader-js`: `0.8.0` (worker/header validation).
- `fflate`: `0.8.3` (bounded worker gzip decompression).

The lockfile records transitive versions. NiiVue's below-v1 repository is in a
maintainer-announced transition to a rewritten monorepo. This version was tested
against the actual React 19/Vite 8 app, not assumed compatible from current docs.
Keep the adapter isolated when evaluating upgrades. The first 0.8.2 fflate pin
was corrected to 0.8.3 after npm audit identified a moderate malformed-ZIP64
issue; no forced/general dependency upgrades were applied.

References: [NiiVue repository](https://github.com/niivue/niivue),
[NVImage API](https://niivue.com/docs/api/nvimage/classes/NVImage/),
[NiiVue layouts](https://niivue.com/docs/layouts/).

No new runtime environment variables or model settings are required. Reuse
`VITE_API_URL` (default `/api/v1`) and the existing JWT client. Source verification
uses Web Crypto in a worker, requiring HTTPS or localhost. Keep signing keys and
database credentials private; Vite variables are public build-time configuration.

Model configuration remains `VASCULAI_MODEL_CHECKPOINT` pointing to a trusted
external checkpoint. The preserved local handoff and external artifact paths
remain in the [model setup guide](../backend/app/services/segmentation/README.md).
The original checkpoint SHA-256 remains
`e208fa586bb9bb50dc77b913caa0355a547bad529f9f0d61df17880b2efc5254`.
No medical volume, weights, probability output or generated mesh is added to Git.

## Additive source API

```http
GET /api/v1/cases/{case_id}/segmentations/{result_id}/source
Authorization: Bearer <current session>
```

The fixed source route is registered before the dynamic mask/probability route.
All four existing case-reader roles can read: Clinician, Researcher,
DataScientist, Admin. This preserves the current role-based case-access policy;
the repository does not implement per-patient ownership/tenant scoping.

Checks performed before streaming:

1. Existing authentication/active-user and server role dependencies.
2. Case exists and result belongs to exactly that case (404 otherwise).
3. Existing stale check: source path and persisted SHA-256 match the current
   application-owned source. Missing/unreadable/checksum-less sources fail closed
   with 409. Same-path byte changes invalidate the fingerprint cache.
4. Resolved source must remain directly within the private volume directory and
   exist as a regular NIfTI file. No caller-supplied filesystem path is accepted.

Responses preserve original file bytes. `.nii.gz` uses `application/gzip` and
`source_ct.nii.gz`; `.nii` uses `application/octet-stream` and `source_ct.nii`.
Headers include `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
Reads record the normal audit event. No public static mount, path response field,
new table or migration is introduced. Existing result fields and artifact paths
are unchanged. OpenAPI advertises both binary MIME types and security.

The existing bounded fingerprint cache avoids rereading unchanged large files.
Cold/changed sources are hashed once per observable file version. It is not
tamper-proof against privileged storage changes that spoof every version field.
Application-owned immutable/versioned storage remains an operational assumption.

## Viewer workflow and controls

1. Open a case's Segmentation tab and select **View CT + Segmentation** on a
   current run. A stale run cannot open the viewer.
2. The viewer verifies current history, retrieves source and mask through the
   existing Axios bearer client, and shows actual bytes received for each file.
   It never follows server-supplied artifact URLs with credentials and does not
   load probability volumes by default.
3. A cancellable worker hashes the original CT download, checks the recorded
   source hash, decompresses gzip with an output limit, and validates payloads,
   CT/mask geometry and recorded inference provenance. History is checked again
   after loading to reject a replaced source during the transfer.
4. NiiVue displays axial, coronal and sagittal planes on a single canvas/context.
   Labelled keyboard-accessible sliders navigate anatomical slice indices;
   crosshair RAS positions, original dimensions and spacing are displayed.
5. Controls adjust CT window width/level in source intensity units, binary-mask
   visibility and opacity. Masks use a discrete magenta label LUT and nearest
   sampling. There is no smoothing, registration, threshold retuning or alteration
   of the stored prediction. Window changes are debounced to limit texture churn.
6. **3D binary mask** renders the actual saved mask volume, hiding CT density.
   It does not extract a surface mesh or invent centerlines/anatomy. Rotate with
   the pointer or the labelled left/right buttons; return to slices at any time.
7. Closing restores focus to the opener, aborts requests/worker work, removes
   observers/listeners, releases array references and explicitly loses the GL
   context. Retrying creates a fresh canvas/session. Error states preserve the
   authenticated artifact downloads as the fallback.

Session changes, navigation and run selection cancel or invalidate old loads.
History refresh closes stale/absent selections. While open, freshness is checked
on window focus and every 60 seconds; therefore a replacement in another session
may take up to that interval to be detected. This is not instantaneous push-based
invalidation. Closing the viewer does not cancel synchronous backend inference.

## Geometry policy

Both NIfTI-1 and NIfTI-2 single-file volumes are parsed. The mask must be unscaled
uint8 containing only 0/1. CT values remain in their original geometry and use
their NIfTI intensity scaling; model-normalized data are not displayed as CT.

The first implementation supports coded sform/qform, axis-aligned signed/permuted
spatial axes, anisotropic positive spacing and explicit millimetre units. It
rejects uncoded transforms, unknown/non-mm units, oblique/sheared or degenerate
geometry, nonfinite floating values, incomplete payloads and 4D input. This is a
viewer admission policy, not an alteration of the broader ingestion contract.
Unsupported studies remain downloadable for a suitable desktop application.

The selected affine matches nibabel `get_best_affine`: sform first, otherwise
qform. Both nifti-reader-js and NiiVue may otherwise prefer a larger qform code.
The validator reads original srow fields directly, and the adapter explicitly
sets the verified affine before rendering. Tests cover conflicting code values,
flips, translations and axis permutation. There is no manual array reslicing.

CT/mask shapes and affines must match, and CT geometry must match the selected
run's shape/affine/units. Affine comparison uses a small numerical tolerance
(`1e-4 + abs(value)*1e-6`). Spacing must agree with affine column lengths. A
matching affine alone does not prove identity: source SHA and server-side
case/result binding are checked independently. Mask artifacts rely on existing
UUID-owned, application-controlled result storage; no separate persisted mask
checksum was introduced.

Display convention is explicitly neurological. Slice controls follow RAS
anatomical axes rather than assuming original array indices are screen axes.
NiiVue supplies the world-space transforms and orientation markers.

## Performance limits and measured real-volume smoke

Admission limits are 67,108,864 voxels and an estimated 26 bytes/voxel CPU/GPU
working set. The heuristic budget is 768 MiB on devices reporting <=4 GiB RAM,
otherwise 1,536 MiB (8 GiB assumption when the browser does not expose RAM).
This is a resource heuristic, not a guarantee of available RAM/VRAM. GPU maximum
3D texture dimensions are checked before transfer. Transfers and decompression
are bounded at 512 MiB per artifact, with additional shape-derived output limits.
No silent downsampling is performed. Context loss/allocation failure shows a
fallback rather than substituting a fake image. Large volumes are fully loaded;
gzip NIfTI does not provide random slice streaming through ordinary byte ranges.

An explicit opt-in browser run used the existing de-identified validation case
851 CT and saved mask, shape `(512,512,217)`, without rerunning inference. It
served these files through isolated HTTP fixtures, not an application database.
Both orthogonal slices and the actual 3D mask rendered successfully. One measured
final run was ready in **10,190 ms**. Chromium reported an AMD Radeon/ANGLE D3D11
renderer, maximum 3D texture size **2048**, and no GL errors.

CDP sampled backing storage peaked near **396.0 MiB**; after close and explicit
garbage collection it fell to approximately **16.2 MiB** (initial approximately
10.8 MiB). These are browser-process heap/backing-storage samples, not GPU memory
measurements or a cross-device performance guarantee. Shader caches/library code
remain loaded after close. PNGs, resource JSON and final handoff checksum checks
are preserved outside Git under
`F:\Documents\vascuai-artifacts\viewer-verification-20261019`.

The actual model remains a poor experimental baseline. Rendering a nonempty or
visually plausible volume does not establish segmentation accuracy, clinical
confidence, stenosis, severity, diagnosis or clinical findings. No test-set case
or new training run was used.

## Verification commands

```powershell
# frontend-react/
npm test
npm run build
npm run lint
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Users\vimzz\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe'
npm run test:e2e

# Optional real-volume smoke: explicitly supply de-identified validation artifacts.
$env:VASCULAI_VIEWER_REAL_CT = '<local validation CT path>'
$env:VASCULAI_VIEWER_REAL_MASK = '<matching saved binary mask path>'
$env:VASCULAI_VIEWER_REAL_METADATA = '<matching inference metadata.json path>'
npx playwright test tests/e2e/viewer-real-volume.spec.js --workers=1

# backend/, using the existing Python environment
python -m pytest -q --cov=app --cov-report=term-missing
python scripts/test_postgres.py --bin 'C:\Program Files\PostgreSQL\18\bin'
python scripts/test_frontend_contract.py
```

The real-volume test is skipped unless all three explicit paths are supplied.
Normal automated tests use synthetic data and disposable databases. No application
credentials or user records are used. The first compatibility spike renders real
synthetic NIfTI voxels/labels through WebGL and tests physical coordinates,
orientation, discrete overlay color and cleanup. Integrated tests cover protected
requests, gzip worker processing, source checksum, geometry failure, keyboard
navigation, opacity, windowing, 3D selection, focus, context loss on close,
cancellation, session changes, stale results, limited resources and mobile WCAG
checks. Unit tests also cover NIfTI-2 and qform-only headers.

Final counts, command results, Docker verification, changed-file inventory and
remaining tasks are recorded in [the final handoff](codex-handoff-to-chatgpt.md).
Historical reports retain their original counts and dates.

## Remaining scope

- Oblique/sheared transforms, non-mm/unknown units and uncoded-affine fallback
  require additional geometry work and test data before relaxing admission.
- No browser chunked/tiled streaming, surface-mesh extraction, GPU-memory query,
  durable backend inference queue, inference cancellation or push invalidation.
- Model registry, dataset/split management, training, real evaluation UI,
  stenosis/clinical reporting and self-service email password reset remain
  explicitly unavailable; this sprint does not simulate them.
- Patient editing/deletion was not added: the existing backend exposes only
  registration/listing, and the UI accurately documents that limit. Existing
  case metadata updates, relationships, uploads, exports and admin APIs remain.
- First-Admin setup is now discoverable in Help: trusted operator command
  `python -m app.database.create_admin` from the backend environment. It prompts
  privately and refuses to promote existing accounts. No default credentials.
- Remote HTTPS hosting, production secrets, backups/restoration and a real
  production browser/API/model run remain operator deployment work.
