# VascuAI — Vascular Imaging Research

A React workspace for de-identified patients, imaging studies, study intake, research context, and case exports, backed by FastAPI.

## Run locally

Start the backend and PostgreSQL using the [backend setup guide](backend/README.md), including migrations and explicit administrator bootstrap. There are no built-in demo credentials.

```sh
cd frontend-react
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite server proxies `/api` and `/health` to the backend at `http://localhost:8000`.

## Workspace

The interface uses **#222222** and **#FDFFFC**, Lucide icons, responsive navigation, and reusable components. It includes a public site, authentication, role-aware dashboard, patients, cases, upload center, metadata workspace, case exports, activity notifications, account settings, administration, and documentation.

Authentication, patient registration, case management, image/NIfTI ingestion, metadata, user administration, and audit logs use real backend APIs. Dashboard charts derive from persisted cases. Case summaries can be exported as JSON/CSV or printed to PDF through the browser.

Dataset, evaluation, experiment, model, and analysis screens describe current readiness. An optional experimental CT segmentation service now provides backend inference, immutable run records, and protected NIfTI downloads; the frontend does not yet call it. **Stenosis measurements, explainability, 3D viewing, training, and model deployment are not connected.** No illustrative clinical results are presented as real.

See [model setup and API contract](backend/app/services/segmentation/README.md) and
[measured integration results](docs/model-integration-verification.md). The
original SmallUNet3D checkpoint loads strictly (85,177 parameters, step 700).
Weights and sample medical volumes remain local ignored artifacts, outside
ordinary Git history. Configure `VASCULAI_MODEL_CHECKPOINT` and install the
optional `backend/requirements-model.txt`; review migration `0005_segmentation_results`.

Read the [UI implementation and remaining capability map](docs/ui-features.md) for the route inventory, data behavior, and blueprint gaps.

See the [pre-milestone verification](docs/pre-milestone-verification.md) for the four-role contract, NIfTI integrity fixes, and prerequisites for real 3D segmentation. The [deployment reference](deploy/README.md) includes nginx/API/health routing and a reproducible routing smoke check.

## Roles

- **Clinician:** manage patients, create/edit cases, upload study files, inspect case records, and request experimental CT segmentation through the API.
- **Researcher:** inspect case records, protected segmentation outputs, and research readiness screens.
- **DataScientist:** inspect case records, protected segmentation outputs, and model/training/evaluation readiness screens.
- **Admin:** clinical workflows, user management, audit trail, and system health.

Backend permissions remain authoritative. Public registration cannot grant administrator access. Passwords require 12–128 characters.

## Verification

```sh
cd frontend-react
npm run build
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

Browser tests use isolated API fixtures and do not write to the real backend. For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` before running them.

## Stack

React 19, Vite 8, React Router, Tailwind CSS 4 with shared CSS tokens, Lucide React, Chart.js, Axios, and FastAPI. Research pages and charts load on demand.

The original static HTML demonstration is retained at the repository root. The current application lives in `frontend-react/`.

## Intended use

This is a medical imaging research prototype, not an autonomous diagnostic system. Use public or de-identified data. Any future AI findings require qualified review.
