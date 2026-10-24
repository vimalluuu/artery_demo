# VascuAI viewer rendering improvement plan

Prepared 24 October 2026 (Asia/Calcutta), before application changes.

## Scope and preservation baseline

Display-only work on `research/baseline-false-positive-audit`, HEAD
`428f52c1dbfe11b55bfa006c1916ac0973a7cd56`. The approved viewer boundary
supersedes the ownership gate in `WEB_APPLICATION_AUDIT.md` for this task only.
Shared case pages, APIs and all teammate assignments remain excluded.

Starting tracked changes are the approved WEB-001/WEB-003 fixes in
`frontend-react/src/pages/Reports.jsx` and
`frontend-react/tests/e2e/segmentation.spec.js`; preserve their exact current bytes.
Preserve `.vscode/`, `research/`, both existing audit documents and the handoff.
A 191-file source SHA-256/length baseline includes these changes and untracked
source files. This new plan did not previously exist.

## Phase A: inspected architecture and established behavior

The case workspace opens `SegmentationViewer`. `volume-loader.js` uses the
authenticated segmentation client for current-result checks and source/mask
downloads, with cancellation and memory limits. The worker hashes the compressed
source, performs bounded decompression, validates both NIfTI volumes and transfers
their buffers. `volume-geometry.js` admits coded millimetre, signed/permuted,
orthogonal transforms; it rejects unsupported geometry instead of resampling.

`niivue-adapter.js` lazy-loads installed NiiVue **0.69.0**, creates NVImage CT and
binary-label volumes, applies the verified affine, sets CT window [-200, 800],
and installs the magenta label LUT at opacity 0.55. Slice controls use anatomical
RAS coordinates. Window/level updates rebuild GPU textures; overlay changes and
view transitions can rebuild/redraw textures too. Mask-only 3D is volume rendering,
not mesh extraction. The CT is hidden in that mode.

Canvas attachment explicitly requests no antialiasing. The installed library's
resize listener updates backing-store dimensions using device pixel ratio and
redraws. Cleanup detaches observers/events and the adapter additionally clears
volume references and requests WebGL context loss, including when cleanup throws.

Installed-source evidence (not assumptions from current online documentation):

- `node_modules/@niivue/niivue/src/niivue/index.ts`: public
  `setInterpolation(isNearest)` updates **all** layers. Its `updateInterpolation`
  method is marked `@internal`; refresh and 3D restore paths invoke it again.
- `src/niivue/rendering/SliceRenderer.ts`: background unit 0 and overlay unit 2
  use the same global policy. Current slices sample both with NEAREST.
- `src/niivue/index.ts`, `draw3D`: forces LINEAR for the 3D pass, then restores
  slice policy. The 2D nearest setting does not explain every 3D artifact.
- Public `setScale` and `setRenderAzimuthElevation`, and public
  `onZoom3DChange` / `onAzimuthElevationChange` callbacks, support isolated camera
  controls without editing shaders, labels or transforms. Default camera is
  azimuth 110 degrees, elevation 10 degrees, scale 1.
- `src/niivue/core/gl.ts`: antialiasing is requested at context creation.

Before application changes, all **14 existing viewer browser tests passed** on
isolated port 41763 with synthetic data. API/health forwarding is blocked in the
temporary server. No real medical volumes, checkpoints or predictions were read.

### Independent synthetic rendering experiments

Evidence root:
`C:/Users/vimzz/AppData/Local/Temp/vascuai-viewer-rendering-b9fb631b`.
`experiment.mjs` records original synthetic NIfTI hashes, actual context
attributes, texture filters, volume-data hashes, camera pixel hashes and cleanup
in `experiment/render-experiment.json`; corresponding PNGs are alongside it.
The unchanged existing fixture is 12 x 10 x 8 with signed affine and anisotropic
spacing (0.7, 1.2, 2.5 mm). These are abstract landmarks, not anatomy.

Measured:

