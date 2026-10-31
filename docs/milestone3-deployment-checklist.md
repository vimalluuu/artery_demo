# Milestone 3 — deployment gates (not a deployment)

Phase 6 reviewed the existing configuration and exercised an isolated local test
stack. No production/staging service, real database or environment file was changed.
Use this checklist for a separately authorized operator deployment. An unchecked
item is pending, not evidence of completion.

## Application and routing

- [x] Existing React/FastAPI/PostgreSQL/NiiVue architecture retained; no new service,
  broker, framework or dependency introduced by Phase 6.
- [x] Production frontend build succeeds locally with external output; local live
  tests use actual Axios `/api/v1` requests through Vite to FastAPI/PostgreSQL.
- [x] `deploy/compose.yaml`, `compose.model.yaml` and the CI workflow parse with
  duplicate-key rejection. This is syntax validation, not runtime deployment.
- [x] Inspected nginx routing: preserve `/api/v1` and `/health` paths, proxy bearer
  headers/methods/body, avoid SPA fallback for API failures, and keep assets separate.
- [ ] Verify the actual target host/domain, HTTPS, certificate renewal, proxy
  forwarding, upload limits/timeouts, error propagation and SPA refresh. The
  existing `deploy/verify_routing.py` is reusable; it was not run in Phase 6.
- [ ] Build and test the final Linux images on the intended deployment platform.
  Local verification used Windows/Node 24; the frontend image uses Node 22.
- [ ] Pin reviewed image digests and dependency/artifact versions for release.

## Secrets, authentication and permissions

- [x] Code/test review confirms database-authoritative role, active-account and
  token-version checks; no provider or authentication policy was enabled/changed.
- [ ] Generate a private `SECRET_KEY` (at least 32 bytes) and database credentials;
  use secret storage, not Git or public `VITE_*` variables. No real secret was
  inspected or included in this report.
- [ ] Set `DATABASE_URL` using `postgresql+psycopg` and the intended private host;
  production `TESTING=false`. Use separate migration/runtime database roles.
- [ ] Set exact `CORS_ORIGINS` for split hosting. Same-origin proxying needs no
  permissive wildcard. Preserve `Idempotency-Key` header support.
- [ ] Review the existing broad case-reader policy: Admin, Clinician, Researcher
  and DataScientist can read the case catalog; there is no tenant/owner ACL.
  Patient-directory filters remain restricted to Admin/Clinician. If narrower
  ownership is required, obtain a separately reviewed authorization design.
- [ ] Bootstrap the first Admin with the existing interactive
  `python -m app.database.create_admin` after separately approved DB setup; no
  default credentials should be assumed. No account was created outside test DBs.

## Database, backups and migrations

- [x] Fresh disposable PostgreSQL 18.6 upgrade to `0008_stenosis_explanations`,
  model/migration agreement, immutable triggers and populated rollback/re-upgrade
  were verified. Phase 6 adds no schema or migration.
- [ ] Inspect/stamp/migrate the actual database only through a reviewed operator
  procedure. Do not run destructive pytest fixtures against it.
- [ ] Take and restore-test a consistent backup of PostgreSQL and private artifact
  storage before release or rollback; record schema, app and artifact versions.
- [ ] Review rollback explicitly: `0008` removes explanation metadata; `0007`
  removes results/lesions; `0006` removes job history. Files remain, and re-upgrade
  creates empty tables, not restored history. If only findings are removed,
  completed jobs retain unresolved result references and reads fail closed.
- [ ] Earlier revisions `0001`–`0004` are forward-only by policy. Do not attempt a
  routine downgrade through them; use a separately reviewed backup restoration.
- [ ] Restrict database access so immutable typed application writes and database
  guards are meaningful; these are not protection against a privileged DBA.

## Private storage, viewer and operational capacity

- [x] Source, supplied-region and attribution endpoints use protected verified
  snapshots; no public study mount or browser-supplied filesystem path is added.
- [ ] Configure private persistent `UPLOAD_DIR` and `OUTPUT_DIR`, ownership for the
  application UID (container reference uses 10001), and sufficient spool/snapshot
  disk space. Do not mount them under the web static root.
- [ ] Keep source/checkpoint/derived-artifact files out of ordinary Git history.
- [ ] Verify retention, disk quotas and safe reconciliation of unreferenced output
  UUID directories after crashes. Never blindly remove source or referenced data.
- [ ] Validate browser/GPU capacity with authorized representative volumes. Current
  guards reject unsupported units/oblique or sheared viewer geometry and excessive
  transfer/decompression/memory use. No silent downsampling is implemented.
- [ ] Plan for process-local, bounded freshness observations: cold/other workers
  can show unverified exclusions until explicit source verification. A shared
  durable registry and large-cohort performance work remain future improvements.
- [ ] Load-test authorized synthetic workloads separately. History pagination is
  bounded, but per-record freshness/parent reads and full artifact snapshots still
  cost I/O. Phase 6 did not benchmark clinical-size workloads or concurrent users.

## Worker/provider activation — blocked

- [x] Normal `get_runtime()` remains `None`; capability permissions remain false.
- [ ] Supply a reviewed genuine stenosis provider and stable method/checkpoint
  identity, original-grid outputs, preprocessing and validation evidence.
- [ ] Supply a real durable dispatcher/consumer and readiness, worker identity,
  concurrency/backpressure and failure monitoring. None is currently registered.
- [ ] Define and operate claim/lease heartbeats and explicit expiry recovery
  (`fail_expired_jobs`); do not auto-retry failed jobs or fabricate progress.
- [ ] Supply validated candidate/localization, diameter/reference-region/narrowing
  methodology and an agreed severity taxonomy before activating those capabilities.
- [ ] Supply an explainability generator and reviewed verifier bound to genuine
  prediction targets/checkpoints; metadata method names alone do not enable XAI.
- [ ] Verify real-data end-to-end behavior under separate authorization. Synthetic
  fixtures and a segmentation checkpoint do not establish stenosis functionality.

## Monitoring and acceptance

- [x] Health semantics inspected: `/health` is liveness; `/health/ready` checks a
  database query, not migration level, disk space, worker/provider or clinical
  readiness. Do not treat HTTP 200 as analysis-provider acceptance.
- [ ] Configure readiness gates for actual schema/storage/provider requirements,
  alerting, audit retention/access, logs without credentials/medical payloads,
  recovery exercises and a rollback owner.
- [ ] Keep reports explicitly research-use; zero or unavailable findings are not
  proof of absent disease. Browser Print/Save as PDF is not server-generated PDF.
- [ ] Obtain product/operator acceptance of the documented infrastructure limits.
- [ ] Clinical validation, clinical deployment and regulatory/medical-device
  suitability remain unsupported and require independent qualified work.

Evidence and exact test commands: [Phase-6 acceptance report](milestone3-phase6-acceptance.md).
