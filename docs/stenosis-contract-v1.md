# Stenosis capability and future analysis contracts — 1.0

Phase 2 adds [durable lifecycle infrastructure](stenosis-lifecycle-v1.md) using
these unchanged contracts. The Phase-1 scope described below is historical;
capability states remain unavailable/not integrated and no model execution is
enabled. Lifecycle routes and deployment prerequisites are documented separately.

Phase 1 implements **capability retrieval only**. It does not implement stenosis
execution, jobs, predictions, measurements, explanations, persistence or reports.
Existing segmentation endpoints and the CT/binary-mask viewer are unchanged.

## Implemented endpoint

`GET /api/v1/stenosis/capabilities` uses the application's existing bearer
authentication and database-authoritative case-reader role policy. All four
canonical roles may read it. Authentication still reads the current user; the
registry itself performs no database, filesystem, checkpoint or model queries.
The response is Pydantic-validated and has `Cache-Control: no-store`.

HTTP 200 means capability information was retrieved, **not** that analysis ran
or that a study has no stenosis. There is no execution endpoint in this phase.

Complete example response (current registry):

```json
{
  "contract_version": "1.0",
  "capabilities": [
    {"contract_version":"1.0","id":"stenosis_detection","display_name":"Stenosis detection","status":"unavailable","availability_reason":"No verified stenosis detection provider is registered.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"candidate_region_extraction","display_name":"Candidate region extraction","status":"unavailable","availability_reason":"No stenosis candidate extraction method is implemented.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"stenosis_localization","display_name":"Stenosis localization","status":"unavailable","availability_reason":"No verified lesion localization output is available.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"vessel_diameter_measurement","display_name":"Vessel diameter measurement","status":"not_integrated","availability_reason":"No verified vessel diameter service is integrated into this application.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"percentage_narrowing","display_name":"Percentage narrowing","status":"unavailable","availability_reason":"No narrowing measurement method or reference-region selection is implemented.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"severity_classification","display_name":"Severity classification","status":"unavailable","availability_reason":"No validated severity methodology or classifier is integrated.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"explainability","display_name":"Explainability","status":"unavailable","availability_reason":"No explanation generation method or attribution artifacts are integrated.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"stenosis_visualization","display_name":"Stenosis visualization","status":"not_integrated","availability_reason":"Geometry-checked lesion markers are implemented; no verified stenosis provider outputs are integrated.","execution_permitted":false,"method_id":null,"method_version":null},
    {"contract_version":"1.0","id":"stenosis_reporting","display_name":"Stenosis reporting","status":"not_integrated","availability_reason":"Structured research reports use persisted stenosis records; no genuine stenosis provider outputs are integrated.","execution_permitted":false,"method_id":null,"method_version":null}
  ]
}
```

Exactly one entry for each of the nine identifiers is required. Unknown versions,
duplicate/missing identifiers, unknown states and inconsistent permissions are
errors, not an empty successful response. Backend models reject extra fields.
Frontend validation checks the complete envelope and each capability. It uses
the shared Axios client; 401 handling remains owned by the existing session code.

## State meanings and activation gate

| State | Meaning |
|---|---|
| `available` | A verified, versioned method is integrated for that capability. This does not imply clinical validation. |
| `unavailable` | No usable method/output is available in the application. |
| `not_integrated` | The application connection or presentation is missing; this makes no claim that a usable provider exists elsewhere. |
| `disabled` | A capability has been deliberately switched off. |

`execution_permitted` is independent of retrieval success. It can only be true
for `available`; an available capability must name its method and version.
Available-but-not-permitted is valid, for example for a reader-only role.
Current entries all deny execution and register no method/version.

The centralized registry is `backend/app/services/stenosis.py`. Activation must
be a reviewed change backed by a real provider, integration tests, appropriate
role checks and method evidence. Segmentation availability never activates it.
Changing a registry status alone does not implement an execution endpoint.
The Phase-1 UI therefore always disables Start stenosis analysis.

## Future contracts, not implemented execution features

The dedicated types in `backend/app/schemas/stenosis.py` define the future
boundary. Only `CapabilitiesResponse` is currently returned by an endpoint.
Future models are not advertised as execution routes in OpenAPI.

### Request and source binding

```json
{
  "contract_version": "1.0",
  "source": {
    "case_id": 1,
    "image_reference": "case-volume",
    "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "parent_segmentation_result_id": "12345678-1234-4567-890a-123456789abc"
  }
}
```

This is a **synthetic contract example**, not an existing study or prediction.
`case_id` is a positive database integer and segmentation IDs use the existing
UUID convention. `case-volume` is a logical reference scoped by case and source
SHA-256, not a new database identifier or filesystem path. The fingerprint is
the SHA-256 of the original stored NIfTI bytes, including compression when used,
matching existing segmentation metadata. No execution options are supported;
unknown fields, including thresholds, are rejected.

`validate_source_association()` performs a pure check against an already-loaded
segmentation record: case ID, segmentation UUID and source hash must agree.
Pydantic alone cannot establish database membership or freshness. A future
execution handler must first enforce authorization, load the authoritative case
and segmentation, validate route/body case identity, apply this binding check,
and reuse current-source/stale guards. Never trust a client hash as proof.

### Provenance and result states

`AnalysisProvenance` contains contract version, source reference, source geometry,
versioned method, optional checkpoint SHA-256 and timezone-aware creation time.
Geometry and method may remain null for unavailable/not-performed results; do
not invent a method or geometry to fill them. Completed results require both.
It carries no private storage/checkpoint path. A hash identifies an artifact;
it does not establish training history or method validity.

