# VascuAI

**Artery Segmentation and Stenosis Detection using Advanced Deep Learning Techniques**

Infosys Springboard internship project: a React + FastAPI vascular-imaging research prototype.

## Objective and implementation status

The project connects medical-volume intake, experimental artery segmentation, vessel
structure analysis and auditable research reporting. Small vessels, incomplete annotations
and inconsistent image geometry make reliable segmentation and stenosis measurement
challenging. The application preserves provenance and unavailable states rather than
presenting unsupported outputs as medical findings.

**Research/educational use only. No clinical validation, autonomous diagnosis or complete
milestone acceptance is claimed.** Use authorized, de-identified data; permission to access
a dataset does not automatically grant permission to redistribute it.

| Area | Current behavior and limitations |
| --- | --- |
| Accounts | JWT authentication, Argon2 password hashing, four roles, administration and audit events. No built-in accounts or passwords. |
| Patients/cases | Server-backed patient/case management, supported 2D image and 3D NIfTI intake, metadata and exports. DICOM intake is unsupported. |
| Segmentation | Optional experimental SmallUNet3D (85,177 parameters), persisted provenance/history, protected CT/mask/probability downloads and NiiVue slice/3D visualization. Weights and volumes are not included in Git. |
| Vessel analysis | Standalone binary-mask component filtering, centerline extraction and spacing-aware diameter utilities. These do not activate quantitative stenosis in the app. |
| Stenosis infrastructure | Capability contracts, job/result/lesion/explanation storage, operational analytics and research reports. Genuine stenosis provider/worker integration remains unavailable; execution permissions stay disabled. |
| Offline evaluation | Protected artifact upload/import, macro case metrics, case-wise results, exact-case-set comparison and model history APIs. No seeded scores. A completed evaluation dashboard is not implied by these APIs. |
| Future work | Validated narrowing/severity, genuine attribution generation, advanced segmentation architecture, reproducible model comparison and full validation. |

An experimental mask is not a stenosis finding. Probabilities are not calibrated clinical
confidence. Historical checkpoint step/run provenance is unresolved: a step-700 filename
is not proof of 700 optimizer updates. See [model setup](backend/app/services/segmentation/README.md),
[Milestone 3 acceptance](docs/milestone3-phase6-acceptance.md) and
[deployment gates](docs/milestone3-deployment-checklist.md).

## Technology stack and prerequisites

Versions are taken from requirements, lockfile and CI, not guessed from product names.

| Component | Repository version / requirement |
| --- | --- |
| Python | 3.14 in CI/Docker; local backend environment 3.14.7 |
| FastAPI / SQLAlchemy / Alembic | 0.143.0 / 2.1.4 / 1.20.0 |
| PostgreSQL / driver | PostgreSQL 18 in CI/Docker; psycopg 3.3.6 |
| Node.js / npm | Node 22 in CI; use Node >=22.12.0 for the locked Vite engine, with npm |
| React / Vite | Lockfile: 19.3.0 / 8.3.4; package.json ranges start at ^19.2.8 / ^8.3.0 |
| Frontend | React Router, Axios 1.20.0, Tailwind CSS 4, Lucide icons, Chart.js, NiiVue 0.69.0 |
| Scientific | NiBabel 5.4.2, NumPy 2.5.4, SciPy 1.17.0, scikit-image 0.26.0 |
| Optional model runtime | PyTorch 2.14.1; separately installed, CPU default |

