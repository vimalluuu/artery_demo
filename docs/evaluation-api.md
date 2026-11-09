# Offline evaluation API

This is an authenticated import/read API, independent of the dashboard. It never
executes evaluation, training, segmentation or stenosis inference. No records or
metrics are seeded. Imported results remain assertions of their offline source;
hash/schema verification does not establish clinical validity or independently
verify the checkpoint weights or the dataset split workbook.

## Storage and authorization

The prior backend has case-volume records but no generic evaluation-file or
model registry. Migration `0009_evaluations` adds five tables: stored evaluation
artifacts, model identities, training-run references, evaluations, and evaluation
cases. The artifact ID is a real UUID row, bound to stored JSON bytes by SHA-256
and size. A database unique constraint permits one evaluation per artifact. A
composite foreign key preserves the model/run/checkpoint association. Case IDs
are foreign keys to existing cases; external dataset IDs are separate fields.

`DataScientist` and `Admin` may upload/import. These are the existing database
role values corresponding to data scientist/admin; no new role aliases or auth
system are added. Every GET uses the existing `AuthenticatedCaseReader`, and
every member case is checked with the shared protected segmentation case lookup.
Currently all four canonical roles may read existing cases; there is no owner ACL
in this application. No second case-permission policy is introduced. Reads fail
closed rather than silently returning a partially authorized evaluation.

## Upload, then import

1. `POST /api/v1/evaluations/artifacts`, multipart field `file`: upload one
   `offline-evaluation/1.0` JSON document, at most 2 MiB. Unknown fields, duplicate
   JSON keys, nonfinite numbers, unsupported metrics and invalid case/provenance
   identities are rejected. Filenames never become storage paths; the server uses
   UUID filenames under `UPLOAD_DIR/evaluation-artifacts`. No public mount or
   client-supplied path/URL is accepted. The response gives `id`, SHA-256, size,
   timestamp and schema version, without filesystem paths.
  Before multipart parsing, route-scoped ASGI admission buffers at most
  **2,162,688 bytes (2112 KiB)**: 2 MiB JSON plus 64 KiB multipart framing. It
  counts received bytes even without Content-Length (or with an understated
  length) and rejects oversized bodies with 413 without invoking the parser.
  The in-repository Nginx config has matching exact-location limits for this
  endpoint and its trailing-slash form. Other routes retain their existing
  large medical-upload allowance. Small requests retain the existing 401/403
  behavior; oversized unauthenticated requests receive 413 before parsing.
2. `POST /api/v1/evaluations/import`, JSON with `source_artifact_id` (that UUID)
   and `metadata` (the same metadata object as the stored document). The server
   reads/hashes/parses one bounded byte snapshot, verifies every member case and
   persists actual results. New import: 201. Exact repeat: 200 and the same ID.
   Conflicting metadata, altered source bytes or a conflicting checkpoint for an
   existing training-run identity: 409. Unknown artifact: 404; malformed UUID: 422.

OpenAPI exposes the exact request and response schemas. The document has:

- `schema_version`: `offline-evaluation/1.0`.
- `metadata.model`: stable `id`, `architecture`, `display_name`.
- `metadata.checkpoint`: full `sha256`, explicit `training_run_id`, optional
  `reported_training_steps`. Filename/architecture/step labels never substitute
  for a weight hash. Historical step-700 and three-step smoke runs require their
  own actual hashes and run identities. Unknown training steps remain null.
- `metadata.threshold`: the actual offline segmentation threshold, in [0,1].
- `metadata.validation_split_source`: dataset identifier, `manifest_sha256`,
  optional `workbook_sha256` and `sheet`, `split_column`, `split` (`Val` or
  `Validation`). Testing is not an accepted validation import label. This records
  supplied split provenance; it does not infer assignments from case numbers.
- `metadata.metric_definitions`: version `binary-voxel/1.0`, explicit
  `reference_foreground` and `prediction_foreground` descriptions, and
  `zero_denominator: "null"`.
- `metadata.provenance`: nonempty, finite JSON source/method/version evidence.
- `cases`: nonempty unique membership, at most 1000 rows. Each has existing
  `case_id`, `dataset_case_id`, `reference_sha256`, `prediction_sha256`, and
  `metrics` with all four keys `dice`, `iou`, `precision`, `recall` (number or
  explicit null). Optional `confusion_counts` has TP/FP/FN and optional TN;
  provided metrics must agree within 0.000005 absolute rounding tolerance.
  Optional `exclusion_reason` preserves the member while excluding it from
  aggregation. Null metrics are unavailable, not placeholder scores.

No historical CSV is silently adapted or assigned database case IDs. Producers
must explicitly map their actual case membership and emit the versioned JSON.

## Read models

- `GET /evaluations/{id}/summary`: `headline_aggregation` is
  `macro_unweighted_per_case`. `macro_metrics` is the arithmetic mean of defined
  case scores, with `macro_denominators` giving defined/undefined case counts per
  metric. Excluded cases stay in membership/exclusions. No included/defined
  values gives null, never zero or a demo Dice.