Example future unavailable result, again synthetic and **not returned by any
Phase-1 endpoint**:

```json
{
  "contract_version": "1.0",
  "analysis_id": "12345678-1234-4567-890a-123456789abc",
  "state": "unavailable",
  "provenance": {
    "contract_version": "1.0",
    "source": {
      "case_id": 1,
      "image_reference": "case-volume",
      "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "parent_segmentation_result_id": "12345678-1234-4567-890a-123456789abc"
    },
    "geometry": {
      "shape": [10, 20, 30],
      "array_axis_order": "nifti_i_j_k",
      "world_convention": "RAS",
      "world_unit": "mm",
      "affine": [[0.5,0,0,10],[0,1,0,20],[0,0,2,30],[0,0,0,1]]
    },
    "method_id": null,
    "method_version": null,
    "checkpoint_sha256": null,
    "created_at": "2026-10-31T00:00:00Z"
  },
  "lesions": null,
  "unavailable_reason": {"code":"not_integrated","message":"Example provider is not integrated."}
}
```

| Analysis state | Lesion list | Reason |
|---|---|---|
| `not_performed` | `null` | Required |
| `unavailable` | `null` | Required |
| `failed` | `null` | Required |
| `queued`, `running` | `null` | None; no result yet |
| `completed` | Required list, possibly `[]` | None |

Only a genuinely completed run may have an empty lesion list. It means the
method returned no candidates, not a certified absence of disease. These are
data contracts; no jobs, transitions or records are created in Phase 1.

### Lesions, measurements and unavailable values

`LesionResult` has a unique lesion UUID, optional vessel label/anatomical text,
location or localization-unavailable reason, measurements, severity and an
explanation reference. Multiple lesions are supported. Vessel names are not
inferred from case-level region metadata.

Measurements distinguish `reference_diameter`, `minimum_lumen_diameter` (mm)
and `percentage_narrowing` (percent). Each measurement contains:

- `value`, `unit`, `unavailable_reason`;
- method identifier/version, optional definition and reference-region description.

For missing measurements, `value` is `null` with a structured reason; never use
zero as a substitute. Supplied values must be finite, nonnegative and have method
provenance. Percent values are bounded to 0–100 and require `definition`.
No percentage formula is selected or calculated in Phase 1. Before activation,
the method's definition must specify its exact mathematical formula, diameter-
versus-area convention, denominator, reference-region selection and failure
conditions. Numerical schema validation is not clinical measurement validation.

Severity is either a category plus versioned methodology or `null` with a reason.
No category vocabulary, thresholds, classifier or confidence score is invented.
The integration must agree on a validated vocabulary before activating severity.

Reason codes: `not_implemented`, `not_integrated`, `disabled`, `not_run`, `failed`,
`not_provided`, `not_applicable`, `unsupported_geometry`, each with a message.

### Coordinates and geometry

- Voxel indices are zero-based voxel centres in original NIfTI array `i,j,k`
  order, explicitly `nifti_i_j_k`; they are not assumed anatomical screen axes.
- World positions declare RAS and mm. The affine maps voxel centres into that
  convention. Coordinates must be finite, in bounds and consistent with the
  declared affine (numerical comparison: absolute 1e-4 mm, relative 1e-6).
- Optional slice axis/index refers to the original array axis and selected voxel,
  not the viewer's resliced axial/coronal/sagittal display indices.
- Geometry includes shape and a finite invertible homogeneous 4×4 affine.
  Providers must verify against the authoritative NIfTI and preserve source
  identity. Convert declared spatial units explicitly; unknown units must not
  silently become mm. This contract does not implement conversion/resampling.
- Matching dimensions, headers or schema acceptance alone do not establish
  anatomical registration. Preserve existing viewer geometry rejection rules.

### Explanation artifacts

An explanation is an opaque artifact UUID plus versioned method, explained target,
source hash and geometry, or `null` plus a reason. A populated reference must match
the analysis source and geometry. Future artifact endpoints must authenticate and
authorize retrieval; no such endpoint or artifact generation exists in Phase 1.
Resampled explanation grids would need an explicitly reviewed contract extension.

An attribution map is not calibrated confidence, and a binary segmentation is
not an explanation. Method/target choice, normalization, legend and interpretation
need separate implementation and validation before visualization is enabled.

## Frontend and verification

`/cases/:id/stenosis` is a case-reader page reached through the existing case tabs.
It loads the shared-client capability API and shows loading, verified information,
unavailable reasons, errors/retry and existing session-expiry behavior. Capability
errors never become an empty success. Existing segmentation remains separately
linked. Styling uses existing shell/cards/tokens; the viewer is untouched.

Unit tests are included in `npm test`; browser tests are in
`frontend-react/tests/e2e/stenosis.spec.js`. Focused backend tests are in
`backend/tests/test_stenosis_contract.py`. For a database-free local run, use
`--noconftest` and isolated process settings (`TESTING=true`, `DATABASE_URL=sqlite://`,
a generated test-only `SECRET_KEY`, temporary `UPLOAD_DIR`/`OUTPUT_DIR`) with
`python -B -m pytest --noconftest -p no:cacheprovider tests/test_stenosis_contract.py`.
The tests override `get_db` with a session double; no application database is used.
Normal backend conftest contains migration/drop fixtures: do not invoke it against
the developer database. Phase 1 requires no migration or new dependency.

Later phases own durable lifecycle/persistence, worker integration, real lesion
analysis, measurements, severity, explanations, analytics and stenosis reports.
