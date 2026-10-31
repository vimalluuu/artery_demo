# Stenosis lifecycle infrastructure — Phase 2, contract 1.0

Phase 5 adds optional date/status/method filters to history without changing its
default all-time behavior, plus [operational analytics and research reports](stenosis-analytics-reporting-v1.md).

This phase adds durable job acceptance/history/status infrastructure. **No
production stenosis provider, dispatcher, result store or worker is registered.**
The Phase-1 capability endpoint and all nine unavailable/not-integrated states
remain unchanged. Neither lifecycle persistence nor segmentation enables stenosis.
No medical processing runs inside the HTTP request or a FastAPI background task.

## Persistence and deployment prerequisite

`StenosisAnalysisJob` / `stenosis_analysis_jobs` stores:

- UUID, case/parent segmentation/requesting user, contract version;
- logical `case-volume` source reference, source SHA-256;
- method/version and optional checkpoint SHA-256;
- status and created/updated/started/completed/failed timestamps;
- safe failure code/reason;
- user/case-scoped idempotency key and normalized request fingerprint;
- hashed worker claim token, lease deadline, optional durable result UUID.

There are no image payloads, medical outputs, measurements, filesystem paths,
exception messages, stack traces or credentials in this table. A claim token is
returned only to the internal worker caller, never through HTTP.

Migration `0006_stenosis_jobs` follows `0005_segmentation_results`. It creates
only this table and its history/status indexes. Existing case/segmentation tables
are not altered. Foreign keys use RESTRICT for case, parent segmentation and user:
their deletion/key changes cannot orphan accepted provenance. Parent case/source
membership is also checked by the service; there is no client-trusted association.
Direct privileged SQL changes are outside the application's authorization model.

Database checks constrain lifecycle states, safe failure codes, hash lengths,
contract/source reference, result references, claim fields and state timestamps.
`(created_by, case_id, idempotency_key)` is unique. History is indexed by case,
creation time and UUID; status queries have a status/creation-time/UUID index.

**Do not apply this migration to a development/production database as part of
testing.** Deployment requires a separately authorized migration through the
existing Alembic process (`alembic upgrade head` from `backend`). Before applying
it, job history/status requests may return the existing sanitized database 503;
the UI shows an error/retry, never a fabricated empty history. Valid start requests
with no runtime are rejected before querying/inserting the job table.

Downgrade drops the two indexes, then the job table. It deletes stenosis lifecycle
history, but retains cases, segmentation records and external files. Do not use a
downgrade as a job-retention or result-artifact cleanup procedure.

## HTTP contracts

All routes use `/api/v1` and the existing database-authoritative authentication.
There is no global job lookup route that bypasses case scoping.

| Method/path | Authorization | Response |
|---|---|---|
| POST `/cases/{case_id}/stenosis/analyses` | Clinician/Admin | 202 newly queued job; 200 existing job replay; 409 unavailable/stale/key conflict |
| GET `/cases/{case_id}/stenosis/analyses?limit=20&offset=0` | All four case-reader roles | 200 `AnalysisHistoryResponse` |
| GET `/cases/{case_id}/stenosis/analyses/{analysis_id}` | All four case-reader roles | 200 `AnalysisJobResponse`; 404 wrong case/missing job |

Successful responses have `Cache-Control: no-store`. Missing/invalid/inactive/
revoked sessions receive 401; non-writer creation receives 403. Malformed bodies,
UUIDs, keys or pagination receive 422. Missing cases/parent segmentations receive
404. Existing stale-segmentation errors remain 409 using existing API conventions.
Do not infer ownership restrictions absent from the shared-workspace case policy.

Creation requires `Idempotency-Key`: 16–128 ASCII letters, digits, `_` or `-`.
The existing CORS allowlist adds only this request header; origins and role policies
are unchanged. Example request (synthetic identifiers):

```http
POST /api/v1/cases/1/stenosis/analyses
Authorization: Bearer <current session>
Idempotency-Key: 12345678-1234-4567-890a-123456789abc
Content-Type: application/json

{"contract_version":"1.0","source":{"case_id":1,"image_reference":"case-volume","source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","parent_segmentation_result_id":"12345678-1234-4567-890a-123456789abc"}}
```