1. CT/overlay MIN and MAG filters are NEAREST (9728), including after window
   rebuild, resize, 3D and return to slices. Global linear changes **both** layers
   to LINEAR (9729); it is not an isolated CT fix.
2. Requesting antialiasing changes actual context attributes from false/0 samples
   to true/4 samples in this Chromium environment. The fixed-camera 3D RGBA hash
   is identical, `5f4c080a2639807756b71073c416d0e0446a906e72ecf07d898ea4ce6d72019b`.
   This experiment does not demonstrate a 3D quality benefit. It is not a hardware
   GPU benchmark or proof that antialiasing never affects other content.
3. Changing camera scale/orientation changes the rendered pixels. Restoring
   (110, 10, 1) exactly restores the baseline RGBA hash in both contexts.
4. CT and mask data hashes remain identical; mask values remain 0/1 and context
   release succeeds. Pixel similarity is not evidence of anatomical accuracy.

## Phase B: selected approach and acceptance criteria

| Proposal | Decision | Acceptance criteria |
|---|---|---|
| Independent continuous CT / nearest label sampling | Defer implementation | Require a supported persistent per-layer policy, tested through rebuilds, resize and 3D return. The pinned public API does not expose one. |
| One-time internal texture override, method monkey-patch, global linear switch or custom shader | Reject | No fragile internal hook or label-display blur introduced. |
| Enable antialiasing by default | Do not implement | No measured benefit in this experiment; do not incur multisample framebuffer cost on that evidence. |
| Labelled 3D zoom, tilt and reset | Implement | Public API only; keyboard-operable buttons; actual camera feedback; reset to library defaults; no window/level, opacity, slices or voxel changes. |
| Gesture/control synchronization and cleanup | Implement | Feedback follows public renderer callbacks; button operations read current scene, not stale React angles; callbacks detach before cleanup. |
| Policy/data invariance regressions | Implement tests | Verify raw image values and affine, window/level, overlay pixels/opacity, filters after rebuild/resize/view changes, and resource release. |

The smallest safe CT alternative is to keep the present discrete policy and
document the limitation. A separately reviewed library change/upgrade introducing
a public per-layer interpolation setting would be needed before enabling
continuous CT with guaranteed nearest label sampling. It requires separate
dependency approval and regression review; no dependency changes occur here.

New 3D controls improve inspection and recoverability, not segmentation quality.
Zoom buttons operate between 0.5x and 2x; native gestures remain available and
feedback follows actual renderer state, including values outside button bounds.
Tilt buttons step 15 degrees within [-90, 90]. Rotation preserves actual elevation.
Reset changes camera only to (110, 10, 1); no mask fitting, recentering or crop.
The existing camera policy for slice modes remains unchanged.

### Exact intended file boundary

- `frontend-react/src/components/SegmentationViewer.jsx`: camera buttons and
  state feedback using public callbacks; errors use existing release/fallback.
- `frontend-react/src/lib/niivue-adapter.js`: detach the two added camera callbacks
  in the established idempotent cleanup path. No interpolation/shader change.
- `frontend-react/tests/e2e/volume-viewer.spec.js`: actual UI camera controls,
  reset, preserved window/overlay state, resize and accessible mobile behavior.
- `frontend-react/tests/e2e/viewer-spike.spec.js`: adapter-backed texture policy,
  pixel/data/geometry invariants across renderer operations.
- `frontend-react/tests/volume-viewer.test.js`: camera-callback cleanup, including
  throwing cleanup and repeated release.
- This plan: record decisions and actual final verification after implementation.

No geometry, loader, worker or CSS edit is necessary. No shared case-page changes,
new API requests or new dependencies are planned. Saish's algorithms/tests/dependency
changes, Roja's dashboard/scaffold and Muskan's methodology documents are untouched.

## Risks and invariants

- Nearest CT presentation remains pixelated when magnified; do not claim it fixed.
- Ray-cast label boundaries and disconnected regions remain; no anatomical cause
  is established and no surface smoothing is added.
