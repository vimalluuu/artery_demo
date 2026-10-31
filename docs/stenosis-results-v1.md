# Persistent stenosis candidate results — contract 1.0

Phase 5 reads these immutable results for [analytics and research reporting](stenosis-analytics-reporting-v1.md);
it does not generate or recalculate findings.

Phase 4 adds a separate [supplied-attribution contract](stenosis-explanations-v1.md)
and protected explanation records. Legacy lesion explanation references are not
silently converted into trusted attribution artifacts.

Phase 3 provides storage, protected retrieval and research visualization for
**future trusted provider outputs**. It does not detect stenosis, extract regions,
calculate diameters/narrowing, classify severity or generate explanations.
`get_runtime()` still returns `None`; the capability registry does not enable
execution. No synthetic findings are registered, seeded or saved outside tests.

## Storage and migration

`0007_stenosis_results` follows `0006_stenosis_jobs`:

| Table | Identity and integrity |
| --- | --- |
| `stenosis_analysis_results` | UUID primary key; unique analysis-job FK; restricted case and parent-segmentation FKs; contract/status checks; source/geometry SHA-256; typed provenance JSON; finding count 0–200; timestamp; case/timestamp index |
| `stenosis_lesions` | Composite primary key `(result_id, lesion_id)`; restricted result FK; typed lesion JSON; case/source/parent/geometry inherited through the result |

PostgreSQL triggers prohibit updates/deletes to both tables. Inserts require a
matching running job; additional lesions cannot be appended after completion.
UUID uniqueness is scoped to the result so external identifiers cannot cross-bind
findings to another analysis. Provider IDs are metadata, never storage paths.

The lifecycle's existing `result_reference` remains an opaque UUID rather than a
new reverse database FK (preserving its result-store interface). Application
completion requires an existing, locked, validated result from that store.
Readers fail closed if a completed job has a missing/inconsistent reference.
Privileged direct SQL and disabled triggers are outside the application boundary;
the migration does not make arbitrary SQL writes trustworthy.

Downgrade drops lesions first, then the result index/table and trigger functions.
**It deletes Phase-3 findings**, while retaining users, patients, cases,
segmentations, jobs and artifact files. Retained completed jobs will have missing
results and return an integrity error after re-upgrade until restored from a
coherent backup. Downgrade/re-upgrade does not reconstruct findings. Back up
results and associated artifacts before any planned rollback. No migration was
applied to the application database during development; tests use disposable
PostgreSQL and an isolated generated schema.

## Internal worker write boundary

Future reviewed workers must call:

```python
persist_completed_result(db, analysis_id, claim_token, payload, runtime,
                         region_inputs=None)
```

This is an internal Python service, **not an HTTP write route**. The browser can
neither submit completed findings nor choose arbitrary artifact paths.

1. Require a ready provider/dispatcher and canonical `SQLResultStore` binding.
2. Lock the running job; validate its claim/lease, current case/source checksum,
   parent segmentation, method/version and optional checkpoint fingerprint.
3. Parse `AnalysisResult`, including unique lesion UUIDs and at most 200 lesions.
4. Read the actual bounded source NIfTI header, check a coded 3D transform with
   explicit millimetre units, compare provider geometry, then canonicalize to the
   verified source header. Revalidate voxel-to-world correspondence.
5. Validate/copy any **supplied** region artifacts into a new UUID-owned output
   directory. Nothing extracts a region or replaces a missing region with the
   artery segmentation.
6. Recheck lease and source after artifact validation, insert result and lesions,
   reload/validate the persisted result in the same transaction, and transition
   the job to completed. Result, lesions, completion and audit events commit once.

Failures roll back findings/completion and remove only newly owned region copies.
Source/lease failures may subsequently record a safe failed-job state. No error
path inside the final completion guard commits partial findings. A process crash
before commit can leave an unreferenced UUID artifact directory; operational
orphan reconciliation is future work and must never delete source data.

`SQLResultStore.load()` validates row count, payload UUIDs, schema, provenance,
source/grid fingerprint and region references on every load. Immutable result
rows are locked while completion validates them. A genuine completed result may
contain zero lesions; missing, queued, running and failed results never become
empty successful findings.

