# VascuAI backend

Validated with Python 3.14.7 and PostgreSQL 18. One SQLAlchemy database configuration,
User model, JWT implementation (PyJWT/HS256), and password implementation
(pwdlib/Argon2id).

## Local setup

From `backend/`:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python -c "import secrets; print(secrets.token_hex(32))"
```

Put the generated key in your private `.env`; configure `DATABASE_URL` for your
PostgreSQL database and credentials. Provision that database/user separately.
The empty example key intentionally prevents startup until configured.

For a **new, empty** database:

```powershell
.\.venv\Scripts\python -m alembic upgrade head
.\.venv\Scripts\python -m app.database.create_admin
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

Admin bootstrap prompts for a password without echoing it and refuses to promote
an existing account. Later access changes use the authenticated admin API.
No DDL runs at application startup. `python -m app.database.init_db` now wraps
Alembic upgrade. `/health` is liveness; `/health/ready` checks DB connectivity;
`/docs` documents the API. Configure CORS for the actual frontend origins.

## Existing databases: review before migration

1. Back up and verify restoration before a production migration.
2. Compare the schema with `migrations/versions/0001_main_baseline.py`. Only a
   database matching the original **main** schema may be stamped using
   `python -m alembic stamp 0001_main`. Never stamp an unknown schema.
3. Inspect existing roles. `0002_auth` maps doctor/admin/researcher and known
   long-form role labels. Unknown roles block upgrade before schema changes.
4. Run `python -m alembic upgrade head`. Existing IDs, hashes, patients, cases,
   timestamps and image paths are retained. Existing tokens require re-login
   because issuer, audience and session-version claims are now required.
5. Verify deployment permissions on tables and generated PostgreSQL sequences;
   use a separate migration role in deployment.

Migrations 0001–0004 are forward-only: rollback requires reviewed backup restoration.
Migration `0005_segmentation_results` can be downgraded to `0004_volume_ingestion`:
it drops the segmentation index and table, permanently deleting segmentation
history. Existing cases, users, uploads and output files are retained. Reapplying
0005 recreates an empty history table; it does not recover deleted records.
This task did not operate on an existing application database.

**SQLite to PostgreSQL is a data transfer, not just a URL change.** Create the
PostgreSQL schema with Alembic; inventory roles/email collisions; copy users,
patients and cases in FK order, preserving IDs and timestamps; transfer image
storage and adjust verified paths; reset PostgreSQL sequences after explicit ID
imports. Verify counts/constraints on a staging copy. No automatic cross-database
copier is included.

**Saish databases are not main databases:** their users schema has
`hashed_password`, no `full_name`/timestamp, and bcrypt hashes. Do not stamp them
as main or rename bcrypt data into an Argon2 field. They require a separately
reviewed conversion and credential reset/enrollment procedure. No such database
was supplied, so no destructive conversion was attempted.

## Tests

Experimental 3D CT segmentation is documented in
[the model integration guide](app/services/segmentation/README.md). It uses the
existing case/volume APIs and an optional PyTorch dependency, with a new additive
`0005_segmentation_results` migration. It does not provide clinical findings.

```powershell
.\.venv\Scripts\python -m pytest -q --cov=app --cov-report=term-missing
.\.venv\Scripts\python scripts/test_postgres.py --bin "C:\Program Files\PostgreSQL\18\bin"
.\.venv\Scripts\python scripts/test_frontend_contract.py
.\.venv\Scripts\python -m pip check
```

SQLite is supported only with `TESTING=true`. Tests generate a key and temporary
storage; the default suite uses in-memory SQLite and Alembic migrations.

The PostgreSQL helper creates a temporary cluster, generated password and free
local port, runs tests, then stops/removes its own cluster. It does not change the
installed PostgreSQL service. Alternatively, set `TEST_DATABASE_URL` to a test
PostgreSQL connection: tests create a unique `vascuai_test_<uuid>` schema, use only
that search path, and drop their schema afterward. Schema-creation privileges are
required. Do not configure deployment credentials for test tooling.

The live frontend helper requires `npm ci` in `frontend-react/`; it starts real
Uvicorn with a disposable test DB and runs Axios over HTTP. CI covers both engines,
frontend tests/build/lint and HTTP contracts, but was not run remotely in this task.

See [the audit report](../docs/auth-audit.md) for the comparison, API contract,
permission matrix, measured results, limitations and PR recommendation.