- Camera zoom can crop the displayed view. Reset restores framing; original volume
  geometry and all downloadable bytes remain unchanged.
- No new volume textures or volume copies are needed for camera controls. Redraw
  work still depends on the visible footprint/GPU; no FPS or GPU-memory guarantee.
- Multisample framebuffers would increase canvas-resolution-dependent memory;
  they remain disabled after the negative experiment.
- Callback churn is limited to small React camera state. Test native interaction
  synchronization and detach callbacks to avoid updates after release.
- Keyboard names, live feedback, focus, mobile wrap and existing axe checks must
  remain usable. Hardware GPUs, Safari, Firefox and assistive-technology use are
  not verified by a Chromium-only test run.

Original CT voxels/source bytes, binary mask values/artifacts, dimensions, affine,
axis handling, physical spacing/registration, checksum/freshness validation,
bounded decoding, cancellation, resource cleanup, authentication, APIs, schemas,
inference, model/data/evaluation artifacts and unrelated changes are invariant.
No resampling, downsampling, rethresholding, postprocessing, mesh extraction,
centerlines, diameter estimation, component filtering or invented connections.

## Verification sequence

1. Baseline existing 14 viewer tests and independent fixed-byte experiments above.
2. Add focused UI/adapter invariance tests and unit cleanup checks.
3. Run viewer tests, existing frontend unit tests, then relevant workspace and
   segmentation regressions (including preserved WEB-001/WEB-003 tests).
4. Build production assets outside the repository and lint only modified sources.
5. Capture final synthetic UI/control screenshots outside the repository; compare
   identical-camera renders with baseline. Changes in camera views must not be
   described as image reconstruction or accuracy improvements.
6. Inspect final diff and `git diff --check`, verify original source hashes except
   this planned boundary, and confirm HEAD/branch/staged state unchanged.

## Final implementation and verification record

Implemented the selected camera-only changes after writing the plan. Continuous
CT interpolation remains deferred; global linear/interpolation overrides and
default antialiasing were not applied. Geometry, loading, workers and CSS remain
unchanged. The five planned existing source/test files and this new document are
the only changes made in this task.

The new camera feedback follows both native wheel zoom and mouse rotation.
Rotation buttons now use the renderer's actual angle/elevation instead of an
independent React angle and forced elevation. Public API calls use the existing
render-failure fallback. Cleanup detaches the added callbacks before library
cleanup and explicit context release, including throwing/repeated cleanup.

### Actual tests and commands

Define these paths in PowerShell:

```powershell
$qc = 'C:\Users\vimzz\AppData\Local\Temp\vascuai-viewer-rendering-b9fb631b'
$cli = 'F:\Documents\artery_demo\frontend-react\node_modules\@playwright\test\cli.js'
```

From `$qc`, before application edits:

```powershell
node $cli test --config "$qc\baseline.config.cjs" --reporter=line
node "$qc\experiment.mjs"
```

- Existing viewer baseline: **14 passed**, 31.0 seconds.
- Independent fixed-byte antialias/camera/filter experiment: exit 0. Findings
  recorded above; this script is an experiment, not a new clinical evaluation.

From `$qc`, after implementation:

```powershell
node $cli test --config "$qc\baseline.config.cjs" --grep '3D camera controls|adapter preserves voxel' --reporter=line --output "$qc\focused-browser"
node $cli test --config "$qc\baseline.config.cjs" --grep '3D camera controls' --reporter=line --output "$qc\gesture-browser"
node "$qc\experiment-after.mjs"
```

- Two new focused tests: **2 passed**, 7.6 seconds.
- Expanded native-gesture camera regression: **1 passed**, 6.8 seconds.
- Repeat experiment: exit 0. Source hashes, experiment records and all four
  baseline PNG comparisons are identical before/after application edits.

From `$qc\final-run`:

```powershell
node $cli test --config "$qc\final.config.cjs" --reporter=line
```

