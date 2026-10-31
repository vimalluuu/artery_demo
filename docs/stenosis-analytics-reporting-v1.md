# Stenosis operational analytics and research reports — version 1.0

Phase 5 extends the existing dashboard, case history and export/report workspace.
All operational numbers come from persisted records. Generic case workflow
`Complete` is never used as stenosis completion. There are no synthetic production
records, medical algorithms, model-performance charts or newly enabled providers.
`get_runtime()` remains `None`. No new table or migration is needed.

## Definitions and denominators

The cohort is persisted **jobs created** in the selected inclusive UTC date range,
optionally filtered by exact case, authorized patient, status, method and version.
The default is the most recent 30 UTC calendar dates; maximum window is 366 days.
More than 2,000 matching jobs causes 413 `analytics_scope_too_large`, never partial
counts. Index pages remain bounded at 100 jobs; the UI uses ten per page.

| Metric | Unit/source and denominator |
| --- | --- |
| `jobs.total`, queued/running/completed/failed | Unique job IDs in cohort, grouped by current lifecycle status. The four states sum to total. Completed here means lifecycle, not verified current findings. |
| `current.analyses` | One immutable completed result per job, eligible under the checks below. This plus excluded stale/unverified/integrity counts equals cohort completed jobs. |
| `current.unique_cases` | Distinct case IDs across eligible results. Multiple lesions or real repeat executions do not inflate it. |
| `current.unique_patients` | Distinct opaque subject IDs across eligible cases, only for existing clinical writers; otherwise null with reason. No patient directory names/codes/notes are exported in reports. |
| `current.lesions` | Actual lesion rows in eligible results, checked against result finding count. Separate genuine executions retain separate records; this is not unique anatomical disease burden. |
| `current.analyses_with_lesions` | Eligible analyses with finding count greater than zero. |
| `current.cases_with_lesions` | Distinct eligible cases containing at least one finding. |
| `current.zero_finding_analyses` | Eligible completed results with exactly zero lesion rows. Not absence of stenosis; not an unexecuted or unavailable job. |
| Measurement `available` / `unavailable` | Presence counts per field across eligible lesion rows, denominator `current.lesions`. Supplied zero is available. Null is unavailable. No numeric mean, narrowing derivation or pooled method interpretation. |
| `supplied_severity_labels` | Count of eligible lesions with a supplied category. No agreed taxonomy exists, so `severity_distribution=null`, status unavailable; labels are not combined or inferred from percentages. |
| `current.explanation_artifacts` | Number of recorded explanation metadata rows associated with eligible results; not downloaded file integrity or explanation correctness. |
| `current.analyses_with_explanations` | Distinct eligible result IDs with explanation records. |
| `anatomy` | Lesion row counts for exact supplied vessel labels, separated by analysis method/version. Missing labels are not guessed. |
| `explanation_methods` | Metadata record counts grouped by exact attribution method/version. |
| Trends | Observed UTC **job-creation days**, split by current lifecycle state. Not completion-event throughput, pipeline duration, inference latency or performance. No missing timestamp is inferred. |

No metric uses client totals, case status, repeated report views or report downloads
as a completed-analysis event. Idempotency and unique job/result identities remain
the earlier phases' authority. There is no redundant persistent count/report table.

## Eligibility, freshness and coherent reads

Basic status/unique/count/group/trend operations aggregate in SQL. Eligibility
checks scan at most 2,000 lightweight completed job/case/parent/result metadata
records, **not full lesion/result payloads**: verify association, typed provenance,
method/checkpoint identity, geometry fingerprint, parent geometry, source hashes,
actual lesion row count and lesion payload UUID agreement. The trusted typed writer
plus immutable database records remains the ingestion boundary. Reports perform
the existing complete result/lesion Pydantic validation for the requested analysis.

Statuses excluded from current findings:

- **Integrity error:** missing/inconsistent result, parent, provenance or counts.
- **Stale:** parent/source path/hash mismatch, missing file or changed observed
  file version. Changed file versions require explicit source verification.
- **Unverified:** no matching observation in this process's bounded cache.