**Current normal behavior:** after validating the current case/segmentation/source,
HTTP 409 with this detail object; no job or lifecycle event is created:

```json
{"detail":{"contract_version":"1.0","code":"capability_unavailable","capability_id":"stenosis_detection","message":"No verified stenosis provider, durable dispatcher and result store are registered and ready."}}
```

Structured lifecycle conflict codes also include `source_mismatch`,
`idempotency_conflict`, `acceptance_conflict`, `invalid_association` and worker-only
transition/claim/result errors. Existing clients still receive conventional HTTP
exceptions; the dedicated adapter extracts the structured safe message/code.

History is an envelope: `contract_version`, `case_id`, `items`, `total`, `limit`,
`offset`, `has_more`. Limit is 1–100; offset is nonnegative; ordering is descending
creation time, then descending UUID. An actual empty response is:

```json
{"contract_version":"1.0","case_id":1,"items":[],"total":0,"limit":20,"offset":0,"has_more":false}
```

It means no persisted jobs, not a failed analysis or absence of stenosis.

Job responses expose `analysis_id`, `case_id`, `status`, provenance, timestamps,
safe `failure` or null, `stale`, and `result_reference` or null. They do not expose
request keys, claim tokens/hashes, storage paths or lesions. Source and method
provenance reuse the Phase-1 contracts. Job provenance does not duplicate source
geometry; actual result geometry must later be verified through the result store.

Example of a **future accepted** job shape, not current provider availability:

```json
{
  "contract_version":"1.0",
  "analysis_id":"23456789-1234-4567-890a-123456789abc",
  "case_id":1,"status":"queued",
  "provenance":{
    "contract_version":"1.0",
    "source":{"case_id":1,"image_reference":"case-volume","source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","parent_segmentation_result_id":"12345678-1234-4567-890a-123456789abc"},
    "geometry":null,"method_id":"example-provider","method_version":"v1",
    "checkpoint_sha256":null,"created_at":"2026-10-31T00:00:00Z"
  },
  "created_at":"2026-10-31T00:00:00Z","updated_at":"2026-10-31T00:00:00Z",
  "started_at":null,"completed_at":null,"failed_at":null,"failure":null,
  "stale":false,"result_reference":null
}
```

There is no result-download or lesion-result endpoint in Phase 2.

## State machine and failure policy

Persisted jobs use only the execution subset of the unchanged Phase-1 states:

```text
queued ──claim──> running ──persisted-result verification──> completed
   │                │
   └──failure───────┴────────────────────────────────────> failed
```

`not_performed` and `unavailable` are not fake accepted rows. They describe absent
execution/capabilities and remain distinct from queued, running and completed.
Completed and failed are terminal: no reset, duplicate completion, implicit retry
or overwrite API exists. A queued job may fail before running. A running job needs
its worker claim token for failure, heartbeat and completion.

Failure codes/messages are centrally allowlisted: `source_changed`,
`provider_changed`, `provider_error`, `lease_expired`, `dispatch_failed`. Arbitrary
provider exception text is rejected, not stored or returned. Controlled audit
events use the existing actor/case resource convention; lifecycle logs identify
job/case UUID/ID without image data or raw exceptions.

## Transactions, duplicates and source integrity

Acceptance locks the case row, validates the existing current segmentation and
source hash, applies the pure Phase-1 association check and verifies runtime
readiness. It persists/commits before replying 202. No model call occurs.

The request fingerprint hashes canonical JSON of the validated version/source
request. The idempotency key and chosen method are not part of that fingerprint.
The original method/provenance are never replaced on replay.

- Same user/case/key/request: return the same job with 200, including a failed or
  completed job. This does not retry it.
- Same scope/key with a different request: 409.
- Concurrent duplicates: case locking plus the database unique constraint protect
  insertion; a uniqueness-race loser reloads the existing record.
- Different users/cases have independent key scopes.
- Runtime unavailability and stale source validation take precedence over replay;
  those requests still return 409 without creating anything.
- A deliberate new API request may use a new key. There is no automatic retry or
  idempotency expiry policy. The current UI retains its key for the same user/source
  in sessionStorage; it does not silently mint a new key after failure.