- **56 passed**, about 1.3 minutes; no failures/skips in these four selected
  specs. Includes 16 viewer tests plus 40 workspace/segmentation tests, the
  unchanged WEB-001/WEB-003 regressions, mobile/axe checks, signed/permuted and
  anisotropic geometry, window/level, overlay visibility/opacity, resize/rebuild,
  native gestures, camera reset, authentication/cancellation/freshness fallback
  workflows and repeated resource release. The opt-in real-volume spec is excluded.

From `F:/Documents/artery_demo/frontend-react`:

```powershell
npm test
npm run lint -- src/components/SegmentationViewer.jsx src/lib/niivue-adapter.js tests/e2e/viewer-spike.spec.js tests/e2e/volume-viewer.spec.js tests/volume-viewer.test.js
node "$qc\build.mjs"
```

- Unit/contract suite: **87 passed**, zero failures/skips. The existing two
  cleanup tests now also verify detached camera callbacks.
- Targeted Oxlint: exit 0, no reported findings.
- Production Vite 8.3.4 build: exit 0, 2,085 modules. Output and cache are external
  under `$qc`; no build/deployment/config files were edited. Existing >500 kB
  lazy NiiVue/codec chunk warnings remain, plus a plugin-timing informational
  notice. No bundle/performance refactor was attempted.

All browser API/health responses are intercepted; the temporary Vite server also
blocks unmocked API/health forwarding. Tests establish browser/software behavior,
not a fresh real-database/model/production deployment transaction. Hardware GPU
comparisons, Safari, Firefox and manual screen-reader review remain unverified.
No real medical volume, model checkpoint or held-out data was accessed.

### Visual evidence

All paths below are beneath the external `$qc` directory, outside Git history.

- Before: `experiment/baseline-slices.png`, `experiment/baseline-render.png`.
- After at identical input/settings: `experiment-after/baseline-slices.png` and
  `experiment-after/baseline-render.png`. PNG bytes are identical to their before
  counterparts. `baseline-camera.png` and `baseline-globalLinear.png` also match
  before/after; the global-linear image is an unshipped experiment only.
- Independent AA comparison: `experiment/aa-render.png`; its raw 3D RGBA hash
  equals the non-AA render. No universal hardware/quality conclusion is claimed.
- Actual new UI: `final-browser/volume-viewer-3D-camera-co-ac6ac-and-reset-presentation-only/`
  contains `3d-default.png`, `3d-camera-adjusted.png`, `3d-reset.png` and
  `3d-controls-mobile.png`. Adjusted view differs; default/reset PNGs compare
  equal in the test. These views depict synthetic landmarks, not anatomy.
- Original baseline UI screenshots remain in `$qc/test-results/`; final existing
  UI screenshots are in `$qc/final-run/test-results/` so they do not overwrite
  the baseline evidence. Initial focused/gesture evidence is retained separately.

The source/data checks prove exact values and geometry are preserved for the
synthetic fixtures; no independent anatomical registration or clinical accuracy
claim follows from them. Residual voxel-step boundaries, disconnected mask
regions and magnified CT pixelation are intentionally not altered.

### Preservation and final diff

SHA-256/length comparison against the starting 191-file baseline finds exactly
the five planned existing source/test files changed, **186 unchanged**, and only
this new plan added. In particular, Reports.jsx and segmentation.spec.js retain
the exact already-approved WEB-001/WEB-003 bytes. Existing untracked research,
editor settings, audit and handoff documents remain unchanged.

`git diff --check` passes. The combined tracked diff also contains the two
pre-existing web fixes; they are not changes made by this viewer task. The staged
diff remains empty; branch, HEAD and the three teammate snapshot refs remain
unchanged. No branch switch, reset, clean, stash, stage, commit, push, merge,
deployment, dependency installation, database migration, model/inference/training
or dataset change occurred. The owned isolated test server is stopped after
verification; no pre-existing/staging service is stopped or reconfigured.