- `pooled_micro_metrics` is separate: sum included TP/FP/FN then apply the
  formulas. It is unavailable if any included case lacks counts. A zero
  denominator gives null. Formulas: Dice=2TP/(2TP+FP+FN), IoU=TP/(TP+FP+FN),
  precision=TP/(TP+FP), recall=TP/(TP+FN).
- `GET /evaluations/{id}/cases`: original case scores, counts, exclusions,
  metric definitions and source/checkpoint/split provenance.
- `GET /evaluations/compare?ids=id1,id2`: 2–10 distinct IDs. All case sets must
  match exactly, including excluded members, or 409. Source provenance remains
  attached to each evaluation. Differences in definitions, reference hashes and
  exclusions are explicitly flagged; exact IDs alone do not prove scientific
  comparability.
- `GET /models/{id}/runs?limit=20&offset=0`: actual stored evaluation headers and
  related training-run references. `limit` is 1–100 (default 20); `offset` is
  0–1,000,000. Evaluation ordering is ascending `(created_at,id)`, including a
  stable ID tie-breaker. SQL excludes evaluations having any member outside the
  shared protected-case lookup's readable-case scope **before** applying the
  offset and limit (including the look-ahead row), then loads only member IDs.
  The existing role/case policy is unchanged; the SQL scope and protected lookup
  share one implementation. The supporting index uses `(model_id,created_at,id)`. Training-run
  references are distinct related runs for the visible page, ordered by
  `(created_at,id)` and bounded by the same limit; they may recur on later pages.
  `record_origin` identifies imported references, not locally executed training.

  `pagination` contains `limit`, `offset`, `next_offset`, the additive boolean
  `offset_limit_reached`, `returned_evaluations`, and `returned_training_runs`.
  Offsets and continuations count only authorization-eligible evaluations;
  inaccessible records affect neither page contents nor continuation metadata.
  No global total or skipped-ID list is exposed. A run whose original source
  evaluation is inaccessible is also omitted. These are offset pages, not a
  cross-request database snapshot.

  `next_offset` is null at the end. If a continuation would exceed 1,000,000,
  it is also null but `offset_limit_reached` is true: further eligible history
  exists beyond the supported continuation, and completeness is not claimed.
  Otherwise that flag is false. Continuations never exceed the router's shared
  bound and are never clamped to an overlapping page.

  History never reconstructs full metric/section payloads: it verifies a private
  header-and-membership digest and the existing case access checks, with a
  request-local cache of checked cases. Full result reads separately verify the
  complete import digest and linked mask evidence. Corrupt header/member evidence
  causes 409, not partial success. Both returned rows and the look-ahead row are
  checked again; an access change fails the request without pagination rather
  than skipping rows after SQL. No permissions are cached across requests.

All reads are authenticated/audited with no-store/nosniff headers. Stored case
payloads and metadata are checked against their canonical import digest on read;
missing or inconsistent evidence fails closed. History uses the narrower digest
described above. Reads do not rehash CT volumes or invoke model runtimes.

## Stenosis evaluation resource

`GET /stenosis/evaluations/{id}/cases/{case_id}/sections` uses the same stored
evaluation membership and authorization. Optional case `mask_provenance` requires
`origin` (`reference_annotation` or `model_prediction`) and mask SHA-256 matching
the corresponding case artifact. Predictions also require the evaluation's
checkpoint SHA-256. If an existing `segmentation_result_id` is supplied, its
actual record must match case, checkpoint **and threshold**, and the actual
UUID-owned `prediction_mask.nii.gz` bytes must match the declared prediction-mask
SHA-256. The existing result model has no stored prediction-mask hash, so the
shared file-version/checksum service verifies the real artifact; no hash field is
invented. That bounded checksum cache relies on the existing application-owned
storage policy and observable file-version changes. Missing thresholds,
missing/unreadable masks or contradictions cause
409. Unlinked offline mask hashes remain source assertions, not proof of a linked
server artifact. Reference-derived masks cannot claim prediction identifiers.

Optional `sections` contains unique `section_id`, `section_index`, original
`source_status`, and optional exclusion reason. This contract deliberately has
no quantitative stenosis/severity/confidence fields. The server always reports
`measurement_unavailable_no_validated_gate`: no validated gate registry exists.
The original diagnostic source status is separate from that availability status.
Missing section evidence gives an explicit unavailable section-data status and
an empty list, not invented section records. A source claiming "valid" cannot
activate quantitative measurements. This route does not run the offline method.

## Migration and validation

Apply `alembic upgrade head` from `backend` only after deployment/database review.
This implementation did **not** migrate the application database. Downgrading
to `0008_stenosis_explanations` deletes imported evaluation/registry history and
artifact records in child-first order; it preserves cases and filesystem files.
The still-uncommitted, unapplied migration 0009 now also includes the history
digest column and history index. It is not safe to treat an already-applied early
copy as upgraded automatically: such a deployment would need a reviewed follow-up
migration. No application database migration was performed here.