Dashboard requests do **not** decode NIfTI or read CT bytes to populate a cold
checksum. They stat the application-owned source and consult an observation of
the existing SHA-256 verification keyed by device/inode/size/mtime/ctime. The
observation cache is bounded to 128 paths and updated only by explicit checksum
verification. Ordinary case result/source/report retrieval can verify a cold
source; then refreshing analytics on that process can include matching records.

Cold start, eviction or another worker/process may therefore produce **unverified**
exclusions, not proof of stale data and not a negative finding. The cache is not
shared among workers. Changed content with a new file version is excluded even
when its path stays the same; it is never silently rebound. Stat/version checks
are not tamper-proof against a privileged storage attacker, as documented by the
existing fingerprint service. Keep storage private. Dashboard eligibility is an
observational freshness policy, not independent anatomical registration.

Production routes use a separate short-lived domain session with PostgreSQL
REPEATABLE READ, preserving a coherent database snapshot without rolling back
the authentication/audit session. Audits commit on the original request session.
No domain rows are written. A filesystem can change after any snapshot; timestamps
identify when a report/summary was generated. No lifetime freshness guarantee.

## Routes, filters and authorization

All paths have `/api/v1` prefix:

| GET route | Contract |
| --- | --- |
| `/stenosis/analytics/summary` | `AnalyticsSummary`, metric definitions, current/excluded counts, availability, applied filters and embedded trends |
| `/stenosis/analytics/trends` | `TrendResponse`, daily creation cohorts and explicit UTC semantics |
| `/stenosis/analytics/analyses` | `AnalysisIndex`, stable creation-time/UUID descending order; limit/offset and result eligibility |
| `/cases/{case_id}/stenosis/analytics` | Same summary, bound to requested case; incompatible query case/patient gives 404 |
| `/patients/{patient_id}/stenosis/analytics` | Existing clinical writers only; patient-scoped summary |
| `/cases/{case_id}/stenosis/analyses/{analysis_id}/report` | Typed `StenosisReport` JSON snapshot |
| `/cases/{case_id}/stenosis/analyses/{analysis_id}/report.csv` | Protected CSV findings export for current completed reports only |

Summary/trend/index filters: `start_date`, `end_date`, `case_id`, `patient_id`,
`status`, `method_id`, `method_version`. Dates are inclusive UTC job-creation dates;
version requires a method. Invalid/inverted/overlong windows, malformed identity
filters and unknown statuses return 422. A query failure propagates as an error,
never a success with zero counts. Cohort limits return 413, not truncated totals.

Request examples (use the existing authenticated client's bearer session, never
put a token in a URL):

```http
GET /api/v1/stenosis/analytics/summary?start_date=2026-10-01&end_date=2026-10-31&status=completed
GET /api/v1/stenosis/analytics/analyses?case_id=1&method_id=provider_method&method_version=v1&limit=10&offset=0
GET /api/v1/patients/1/stenosis/analytics?start_date=2026-10-01&end_date=2026-10-31
```

The patient example requires an existing clinical-writer session. IDs/methods are
illustrative, not assertions that such records or a genuine provider exist. For a
returned analysis UUID, request its case-bound `/report` for versioned JSON or
`/report.csv` for eligible findings. Authorization failures remain HTTP errors.

CASE_READERS policy is reused: all existing reader roles can read authorized case
data under the application's current broad case-reader policy; no new tenant or
case-owner policy is claimed. Patient directory-level filters and distinct patient
counts are restricted to Admin/Clinician, matching existing patient APIs.
Researcher/DataScientist receive null patient counts with a reason and 403 on
patient filters/endpoints. Case reports expose only the opaque subject ID already
available through case reads, not patient display names, notes or directory codes.

Existing database-authoritative JWT/account validation rejects unauthenticated,
revoked and inactive sessions. Unknown/mismatched associations return 404; patient
authorization is checked before existence lookup. Successful reads/exports are
audited, no-store and nosniff. Reports contain no storage paths, claim tokens or
arbitrary private model metadata.

The existing case history route keeps its response contract and default all-time
behavior. It gains optional `status`, `start_date`, `end_date`, `method_id` and
`method_version`, with the same date/version validation (no automatic 30-day
window). Pagination count/page apply identical filters. URL parameters preserve
history filters/offset/selected analysis through refresh and navigation. Empty
filtered history says no matches, not that the case was never analyzed.