Install [Git](https://git-scm.com/downloads), [Python 3.14](https://www.python.org/downloads/),
[Node.js](https://nodejs.org/en/download) and [PostgreSQL 18](https://www.postgresql.org/download/windows/)
from their official installers. Include Python/Node on PATH and PostgreSQL SQL Shell/psql.
Docker is optional; see [deployment setup](deploy/README.md). No GPU is required for the
web application. Real CT inference is optional and can be slow on CPU.

```powershell
git clone https://github.com/vimalluuu/artery_demo.git
cd artery_demo
python --version
node --version
npm --version
```

## Backend setup on a new Windows computer

Use the cloned repository's paths; no project-owner drive letter is required.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
```

Put the generated signing key in private `backend/.env`. Never commit it.
`requirements-dev.txt` includes runtime requirements plus pytest/httpx/coverage;
a runtime-only installation can use `requirements.txt`. The empty example key
intentionally prevents unconfigured startup.

### PostgreSQL and environment configuration

Start PostgreSQL normally. For a **new installation**, connect to SQL Shell (psql)
as an authorized database administrator and provision a new application role/database:

```sql
CREATE ROLE vascuai LOGIN;
\password vascuai
CREATE DATABASE vascuai OWNER vascuai;
```

The password prompt avoids embedding a password in SQL. Existing installations must
use their existing authorized database/role; do not drop or recreate them. Configure
`backend/.env` locally:

```dotenv
SECRET_KEY="YOUR_NEWLY_GENERATED_SECRET_KEY"
DATABASE_URL="postgresql+psycopg://vascuai:YOUR_URL_ENCODED_DATABASE_PASSWORD@localhost:5432/vascuai"
TESTING=false
CORS_ORIGINS=["http://localhost:5173"]
UPLOAD_DIR="./uploads"
OUTPUT_DIR="./outputs"
```

Uppercase values are configuration instructions, not working credentials. URL-encode
special characters in the database password. Use at least 32 bytes of newly generated
signing-key material. Keep uploads/outputs private; never expose a public static mount.
Do not enable TESTING for the normal app.

### Migrations before startup

For a **new, empty database**, from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m alembic heads
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
```

Current head is `0009_evaluations`. Migrations 0006, 0007 and 0008 add stenosis job,
result/lesion and explanation tables; 0009 adds offline evaluation storage. Uvicorn
startup does **not** create these tables or apply migrations.

For an **existing database**, first follow [backend migration review](backend/README.md).
Back up the database and matching private storage and verify restoration. Review the
current revision, migration files and intended target; quiesce application writes in
an approved window. Run the upgrade only with operator approval. Never blindly stamp
an unknown schema, call create_all as a workaround, or drop/recreate tables. Downgrades
can delete segmentation/stenosis/evaluation history and are not a default rollback plan.

### First administrator and backend execution

Only for your own new installation with no existing account, the supported bootstrap is:

```powershell
.\.venv\Scripts\python.exe -m app.database.create_admin
```

It prompts for name/email/password without echoing the password and refuses to promote
an existing account. Do not use it to recreate/reset the owner's demo accounts.
Public registration supports Clinician, Researcher and DataScientist, never Admin;
registered passwords require 12-128 characters.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Alternatively activate `.\.venv\Scripts\Activate.ps1` and run `uvicorn app.main:app --reload`.
If activation is blocked by PowerShell policy, use the explicit executable commands;
no machine execution-policy change is necessary.

## Frontend setup and application URLs

Open a second terminal at the repository root:

```powershell
cd frontend-react
npm ci
Copy-Item .env.example .env
npm run dev -- --host localhost --port 5173 --strictPort
```

The example contains `VITE_API_URL=/api/v1`. Keep it for normal local development.
`vite.config.js` proxies `/api` and `/health` to `http://localhost:8000`. Vite variables
are public: never put secrets there. For alternate origins/ports, review backend CORS
and Vite proxy targets together. `--strictPort` prevents silent frontend port changes.
The existing interface uses #222222, #FDFFFC and Lucide icons.

| Purpose | Local development URL |
| --- | --- |
| Application | http://localhost:5173 |
| Backend | http://localhost:8000 |
| Swagger API documentation | http://localhost:8000/docs |
| Liveness | http://localhost:8000/health |
| Database connectivity | http://localhost:8000/health/ready |

Readiness uses SELECT 1: it checks connectivity, not migration currency. Inspect Alembic
separately. These URLs are development endpoints, not production hosting.

## Login and actual role permissions

Open the application, choose **Sign in**, and use an account from the database you
configured. Cloning code does not copy the owner's database or users.

The owner reports the following existing accounts in their environment. These accounts
are not seeded by cloning the repository; this documentation does not create or reset them:

| Display role | Owner's account | Canonical role | Permissions |
| --- | --- | --- | --- |
| Administrator | Administrator | Admin | Clinical workflows, user access management, audit/system views, evaluation import and research reads. |
| Data Scientist | Data Scientist | DataScientist | Case/segmentation reads, offline evaluation artifact upload/import and model/evaluation history. No clinical-writer or user-admin privilege. |
| Medical Researcher | Medical Researcher | Researcher | Authenticated case, segmentation and research/evaluation reads; no clinical writes or evaluation import. |
| Clinician | No additional demo account defined | Clinician | Patients/cases/uploads and permitted experimental segmentation; no user administration or evaluation import. |

**Obtain demo passwords privately from the owner.** GitHub repository visibility was
previously verified as public, so supplied passwords are deliberately excluded.
There are no built-in credentials or seed command for those three accounts. A fresh
local installation needs its own explicitly provisioned administrator. Backend RBAC
is authoritative; patient-scoped analytics/counts require Clinician/Admin. Disabled
capabilities remain disabled for every role.

## Analytics data, empty states and the confirmed 503 issue

The authenticated frontend uses:

```text
GET /api/v1/stenosis/analytics/summary
GET /api/v1/stenosis/analytics/analyses?limit=10&offset=0
GET /api/v1/stenosis/analytics/trends
```

Analytics reads persisted stenosis jobs/results, not generic case completion or
segmentation Dice. It reports operational counts and UTC creation trends, with source
freshness/integrity exclusions. It never runs a model or seeds data on a GET. Offline
segmentation evaluation imports also do not create stenosis jobs/findings.

With migrated tables and no jobs, the correct response is HTTP 200, zero job counts
and an empty analysis list. Unsupported severity and measurement summaries remain
unavailable. The dashboard's empty message is not a negative medical finding. A genuine
provider/worker integration is still needed to create real stenosis analyses.

### Historical diagnosis and completed local recovery

**Historical diagnosis, before the local migration on 10 November 2026:** read-only
inspection found connectivity working but the local Windows database still at
`0005_segmentation_results`. All four analytics tables were
missing: `stenosis_analysis_jobs`, `stenosis_analysis_results`, `stenosis_lesions` and
`stenosis_explanation_artifacts`. Authentication/case tables predate these migrations,
explaining why those endpoints could work while analytics failed. This is distinct
from the Docker staging database.

**Current local status, verified on 10 November 2026:** the local development database
`artery_db` was upgraded through migrations 0006-0009 to `0009_evaluations`, after an
approved backup and successful disposable restore test. The new analytics/evaluation
tables, indexes, constraints and guards were verified. Existing application data was
preserved. Both analytics endpoints returned HTTP 200 with truthful empty results;
local authentication and case reads also returned HTTP 200. The local API was restarted.
This records the completed local operation only; it does not claim any Docker staging
deployment or database update.

The previous SQLAlchemy handler hid the schema cause behind a generic 503. Missing
tables/columns now receive an explicit schema/migration 503 message. Logs retain the
error category, SQLSTATE and route template without SQL, parameters or credentials.
Other database failures still return the normal 503; no failure becomes zero analytics.
The response contract remains a `detail` string.

For a different or still-unmigrated existing database, follow the approved backup/migration
process, then from the backend environment configured for **that database**:

```powershell
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic heads
# Only after backup validation and explicit operator approval:
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
```

After upgrading, sign in normally through the UI or `/docs` and verify both endpoints.
Swagger's OAuth form uses the account email as username. Keep passwords/tokens out of
shared commands, logs and screenshots. Retry/Refresh only repeats requests; it cannot
create missing tables. The already-upgraded local database does not need another migration
because of this README correction. Fresh installations must still run `alembic upgrade head`
as documented above to initialize the latest schema.

## Tests and production frontend build

From `backend/`, with development requirements installed:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pytest -q tests/test_database_error_logging.py tests/test_stenosis_reporting.py
.\.venv\Scripts\python.exe scripts/test_postgres.py --bin "C:\Program Files\PostgreSQL\18\bin"
.\.venv\Scripts\python.exe -m pip check
```

The default suite generates its own test key/storage and migrates disposable in-memory
SQLite. PostgreSQL-only checks skip there. The PostgreSQL helper starts a temporary,
separate local cluster with generated credentials, runs tests, then removes its own
cluster; it does not modify the installed PostgreSQL service. Never point test tooling
at the application database. TEST_DATABASE_URL tests create/drop a unique test schema.

The new regression creates an old schema only in the disposable test database, verifies
analytics fails honestly while case reads work, upgrades that test database, then checks
both analytics endpoints return real empty responses. Other tests cover redacted logging,
pagination, authorization, integrity and error handling. Fixtures are test data only.

From `frontend-react/`:

```powershell
npm test
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e -- tests/e2e/reporting.spec.js
```

Browser reporting tests use mocked APIs, including Retry recovery, empty states and
accessibility. They do not establish live production/database behavior. To reuse an
existing Chromium browser, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. The real disposable
Axios/auth HTTP contract helper requires frontend dependencies first, then
`python scripts/test_frontend_contract.py` from `backend/`.

Read-only migration inspections are `python -m alembic current`, `heads` and `history`.
`python -m alembic check` compares an already migrated database against model metadata;
it is not a substitute for backup review or an upgrade.

## Project structure

```text
backend/
  app/main.py                 FastAPI routing and error handlers
  app/core/                   Settings, roles, security and authorization dependencies
  app/database/               Sessions and explicit administrator bootstrap
  app/models/                 SQLAlchemy records
  app/routers/                Auth, patients, cases, segmentation, stenosis, evaluations
  app/schemas/                Request/response contracts
  app/services/               Analytics, lifecycle, reporting and vessel utilities
  app/services/segmentation/  Optional SmallUNet3D and inference pipeline
  migrations/versions/       Alembic revision chain
  tests/                     Backend/migration regression tests
  scripts/                   Disposable PostgreSQL and frontend-contract helpers
frontend-react/
  src/api/                   Authenticated Axios client and API adapters
  src/components/            Analytics, medical viewer and shared components
  src/pages/                 Existing application screens
  tests/                     Node contracts and Playwright browser tests
deploy/                      Dockerfiles, Compose and Nginx configuration
docs/                        Contracts, implementation evidence and acceptance guides
```

The original root HTML demonstration is historical; run frontend-react for the current
app. Local untracked training/research directories are not assumed to exist in a clone.
Keep model weights, medical volumes and environment files outside ordinary Git history.

## Optional model setup and known limits

Accounts/cases/analytics do not require PyTorch or a checkpoint. For experimental CT
segmentation, obtain the authorized matching checkpoint, follow
[model setup](backend/app/services/segmentation/README.md), install requirements-model.txt
with the appropriate official PyTorch wheel index and configure the external absolute
VASCULAI_MODEL_CHECKPOINT path. CPU is the default. The segmentation probability threshold
is 0.70; do not reuse it for categorical resampling or clinical severity. No automatic
training, weight download or stenosis activation occurs. Geometry and browser-memory
limits still apply; a successful segmentation operation does not establish accuracy.

## Troubleshooting

| Symptom | Safe checks / action |
| --- | --- |
| PostgreSQL connection failure / 503 | Confirm intended service, driver, host/port/database, role credentials and HBA. Check health/ready. Never print the private connection URL. |
| Missing settings | Copy the environment example, configure PostgreSQL and a generated >=32-byte signing key. Keep TESTING false. |
| Python module missing | Use the correct .venv and current requirements. SciPy/scikit-image are required by current vessel utilities; PyTorch remains optional. |
| npm ci failure | Check Node requirements, npm/registry/network and the supplied lockfile; do not delete the lockfile or apply broad audit fixes. |
| Port conflict | Identify the owner without killing unrelated services. Review proxy/CORS before changing ports; use strictPort. |
| Login failure | Confirm the account exists in this database, is active and has the correct password. Cloning does not seed users; do not reset existing accounts just to run a demo. |
| Expired/revoked session | Sign in normally again; JWT issuer/audience and session-version checks stay enabled. |
| Alembic revision error | Confirm directory, environment, intended database and source version; review history/backups. Never blindly stamp, downgrade or recreate tables. |
| Analytics 503, cases work | Compare current revision with head and inspect sanitized schema-error logs. Apply existing migrations only through the approved procedure. |
| Retry does not help | Correct the underlying schema/connection/configuration issue first; Retry cannot perform migration. |
| Empty analytics after migration | Expected with no genuine persisted stenosis jobs. Do not manufacture findings. |
| Disabled research controls | Check capabilities/model configuration; do not activate an unverified provider to populate the dashboard. |

Further references: [backend guide](backend/README.md),
[analytics/reporting contract](docs/stenosis-analytics-reporting-v1.md),
[evaluation API](docs/evaluation-api.md), [viewer guide](docs/frontend-segmentation-viewer.md)
and [deployment guide](deploy/README.md).
