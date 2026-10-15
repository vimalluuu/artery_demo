# VascuAI authentication audit and consolidation

Reviewed 2026-10-15 against [PR #1](https://github.com/vimalluuu/artery_demo/pull/1).

## A. Executive decision

**Option A: retain main as the foundation and selectively incorporate saish's
improvements.** Main already has typed models, central settings, JWT verification,
server-side permissions and patient/case/image APIs. Keep that working architecture
and its PyJWT/Argon2 security stack. Incorporate saish's JSON-login and CORS ideas
and the four-role intent within those existing modules.

| Evidence | Value |
|---|---|
| Target/default branch | `main`, `4eb85fb087eaa07f2ac1b86257a327ea62624936` |
| Source | `saish`, `087b5f5cd5f9cdce0bc66cb8e4b68b4c766712f1` |
| PR source commit | One: “Add FastAPI auth endpoints, User model, and security setup” |
| Target backend commit | “feat(backend): implement FastAPI core, auth, patients, cases routers and image preprocessing service” |
| Integration branch | `codex/auth-consolidation`, based on the exact target SHA |
| PR state on inspection | Open; GitHub reports CONFLICTING |
| Inspection | Complete six-file three-dot PR diff, both backend trees/config/dependencies, relevant commits, React auth/cases adapters, Axios/context/forms/roles/routes, repository docs |

The source snapshot lacks the newer main patient/case work; the PR does **not**
explicitly delete those files in its merge-base diff. This is parallel work with
conflicts, not evidence of intentional deletion.

The initial workspace was empty. The checkout is `resolve/artery_demo`. No code was
edited before inspection; [the decision record](auth-decision.md) preceded implementation.
No default/source branch was changed, branch deleted, or PR merged.

The user-supplied requirements are the available Infosys specification. No separate
official specification, tests or AGENTS.md exists in either branch. The detailed
permission matrix below is a stated implementation policy derived from main and
the frontend, not an additional claimed Infosys mandate.

## B. Comparison table

“Implemented” means found in source. Neither original branch contains automated
tests. PR descriptions and comments are not counted as tested functionality.

| Area | Target main | Saish | Selection, retained behavior and risks |
|---|---|---|---|
| Database/configuration | Central Pydantic settings, required URL, SQLAlchemy pre-ping; SQLite example | Separate dotenv configuration, SQLite fallback, SQLite connection argument always passed | Keep main central setup. PostgreSQL+psycopg primary; SQLite only in test mode with FKs. Saish's argument is incompatible with PostgreSQL |
| User/schema | Typed ID/name/email/password_hash/role/active/timestamp | ID/email/hashed_password/arbitrary role/active; no name or timestamp | Keep main, add profile fields and token_version/check constraints. Populated saish databases require separate conversion, not replacement |
| Four roles | doctor/admin/researcher; Data Scientist absent | Four names in a comment, unrestricted string in code | Neither complete. Constrained Clinician/Researcher/DataScientist/Admin match React; normalize known legacy labels |
| Passwords | pwdlib Argon2, 12-128 character registration constraint | passlib bcrypt, unconstrained password | Retain main Argon2id and pinned pwdlib, fail closed on malformed hashes. Do not add competing bcrypt/passlib or discard existing credentials |
| JWT | PyJWT sub=user ID, role/iat/exp; fixed algorithm verification, but no required claims and duplicate decode | python-jose encoder, email subject, role/exp; no decoder | Keep PyJWT; canonical decoder requires sub/iat/exp/iss/aud/ver, bounded IDs, HS256, active DB user and matching session version |
| Registration | Validated JSON, lowercase email, fixed doctor role, 201 User, duplicate 409/rollback | Allows arbitrary role including Administrator; message-only result; duplicate 400 | Keep main response/normalization/race handling; allow only three non-admin roles, reject extra privilege fields and Admin |
| Login | Form username/password, bearer token, inactive check | JSON email/password, token/type/role, no inactive check | Retain form contract; add JSON on same URL and user response. Generic failed/inactive 401 and dummy hash verification |
| Schemas | EmailStr, bounds and explicit response models for most routes; LoginRequest unused | Plain strings and open role field; only login response model | Extend main Pydantic schemas, forbid extra auth fields, trim names, add metadata response; remove submitted input from validation errors |
| Authentication dependencies | get_current_user and require_roles protect patients/cases | None; issuing a role claim alone does not authorize routes | Keep main; current DB account and role authoritative, revoked/inactive/deleted accounts rejected |
| RBAC | Clinical writes/patients doctor/admin; researcher case reads | No server-side role checks | Preserve mapped main permissions, add DataScientist case reads and admin account/audit endpoints; model APIs remain absent |
| Errors/validation | 401/403/404/409/422; transactions for registration/cases/patients; errors can echo submitted fields | Limited 400/401 handling; no DB-race/inactive handling | Prefer main; generic DB 503/unexpected 500, sanitized 422, Bearer challenges; no credential/status disclosure on login |
| Secrets/environment | Required key/URL, but published example signing key | Published fallback signing key, default DB, decentralized env reads | Keep central settings; SecretStr, >=32-byte new key, known placeholder rejection, empty example key; no real secrets added |
| Dependencies | Pinned UTF-16 freeze includes PyJWT/Argon2/psycopg/images; installs successfully | passlib/bcrypt/python-jose imports absent from requirements | Preserve working main pins, convert to UTF-8, explicit Argon2 extra, add Alembic/dev tests. Saish import actually fails on missing passlib |
| Initialization/migrations | Explicit create_all helper, no version history | create_all during import, no version history | Neither sufficient. Exact-main Alembic baseline + additive upgrade, no startup DDL, unknown role guard; real DB conversion remains operator work |
| Automated tests | None | None | Added 83 backend tests executed on both engines, 9 frontend tests and 3 live Axios tests; measured coverage below |
| Frontend compatibility | Auth/cases mocks; /api fallback with prefix-stripping proxy; cached user trusted | Same mocks; new backend result still lacks expected user/session shape | Real auth adapter maps name/full_name, register then login, preserves /api/v1, restores /me, verifies session errors and four roles |
| Cases/patients/images | Patient create/list; case create/list/get/upload/metadata; preprocessing utility | Absent from source snapshot | Retain main endpoints/payloads/transactions/limits; canonical permissions and audit; fix TIFF pre-decode dimensions/channel count and null OpenCV decode |
| Profile/session/audit | Absent; UI simulates profile/password saves | Absent | Add real own profile/password, logout-all, admin access revocation, persistent audit events |
| Maintainability | Modular core/database/models/routers/schemas/services; best foundation | Small but missing integrations and repeated settings | Extend existing modules; one User, DB config, JWT decoder and hash implementation; incorporate selected ideas without competing modules |

JWT/hash library choice is an engineering decision, **not** an official requirement.
The retained approach is illustrated by [FastAPI's security documentation](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/).
Required claims use [PyJWT's documented options](https://pyjwt.readthedocs.io/en/latest/usage.html).
Engine behavior was checked against [SQLAlchemy PostgreSQL](https://docs.sqlalchemy.org/en/21/dialects/postgresql.html)
and [SQLite documentation](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html).
Installation/compatibility were tested; no comprehensive dependency vulnerability
audit was performed. The npm installation reported zero known vulnerabilities.

## C. Requirements compliance

| Supplied requirement | Status | Evidence and limits |
|---|---|---|
| Python | Satisfied and verified | Python 3.14.7 install, import, tests and real startup |
| FastAPI/REST | Satisfied and verified | Auth/admin/patient/case HTTP and OpenAPI tests |
| Pydantic | Satisfied and verified | Explicit schemas, invalid payloads and sanitized validation errors |
| SQLAlchemy | Satisfied and verified | ORM CRUD, unique/FK/check constraints, one engine/session configuration |
| PostgreSQL primary | Satisfied and verified | Full suite and fresh/legacy migrations on isolated PostgreSQL 18 + psycopg; installed service untouched |
| JWT authentication | Satisfied and verified | Valid/expired/malformed/incorrectly signed tokens, claims, algorithm and revocation tested |
| Four-role RBAC | Satisfied and verified for implemented APIs | Matrix tests; model-management APIs remain missing |
| Secure passwords | Satisfied and verified for registration/login/change | Salted Argon2id, length limits, wrong-password rejection, no password response/audit fields; recovery/MFA absent |
| Registration/login | Satisfied and verified | Real API + Axios, duplicates, inactive accounts, no admin self-assignment |
| Profile/session management | Satisfied and verified for implemented scope | /me, name/institution/department, password and logout-all; no email editing, refresh tokens or per-device session list |
| Audit logging | Partially implemented | Durable tested auth/admin/access/case/patient events, no credentials/PHI bodies; not every failed/unauthenticated request logged, no immutable sink/retention policy |
| Patient/case management | Partially implemented | Existing APIs preserved/tested; full lifecycle, assignments/cohort isolation and actual case frontend adapter absent |
| Medical image upload/preprocessing | Partially implemented | PNG/JPEG/TIFF upload, metadata and normalization tested; DICOM/NIfTI, de-identification and volume pipelines absent |
| Deep-learning inference | Missing | No backend model loader/queue/inference endpoint or persisted predictions; UI analysis is simulated |

This is a tested authentication integration, not completion of all project milestones
or a claim of deployment readiness.

## D. Consolidation summary

Paths are repository-relative. No source files were removed.

| Changed/created files | Purpose |
|---|---|
| `backend/app/core/config.py`, `security.py`, `dependencies.py`; new `roles.py` | Validated configuration, one JWT decoder, required claims, canonical role checks, live account/session validation |
| `backend/app/database/session.py`, `init_db.py`; new `create_admin.py` | Engine-specific setup, test FKs, migration wrapper, explicit admin bootstrap |
| `backend/app/models/user.py`, `models/__init__.py`; new `models/audit.py` | Role constraints, profile/session fields, audit table |
| `backend/app/routers/auth.py`, `schemas/auth.py`; new `routers/admin.py`, `services/audit.py` | Real auth/profile/session/access administration and persistent events |
| `backend/app/main.py` | CORS, admin routes, sanitized errors, DB readiness |
| `backend/app/routers/cases.py`, `patients.py`, `schemas/case.py` | Preserve APIs, map roles, add audit, TIFF/metadata safety fixes and explicit metadata response |
| New `backend/alembic.ini`, `migrations/env.py`, `migrations/versions/0001_main_baseline.py`, `0002_auth_consolidation.py` | Fresh and existing-main migration chain with data preservation and role guard |
| `backend/requirements.txt`; new `requirements-dev.txt` | Preserve pins, UTF-8, explicit Argon2 extra, Alembic/test dependencies |
| `backend/.env.example`, `.gitignore`; new `README.md` | PostgreSQL setup, empty secret, private/test artifact exclusions, migration/test runbook |
| New `backend/pytest.ini`, `tests/conftest.py`, `test_auth.py`, `test_cases_rbac.py`, `test_database_config.py` | Isolated test databases, auth/RBAC/schema/CRUD/image regressions |
| New `backend/scripts/test_postgres.py`, `test_frontend_contract.py` | Disposable PostgreSQL and actual Uvicorn/Axios checks with cleanup |
| `frontend-react/src/api/auth.js`, `client.js`; new `auth-contract.js` | Real API adapter, name mapping, prefix, bearer headers, form errors and stale-401 protection |
| `frontend-react/src/context/AuthContext.jsx` | Server identity restoration, session/profile actions, stale restore protection |
| `frontend-react/src/pages/Login.jsx`, `Register.jsx`, `Profile.jsx` | Remove misleading demo buttons, no Admin signup, 12-character passwords, real updates and read-only email |
| `frontend-react/src/pages/admin/AdminUsers.jsx` | Real directory/access changes and errors; remove fake last-login column and unimplemented invite action |
| `frontend-react/src/App.jsx`, `components/Sidebar.jsx` | Clinical-only creation route, role-appropriate navigation |
| `frontend-react/vite.config.js`, `package.json`; new `.env.example` | Preserve /api/v1, test script, configured API base |
| New `frontend-react/tests/auth-contract.test.js`, `client.test.js`, `auth-live.test.js` | Adapter, interceptor and live HTTP contracts |
| New `.github/workflows/auth-tests.yml` | Both DBs, frontend tests/build/lint/live contracts; not yet run on GitHub |
| `README.md`; new `docs/auth-decision.md`, `auth-audit.md` | Current setup, evidence and decision |

Case/analysis mocks in `frontend-react/src/api/cases.js` and legacy HTML remain.
They are not presented as working inference integration.

## E. Final API contract

Base: **/api/v1**. Protected requests use `Authorization: Bearer <access_token>`.

### Registration

`POST /auth/register`, JSON:

```json
{
  "full_name": "Jane Smith",
  "email": "jane@example.org",
  "password": "<12-128 characters>",
  "role": "Clinician",
  "institution": "Research Institute",
  "department": "Imaging"
}
```

Trimmed name: 2-120 characters. Email validated, maximum 255, stored lowercase.
Role defaults to Clinician; only Clinician/Researcher/DataScientist accepted.
Institution/department optional, default empty, maximum 200. Extra privilege
fields, unknown roles and Admin return 422. Duplicate normalized email returns 409.

**201 returns a User object**, preserving main's registration response. It does not
return a token. React maps `name` to `full_name`, registers, then logs in to retain
its `{access_token, user}` session contract. If that login fails, the account was
still created and can subsequently log in.

### Login and identity

`POST /auth/login` accepts JSON `{"email":"jane@example.org","password":"..."}`
or form-encoded `username=jane@example.org&password=...` (main/Swagger compatibility).

**200**:

```json
{
  "access_token": "<signed JWT>",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "full_name": "Jane Smith",
    "email": "jane@example.org",
    "role": "Clinician",
    "is_active": true,
    "institution": "Research Institute",
    "department": "Imaging"
  }
}
```

User responses never expose passwords, hashes or token versions. Unknown user,
wrong password and inactive account all return the same 401 plus Bearer challenge.
Inactive login changes from main's 403 to 401 to avoid revealing account status.

HS256 JWTs contain string `sub` (integer user ID), `iat`, `exp`, `iss`, `aud`,
`ver`, and informational `role`. Expiration defaults to 30 minutes. Verification
requires identity/time/issuer/audience/version claims and checks the active DB
account/version. **Database roles determine permissions**, not the role claim.
No refresh token is issued; old pre-consolidation tokens require re-login.

| Endpoint | Request/result | Permission |
|---|---|---|
| GET /auth/me | User | Any active authenticated user |
| PATCH /auth/me | full_name required; institution/department optional (omission resets to empty); User | Own profile; no email/role changes |
| POST /auth/password | current_password, new_password; token + User | Own account, incorrect current password 400; revoke previous tokens |
| POST /auth/logout | No body; 204 | Revoke all sessions for current account |
| GET /admin/users | User list; limit 1-500, offset >=0 | Admin |
| PATCH /admin/users/{id} | role, is_active required; User | Admin; revoke target tokens; self-demotion/deactivation 409 |
| GET /admin/audit | id/actor_id/action/resource_id/created_at; bounded pagination | Admin |
| GET /health/ready | status ready; 503 on DB failure | Public connectivity check |

Fresh admins are created only by the explicit terminal bootstrap, or existing
admins can grant access. No default admin credentials are installed. Audit records
contain controlled action labels and numeric IDs, not credentials or PHI bodies.

### Role semantics

| Intended role | API/UI value | Patient operations | Case read/metadata | Case create/upload | Own profile/session | Users/audit admin |
|---|---|---|---|---|---|---|
| Radiologist / Clinician | Clinician | Yes | Yes | Yes | Yes | No |
| Medical Researcher | Researcher | No | Yes | No | Yes | No |
| Data Scientist / ML Engineer | DataScientist | No | Yes | No | Yes | No |
| Administrator | Admin | Yes | Yes | Yes | Yes | Yes |

Model management has no backend API yet; its permissions cannot be claimed as
implemented. Case access is global by role without assignments/cohort/tenant
restrictions. Public non-admin signup preserves the immediate-access prototype
model; clinical deployment needs verified enrollment/approval.

Retained APIs: POST/GET /patients; POST/GET /cases; GET /cases/{id};
POST /cases/{id}/image (multipart `file`); GET /cases/{id}/image/metadata.
Existing 20 MB / 8192-pixel raster limits and case fields remain. The mock React
case schema still differs from backend patient_id/case_code/study_type.

Errors use `{"detail": ...}`: 401 auth, 403 forbidden, 404 missing, 409 conflict,
415 media, 422 validation, 503 database unavailable, 500 unexpected. Validation
arrays contain loc/msg/type only, never submitted input. Duplicate-registration
409 intentionally still reveals that an email is registered.

## F. Executed tests and results

Local Windows/Python 3.14.7 results; no remote CI pass is claimed.

| Check | Result |
|---|---|
| Original main requirements, fresh venv | Installation passed |
| Original main snapshot import with generated test configuration | Passed |
| Original saish snapshot import in dependency environment | Failed: `ModuleNotFoundError: passlib`; its requirements also omit bcrypt/python-jose |
| SQLite `python -m pytest -q --cov=app --cov-report=term-missing` | **83 passed**, 94% app statement coverage (703 statements, 39 missed) |
| `scripts/test_postgres.py`, installed PG18 binaries, isolated temporary cluster | **83 passed**, 93% app coverage (SQLite-only setup not exercised); cluster stopped/removed |
| Migration assertions on both engines | Fresh schema, ORM metadata parity, legacy users/roles/hashes/patients/cases, idempotence, unknown-role rejection and constraints passed |
| `npm test` | **9 passed**: adapter payloads/roles/errors, profile allowlist, password/logout, bearer/base URL, current/stale 401 handling |
| `scripts/test_frontend_contract.py` | **3 passed** against real Uvicorn via Axios: auth/profile/password/logout, role denials, admin changes/revocation |
| `npm run build` | Passed; ~612 kB JS bundle warning |
| `npm run lint` | Exit 0; nine warnings (existing demo unused values, render purity, context Fast Refresh structure) |
| `python -m pip check` | Passed, no broken requirements |
| `git diff --check` | Passed |

The first backend run had one test false-positive: password sentinel “short” matched
`string_too_short`. A distinct sentinel fixed it; the API had not echoed the password.
The first live HTTP run passed tests but hit Windows temporary DB cleanup failure.
The helper now terminates its own process tree; the full rerun passed with cleanup.
Starlette emits one deprecation warning about its httpx TestClient adapter; the
installed combination passed. A switch to httpx2 was not required for this task.

Not executed: browser-driven React E2E, production deployment, real application
database migration, SQLite-to-PostgreSQL data transfer, stress/race load testing,
external penetration testing, or inference validation. Isolated PostgreSQL tests
do not verify deployment-specific credentials/TLS/privileges or existing data.

## G. Remaining work

1. **Frontend:** connect real case/patient/upload APIs; clearly label or replace
   simulated analysis/dashboard/reports/model screens. Add browser reload/expiry/
   role/form tests, admin pagination beyond 500 and an actual invitation flow.
2. **PostgreSQL:** provision least-privilege runtime/migration users, TLS and backups;
   follow the [migration runbook](../backend/README.md). Rehearse existing-data
   transfer, role/email reconciliation, image paths and sequence resets. Saish
   schema/bcrypt data needs explicit conversion/reset design, not silent adoption.
3. **Cases/patients:** define assignments, cohort/tenant access and de-identification;
   add lifecycle CRUD and audits. Replace absolute image paths in a future versioned
   response contract with safe storage references.
4. **Images:** DICOM/NIfTI parsing, metadata validation, anonymization, volume
   orientation and modality-specific preprocessing, storage lifecycle/load tests.
5. **Inference:** model loader/version management, input contract, queue/jobs,
   authorization, results/metrics persistence, uncertainty and report APIs.
6. **Testing/deployment:** run CI on Linux and production-like services; browser,
   load and security tests; enrollment approval/email verification, rate limiting,
   recovery/MFA as needed, session UI and audit retention/export. LocalStorage
   bearer tokens retain XSS exposure; evaluate HttpOnly-cookie/BFF/CSRF tradeoffs,
   enforce HTTPS/CSP. These are deployment choices, not claimed library mandates.

## H. Pull-request recommendation

**Keep PR #1 open while this integration is reviewed. It is not ready to merge
unchanged:** conflicts, undeclared runtime dependencies, unrestricted administrator
registration, absent JWT consumer/RBAC dependencies and incompatible contracts.

Review the integration against main, confirm the permission policy against the
actual official specification, and run CI before deciding a merge strategy.
Saish's JSON-login, CORS and role intent are retained and credited. No PR merge,
closure, force push, branch deletion or production migration was performed.