## Protected read API

All paths below start with `/api/v1/cases/{case_id}/stenosis/analyses/{analysis_id}`.

| Method / suffix | Response |
| --- | --- |
| `GET /result` | `StenosisResultResponse`: result UUID, case, geometry fingerprint, supported/unsupported visualization state, allowlisted parent viewer metadata and typed `AnalysisResult` containing all lesions |
| `GET /lesions/{lesion_id}` | `StenosisLesionResponse`: analysis/result/case identity, geometry/provenance and one typed lesion |
| `GET /lesions/{lesion_id}/regions/{artifact_id}` | Exact protected supplied NIfTI bytes, opaque identifiers and safe `candidate_region.nii[.gz]` filename |

Existing JWT dependencies recheck the database account and existing `CASE_READERS`
policy (Admin, Clinician, Researcher, DataScientist). There is no new role policy.
Analysis, lesion and artifact must belong to the requested case/result. Unknown
associations return 404 without searching another case. Missing/revoked/inactive
sessions use the existing 401 handling; forbidden roles use existing 403 behavior;
malformed path UUIDs use FastAPI 422. There is no public result POST (405).

Structured 409 details use `{contract_version, code, message}`; examples include
`analysis_not_completed`, `source_changed`, `result_integrity_failure` and
`artifact_unavailable`. Readers return no findings on integrity/freshness failure.
Successful reads are audited and `Cache-Control: no-store`. No filesystem paths,
claim tokens or arbitrary metadata are serialized. Source checks reuse the
existing persisted file-version/checksum cache; unchanged large CTs are not
rehash-decoded for every lesion request.

## Geometry and source binding

- Original voxel centres are **zero-based `[i,j,k]` in original NIfTI array
  order**, not display axes. Each integer index must be within the source shape.
- World coordinates are **RAS millimetres**: `world = affine @ [i,j,k,1]`.
- World/affine comparisons use absolute tolerance `1e-4` plus relative `1e-6`,
  accommodating NIfTI-1 float32 header roundoff. This numerical tolerance does
  not establish anatomical correspondence or registration.
- Optional `slice_axis` is original array axis 0/1/2; `slice_index` must equal
  that axis's lesion index. It is not a universal axial/coronal/sagittal index.
- Reject nonfinite/singular affines, missing transforms, unknown/non-mm units,
  out-of-grid indices, inconsistent world positions and mismatched source,
  segmentation, geometry or method identity.
- Valid coded oblique/sheared mm geometry can be retained, but returns
  `visualization.status = unsupported_geometry`; the current viewer cannot safely
  show markers/regions for it. Non-mm/unknown-unit sources are rejected by the
  writer; Phase 3 does not guess conversions.

The geometry fingerprint is SHA-256 over the concatenation:

1. UTF-8 `vascuai-geometry-v1\0RAS\0mm\0nifti_i_j_k\0` (actual NUL separators).
2. The source SHA-256 as 32 raw bytes.
3. Three unsigned little-endian 32-bit shape dimensions.
4. Sixteen row-major little-endian float64 affine entries; signed zeros normalize
   to positive zero.

Python and JavaScript implementations share a fixed regression vector. Changing
source bytes, axis order, spacing or origin changes identity. Actual downloaded
CT bytes are independently hashed in the existing worker before rendering.
Header/grid agreement does not prove independently verified anatomical alignment.

## Optional candidate regions

`CandidateRegionReference` adds an opaque artifact UUID, SHA-256 of the exact
file, `nii`/`nii.gz` format, source SHA, geometry fingerprint and source geometry.
The trusted worker supplies an exact UUID-to-path mapping; extra/missing inputs
are rejected. Copying uses the existing checksum-verified private snapshot handle
to avoid a validation-to-path-open race. Input files are never modified.