## Reports and export semantics

`StenosisReport` schema 1.0 includes generation time, opaque case/subject identity,
typed job/provenance, explicit report state, optional validated result/lesions,
explanation metadata and research limitations. The response distinguishes queued,
running, failed, stale, integrity error and completed results. Incomplete/stale/
inconsistent reports contain no findings. A current completed zero-lesion report
has a real empty result; it is not an unexecuted or unavailable analysis.

The case reporting landing page handles no selected/performed analysis and current
execution unavailability without generating a findings document. Completed reports
retain unsupported-viewer geometry reasons and all missing measurement/localization
reasons. Available measurements keep zero, units, method/version, definition and
reference region. Severity is reproduced with its supplied methodology, never
reclassified. Explanation records are metadata references, not rendered confidence
or correctness claims. No images/medical volumes are processed for reporting.

### JSON

The authorized typed report endpoint is the versioned JSON source. The frontend
refetches before saving/printing, allowlists report-level fields and serializes the
server's typed nested DTOs. Nulls/unavailable reasons, ISO timestamps, identities,
hashes and units are retained. It does not export arbitrary SQL JSON, storage paths,
worker tokens or pretend model metrics. A status-only report can be saved as JSON
without acquiring fake completed findings. Report refresh/export errors show an
error and do not save the error body as an artifact.

### CSV

One row is **one actual lesion**. Only current completed reports are eligible; the
server rechecks authorization/freshness on each export. Incomplete, stale or invalid
reports return 409 and the UI disables findings CSV. Completed zero-lesion exports
contain only column headers: no synthetic negative row. Use companion JSON for the
analysis-level zero-finding context. Filenames use the opaque analysis UUID.

Stable explicit columns are defined by `CSV_COLUMNS` in the reporting service:
schema/generation time, case/subject IDs, analysis/result/status/method/checkpoint,
source/parent IDs, completed timestamp, lesion/anatomy, original IJK and RAS-mm
coordinates, localization reason, each measurement's value/unit/reason/method/
version/definition/reference region, and supplied severity/method/version/reason.
Unavailable values are empty with their explicit reason columns. No arbitrary
metadata keys become columns. UTF-8 BOM, CRLF rows and standard quote escaping are
used. Text beginning with optional whitespace and `=`, `+`, `-`, `@` receives a
leading apostrophe to prevent spreadsheet formulas. Typed finite numeric values,
including negative world coordinates and zero measurements, remain numeric.

### HTML / Print / Save as PDF

Routes `/cases/:id/stenosis/report` and `/cases/:id/stenosis/report/:analysisId`
extend the existing case/report workspace. Print action re-fetches the authorized
snapshot before invoking `window.print()`. Users may choose browser Save as PDF.
**There is no server-generated PDF, PDF download API or new PDF dependency.**
Print CSS hides application navigation, actions and filters while preserving report
identity, warnings, units, tables and limitations. Tables use printable wrapping,
repeating headers and row-break protections rather than one huge clipped table.
Print layout was checked with browser print media; a physical print or a user's
native Save as PDF dialog was not independently exercised.

## Dashboard and limits

The original case workflow cards/chart/report exports remain. A separate dashboard
section adds authoritative stenosis cards, status chart with accessible text/counts,
UTC trend table, measurement presence table, method-separated label/artifact tables,
quality exclusions and paginated analysis/report links. It has date/case/status/
method filters and authorized patient filters. Loading and query errors are not
rendered as zeros. Unknown/unsupported severity and measurement summaries have
explicit notices instead of blank medical charts. Scrollable new tables are
keyboard accessible; filters/history state survive navigation through URLs.

Execution remains unavailable; reporting infrastructure does not supply genuine
lesions, severity, narrowing or explanations. Previous phase migrations must be
separately approved/applied to an application DB before these tables can be read.
Until then requests can fail honestly rather than displaying fabricated empty
data. Production performance/indexing for larger cohorts and a durable shared
freshness registry are future operational work. No clinical validation or model
comparison claim is made.

See [Phase-5 verification](stenosis-phase5-verification.md) for exact test commands,
actual counts, resolved failures, limitations and the complete file inventory.
