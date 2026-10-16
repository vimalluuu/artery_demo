# VascuAI UI implementation

The UI milestone was implemented on `ui-features` and merged into `main` through
PR #6. This document describes the UI milestone. Subsequent backend segmentation
integration is documented in [the model guide](../backend/app/services/segmentation/README.md)
and [verification report](model-integration-verification.md). The case analysis
screen now connects real runs and protected downloads; see
[frontend segmentation integration](frontend-segmentation-ui.md).

## Design

- Charcoal `#222222` and off-white `#FDFFFC` are the primary colors.
- Subdued neutral surfaces, thin borders, Manrope headings, and DM Sans body text.
- Lucide React icons use the project's existing icon package.
- The decorative vessel drawing is explicitly an illustrative schematic, not a scan or model result.
- Responsive navigation, an inert mobile drawer with keyboard focus containment, skip navigation, visible focus states, reduced-motion support, and scrollable tables.
- Routes are lazy-loaded. Chart.js is loaded with the dashboard rather than every page.

## Implemented workflows

| Area | Routes | Behavior |
| --- | --- | --- |
| Public site | `/` | Platform overview, supported capabilities, workflow, sign-in and account entry points |
| Authentication | `/login`, `/register` | Existing server authentication, four canonical roles, validation, password visibility, protected destination restoration |
| Recovery guidance | `/forgot-password` | Explicit administrator-assisted recovery guidance; does not pretend to send reset email |
| Dashboard | `/dashboard` | Role-aware copy/actions, real case counts, creation-volume chart, status distribution, recent case records |
| Patients | `/patients`, `/patients/new`, `/patients/:patientId` | Search, sort, paginate, register a pseudonymous subject, inspect notes and associated cases; Clinician/Admin only |
| Cases | `/cases`, `/cases/new`, `/cases/:id` | Search/filter/sort/paginate, create a case, update supported metadata, role-aware actions |
| Upload center | `/uploads` | Choose a case, validate extension/size, upload image or NIfTI, actual transfer progress, cancellation, retry, replacement acknowledgement |
| Imaging | `/cases/:id/imaging` | Real source metadata, spatial units, dimensions, affine matrix, honest viewer availability state |
| Case history | `/cases/:id/history` | Actual case creation and available volume-upload timestamp; no invented image/inference timestamps |
| Segmentation | `/cases/:id/analysis` | 3D CT eligibility, authorized run action, configurable threshold, actual run history, stale handling and protected downloads |
| Case exports | `/reports`, `/reports/:id` | Filter case summaries, download JSON/CSV, print or save PDF using the browser |
| Activity | `/notifications` | Events derived from accessible case creation records and current failure states; per-account read IDs stored on the device |
| Account | `/profile`, `/settings/security` | Existing profile/password APIs, current account context, logout, supported session guidance |
| Preferences | `/settings` | Persistent device-local case page size and case-activity visibility |
| Users | `/admin/users` | Existing server-backed role and activation controls, restyled in the shared palette |
| Audit trail | `/admin/audit-logs` | Real audit API, search, category filter, pagination; latest 5,000 events maximum |
| System health | `/admin/system-health` | On-demand API and database readiness checks; other telemetry is explicitly unknown |
| Documentation | `/help` | Public/authenticated guide, input formats, permission matrix, methodology, exports, troubleshooting, limitations |

Legacy `/alerts`, `/analysis`, and `/admin/models` routes redirect to their corresponding current screens. Existing `/cases/:id/analysis/:analysisId` links use server segmentation history and highlight a matching run, or explain when the requested run is absent.

## Research screens and remaining integration

`/datasets`, `/models`, `/models/compare`, `/evaluation`, `/evaluation/segmentation`, `/evaluation/stenosis`, and `/experiments` provide task-specific empty states, readiness requirements, methodology, and metric definitions. They are restricted to Researcher, DataScientist, and Admin roles. They **do not** register datasets, run inference, launch training, deploy models, or calculate evaluation metrics.

The following blueprint capabilities need additional APIs, model/data artifacts, or backend work:

- Patient editing, demographics/history beyond the current schema, and longitudinal record history.
- Password reset email/token flow, device-session listing, and individual remote session revocation.
- Protected pixel/voxel delivery, a true medical viewer, synchronized slices, 3D rendering, and measurement tools.
- Volumetric preprocessing jobs and a persistent background processing queue.
- Centerlines, vessel geometry, stenosis localization/severity, calibrated uncertainty, explainability, annotation review, and analysis-version comparison. The experimental CT segmentation baseline is connected on the case Segmentation tab.
- Versioned dataset/annotation registries, immutable split manifests, training jobs, checkpoints, model registry/deployment/rollback, and reproducible evaluation runs.
- Persistent clinical reports, server-rendered PDF documents, report history, protected artifact downloads, and export audit events.
- A server notification service, remote notification preferences, and operational telemetry beyond API/database checks.

No severity percentages, confidence values, synthetic scans, fake processing progress, deployment status, evaluation scores, or training curves are presented as real. A Complete case workflow status does not establish an available analysis result.

## Important data behavior

Case exports use an explicit field allowlist and exclude internal file paths and unsupported clinical output fields. CSV cells are quoted and formula-like values are neutralized. Exports are created locally from records already authorized by the case API; there is no dedicated server-side export-audit endpoint.

Replacing an image or volume requires acknowledgement because the current backend does not retain upload versions. Cancelling the browser transfer cannot roll back a request already received by the server. Metadata can be replaced, but the current PATCH contract does not clear existing values; the editor explains this rather than silently reporting a successful clear.

Study intake supports PNG/JPEG/TIFF up to 20 MB and 8,192 pixels per side, raw NIfTI up to 2,000 MB, and compressed NIfTI up to 512 MB with a 2,000 MB decompression limit. DICOM is not supported. Physical units are read from the NIfTI header rather than assumed to be millimeters.

## Verification

From `frontend-react`:

```sh
npm run build
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

Browser tests intercept only `/api/v1/**` and health endpoints with isolated fixtures. They do not create real accounts or patient records. Coverage includes route rendering, sign-in destination restoration, patient/case creation, schema-compatible field values including age zero, case edits, search/filter/pagination, file rejection, JSON export allowlisting, role restrictions, responsive layouts, and automated accessibility checks.

An existing Chromium binary can be supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Browser tests reuse a local Vite server at `http://127.0.0.1:5173` when available.

The development server proxies `/api` and `/health` to `http://localhost:8000`. Production hosting must provide equivalent routing, or configure `VITE_API_URL` and `VITE_HEALTH_URL`. See the backend README for database setup and migrations.