Owned copies live under
`OUTPUT_DIR/stenosis-results/<result UUID>/<artifact UUID>.nii[.gz]`, outside
ordinary Git history. The writer verifies bounded 3D, coded, explicit-mm geometry,
unscaled uint8 binary labels, source affine and shape. Protected downloads use
checksum-verified private snapshots and recheck source freshness before serving;
they retain no-store/nosniff headers and safe filenames. No public static mount
or raw path parameter exists. Keep OUTPUT_DIR private to the application account.

## React and NiiVue integration

The existing case Stenosis workspace shows results only for a selected completed,
nonstale analysis. It uses the shared authenticated Axios client; results embed
all findings rather than fetching one result per lesion. Contract validation
rejects invalid identities, geometry fingerprints, locations and missing reasons.

Selection uses UUIDs in `?analysis=<UUID>&lesion=<UUID>`, survives reload/refresh
and validates membership in the current result. Available measurements retain
zero and display units/method/definition; nulls display explicit reasons. No
measurement, anatomy label, severity or explanation is invented. Different
measurement methods are identified without combining their interpretation.
Failed/incomplete, stale, missing/corrupt result, unsupported geometry and genuine
completed zero-findings states remain distinct. Empty findings are not proof of
absence. Explanation artifact references are stored but not rendered in Phase 3.

The existing viewer is loaded on request. Its CT/checksum/geometry worker,
protected downloads, axis-aware sliders, window/level, mask and 3D controls remain
in use. List selection calls NiiVue's `mm2frac(RAS_mm, 0, true)` and updates the
crosshair; no array indices are passed as world coordinates. Flipped/permuted
anatomical axes are regression-tested using actual WebGL.

The point layer uses installed **NiiVue 0.69.0**, verified against its installed
source/types. The isolated adapter uses `frac2canvasPosWithTile()` and
`canvasPos2frac()` (marked internal by NiiVue) and validates an in-plane projection
roundtrip. An upgrade must reverify these APIs and browser tests; absent APIs fail
closed. Canvas backing pixels become relative CSS positions, including device
pixel scaling and resize. Points appear only on their current voxel planes,
never as projected off-slice anatomy. Cyan means supplied candidate, yellow means
selected; buttons have text tooltips, keyboard focus and accessible labels.

Exact crosshair matches select a unique lesion. For coincident locations, preserve
the deliberately selected UUID and report ambiguity; without an existing match,
do not choose an arbitrary lesion. Empty space does not deselect a chosen lesion.
Point markers are **2D only**; 3D remains the existing artery-mask visualization.
Choosing a lesion from 3D returns to slices. CT controls do not reset UUID selection.

Supplied regions are opt-in green 2D overlays, separately labelled from the
magenta artery segmentation. Missing regions stay absent. At most one region is
loaded; hash, binary labels, geometry and memory budget are verified in a worker.
Requests/workers cancel on navigation; old overlays are removed on selection or
unmount. Region failure retains the CT and displays a reason. Region overlays are
hidden in the existing mask-only 3D view. No region is generated or inferred from
the artery mask.

Selection changes update crosshairs/markers without redownloading CT/mask or
restarting their decoding worker. The existing bounded transfer/decompression,
voxel limits, WebGL checks, session/freshness monitoring and cleanup remain.
The optional extra region uses a conservative 32-byte-per-voxel working-set budget
instead of the base pair's 26; this is an estimate, not a browser RAM guarantee.
The maximum of 200 lesion records also bounds the marker collection.

## Verification and limits

Tests are exclusively synthetic fixtures, never production/dev history or actual
clinical outputs. Backend tests cover disposable-PostgreSQL migrations, atomic
rollback including late source/lease failures, immutable rows, authorization,
typed multiple/empty results, missing-result errors, geometry and supplied-region
integrity. Unit/browser tests exercise validation, exact/ambiguous selection,
flips/permutations, real WebGL projection, overlays and mobile accessibility.
See the accompanying Phase-3 verification report for commands and actual counts.

There is no clinical validation, genuine provider integration or real lesion
localization evidence. Checkpoint/model algorithms are untouched. No model is
executed by this feature. A reviewed real provider, durable worker readiness,
runtime composition, capability activation and controlled deployment/migration
are still prerequisites for operational stenosis analysis.