Upload cleanup removes a UUID-owned file only when failure is known to precede
any commit attempt (including flush/validation failure). Once commit is attempted,
refresh failure or an uncertain commit outcome leaves the file in place and
rolls back any remaining transaction. This may leave an orphan when commit did
not succeed; it prevents deleting bytes referenced by a successful commit.
The controlled warning records the artifact UUID for administrator reconciliation.
After the database is healthy, check that UUID's artifact row and any references
and compare SHA-256/size before deciding whether to retain/recover it or remove a
confirmed unreferenced file. No automatic orphan cleanup or blind retry deletion
is provided; absence must be confirmed, not inferred from a connection error.

Tests use synthetic JSON and the existing isolated SQLite fixture by default.
The suite also compiles PostgreSQL migration DDL without a database connection.
No real checkpoint, dataset, cache, clinical output or frontend is modified.

## Implementation verification

Work is isolated on `codex/evaluation-api`, based on fetched `origin/main`
`5bc9f13cfe92460245931d8937b8e867f0373438`, in
`C:/Users/vimzz/.codex/worktrees/evaluation-api/artery_demo`.
The original research checkout was not switched or edited.

Final hardening verification, from this worktree's `backend`, using the existing
Python 3.14 installation:

```text
python -B -m pytest -q -p no:cacheprovider tests
```

- With `TEST_DATABASE_URL` unset (isolated SQLite fixture): **444 passed,
  176 skipped**, 40.71 seconds. Skips include PostgreSQL-only tests.
- With `TEST_DATABASE_URL` pointing only to a newly initialized temporary
  PostgreSQL 18 cluster and `PGTZ=UTC`: **614 passed, 6 skipped**, 161.70 seconds.
  The suite includes the original **42 evaluation tests** and **39 hardening
  tests**, including deterministically synchronized concurrent imports.
  The six skips are three optional PyTorch/module checks, two Windows symlink
  permission checks, and the opt-in live browser acceptance check. The cluster
  was stopped and its owned temporary directory removed afterward.

During the previous hardening run, the known timezone-sensitive failures were
separately reproduced against the
untouched original backend on a disposable Asia/Kolkata PostgreSQL session:
**2 failed, 1 warning**, 1.47 seconds, with this exact command:

```text
python -B -m pytest -q -p no:cacheprovider --tb=short tests/test_stenosis_jobs.py::test_acceptance_history_status_and_idempotent_replay tests/test_stenosis_jobs.py::test_failure_is_sanitized_preserves_provenance_and_replay_does_not_retry
```

Both assertions compare equivalent UTC `Z` and `+05:30` timestamp strings. Their
test, service and schema files were verified byte-identical to the base commit
before that baseline run. No job/timezone implementation was changed. UTC is an
explicit test-session setting, not a deployment configuration change. The three
existing httpx/Starlette deprecation warnings remain in the full suites.

The new regressions cover rejection before multipart parsing (declared,
understated and absent Content-Length), a 2 MiB valid file, tiny/empty streamed
chunks, unchanged unrelated upload limits, all four commit-fault outcomes,
linked case/checkpoint/threshold/mask evidence, default/max/multiple history
pages, SQL bounds without case-payload reconstruction, request-local case
authorization, inaccessible source filtering, header corruption and the index.
The second-review regressions add limit-1 hidden-only, denied-tail and mixed
histories, both returned-row and look-ahead access changes, and the offset cap.
The cap test checks the real 1,000,000 router boundary, then uses a tiny synthetic
cap to exercise a nonempty final window without creating a million records.
The concurrency test requires both absent lookups before either import can
continue and verifies the unique-insert recovery path, the shared source artifact
ID in both responses, and the source artifact ID on the single stored evaluation.

The Nginx limits were inspected and covered by a configuration regression test;
no live Nginx/container deployment test was performed. Migration 0009 was used
only in disposable test databases. No application database was accessed.

Changed files:

- `backend/app/models/evaluation.py`: artifact/model/run/evaluation/case records.
- `backend/app/schemas/evaluation.py`: versioned input and typed output contracts.
- `backend/app/services/evaluations.py`: storage, integrity, import and read models.
- `backend/app/core/evaluation_upload.py`: total-body admission before parsing.
- `backend/app/routers/evaluations.py`: six requested routes plus the necessary
  stored-JSON upload route.
- `backend/app/routers/segmentation.py`: shared readable-case SQL scope, also used
  by its existing protected case lookup; role and case permissions are unchanged.
- `backend/migrations/versions/0009_evaluations.py`: new tables/constraints,
  history digest/index and child-first downgrade.
- `backend/app/main.py`, `backend/app/models/__init__.py`: router/model registration.
- `backend/tests/test_evaluations.py`: 42 synthetic API/integrity/migration tests;
  synchronized concurrency and filtered-history assertions.
- `backend/tests/test_evaluation_hardening.py`: 39 focused regression tests.
- `backend/tests/test_stenosis_acceptance.py`: append revision 0009 to the
  existing exact migration-chain assertion; no assertion was removed or weakened.
- `docs/evaluation-api.md`: contract, setup, limitations and verification.
- `deploy/nginx.conf`: exact evaluation-upload limits, preserving other routes.

This second-review correction changed only the evaluation router/schema/service,
the shared segmentation case lookup, the two evaluation test files and this
document (seven files). It did not change migration 0009 or any dependency.