History takes a shared case lock so page membership/count cannot race acceptance.
Worker claims lock the job row. Only one claimant can transition queued→running.
A cryptographically random token is returned internally; only its hash is stored.
Source association/fingerprint is rechecked before claim and completion, and
current source freshness is exposed on history/status. A changed, missing or
unverifiable input fails an active job with `source_changed`, preserving original
provenance. GET does not silently mutate queued jobs.

The existing fingerprint cache relies on observable file versions and application-
owned storage; it is not protection against a privileged attacker forging file
metadata. Future providers must use verified/pinned input bytes during execution,
then invoke the completion freshness guard. No new image-reading algorithm is
implemented here.

## Provider/dispatcher boundary and restart recovery

`get_runtime()` is the reviewed composition point and currently returns None.
`ExecutionRuntime` separates:

1. Provider identity and future `execute(analysis_id, source)` operation.
2. A durable dispatcher reporting genuine consumer readiness.
3. A transaction-aware persisted result store.

Nothing registers a fake, spawns a thread/process, uses BackgroundTasks, or adds a
broker. Queued database rows are the durable dispatch boundary. A later external
worker must discover queued rows and call the centralized claim service; multiple
workers must use the same PostgreSQL database. Runtime registration and Phase-1
capability activation both require a reviewed real integration, not an env toggle.

Worker lease defaults to 300 seconds; trusted callers may choose 30–86,400 seconds.
Workers heartbeat before expiry. Expired workers cannot complete or revive a job.
`fail_expired_jobs()` is an explicit worker/startup recovery operation: it marks
expired running rows failed using locked batches and never requeues them. No
recovery daemon is launched by FastAPI. Production deployment must schedule this
operation and implement real dispatcher readiness/health before enabling execution.

`complete_job()` requires a matching, Pydantic-valid **persisted** completed result
loaded through the same database transaction: job/source/method/checkpoint and
source geometry must agree. Missing/invalid/mismatched results cannot complete the
job. Phase 3 supplies `SQLResultStore` and the atomic internal
`persist_completed_result()` writer, documented in [stenosis-results-v1.md](stenosis-results-v1.md).
The lifecycle table retains only the result UUID. Result and lesion rows are
immutable and locked during completion. Runtime registration still returns None;
normal production completion remains unavailable. Phase-2 lifecycle tests retain
their separate persisted test-only result table; Phase-3 tests use the canonical store.

## Frontend behavior

The existing Stenosis page retains capability information and adds paginated
history plus case-scoped selected-job details (`?analysis=<uuid>`). It displays
timestamps, status, method/version, safe failures and stale-input warnings.
Completed lifecycle status does not expose or certify lesion findings.

History/details poll at five-second intervals only while their visible records
are queued/running. Requests coalesce; accepted-submission refresh waits behind
any older request. Timers and requests are cancelled on unmount; late responses
are ignored. Failed refreshes retain valid history and show Retry. Navigation or
reload retrieves authoritative history again. Jobs on other pages are refreshed
when that page is opened; there is no global background polling loop.

The start action remains disabled with current capabilities. A future allowed
writer selects a current segmentation, submits the source and stable key, then
refreshes server history. Duplicate clicks coalesce in addition to server-side
uniqueness. Network ambiguity is never presented as accepted execution. Existing
authentication/session expiry, shared Axios and styling remain in use.
If a request identity cannot be saved in session storage, submission stops before
any POST; the UI does not claim that an unsaved identity can be safely reused.

## Verification and limits

Backend tests require disposable PostgreSQL for migrations, row locks, uniqueness
and concurrent claims; SQLite is not treated as equivalent evidence. Test fakes
are confined to tests/dependency overrides and cannot activate production.
The existing conftest drops/migrates within its generated test schema: only set
TEST_DATABASE_URL to a verified disposable database. Never run it against a
developer/production database. Migration testing must remain isolated.

No training, real inference, clinical validation or model-output evaluation is
part of Phase 2. Phase 3 adds result storage/presentation and localization
infrastructure. Real vessel/lesion methods, measurement calculations, severity,
explanation generation, analytics and medical reporting remain future work.
