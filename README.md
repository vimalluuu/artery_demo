# Artery Segmentation and Stenosis Detection Demo (VascuAI)

This repository contains both the modern **React 19 + Vite + Tailwind CSS + Chart.js** application (`frontend-react/`) and the legacy static HTML demo.

## Authentication integration

The React app now uses the FastAPI backend for registration, login, profile/password
updates, logout and administrator account management. Start PostgreSQL and follow
[backend setup and migrations](backend/README.md) before signing in. Create the first
administrator using the explicit terminal bootstrap; there are no built-in demo
credentials. Case/analysis/dashboard/report/model screens still contain simulated
data and require separate backend integration.

See the [authentication audit and comparison](docs/auth-audit.md) and
[pre-implementation decision](docs/auth-decision.md) for evidence, API contracts,
role permissions, test results and the recommendation for PR #1.

---

## 🚀 Modern Application: VascuAI (`frontend-react/`)

A high-fidelity clinical research console for vascular segmentation, stenosis quantification, and AI explainability across all project milestones.

### Tech Stack
- **Framework**: React 19 + Vite 8
- **Routing**: React Router DOM v7
- **Styling**: Tailwind CSS v4 + custom medical theme tokens (black-and-white palette)
- **Visualizations**: Chart.js & React-Chartjs-2 (stenosis severity distribution, throughput trends, vessel diameter profile plots)
- **Icons**: Lucide React
- **HTTP Client**: Axios (pre-configured with JWT auth interceptors)

### Milestone Screens Implemented
| Milestone | Screen | Route | Features |
|---|---|---|---|
| **Weeks 1-2** | Login / Register | `/login`, `/register` | Validated API registration/login, role mapping, error handling |
| **Weeks 1-2** | Dashboard | `/dashboard` | Case metrics, severity doughnut chart, 7-day throughput bar chart, quick navigation |
| **Weeks 1-2** | Cases List | `/cases` | Filterable, searchable case table, status & severity pills, pagination |
| **Weeks 1-2** | New Case Form | `/cases/new` | Multi-field intake (DICOM/NIfTI, CTA/MRA, anatomic region, de-identification toggle) |
| **Weeks 1-2** | Case Detail | `/cases/:id` | Dropzone upload box, scan metadata, multi-slice previewer, run analysis trigger, history |
| **Weeks 1-2** | Profile | `/profile` | User details, password change form with security checks |
| **Weeks 1-2** | Admin: Users | `/admin/users` | User directory, role assignment (Clinician, Researcher, DataScientist, Admin), status toggling |
| **Weeks 5-6** | Analysis Screen | `/cases/:id/analysis/:analysisId` | Slice viewer with zoom/pan, vessel mask & centerline overlays, stenosis spot pinpointing, interactive vessel diameter profile curve, findings table |
| **Weeks 7-8** | Reports & Exports | `/reports` | Formats: PDF, JSON, CSV download triggers, report preview drawer, regulatory disclaimers |
| **Weeks 7-8** | Model Management | `/admin/models` | Active model versioning, Dice/IoU/Precision/Recall metrics, rollback controls |
| **Weeks 7-8** | Alerts & Flags | `/alerts` | Severity filter, low-confidence/uncertainty warnings, mark read / dismiss |

### How to Run the React App
```bash
cd frontend-react
npm install
npm run dev
```
The application will launch at `http://localhost:5173`.

### Authentication roles

The canonical role names are Clinician (Radiologist / Clinician), Researcher
(Medical Researcher), DataScientist (Data Scientist / ML Engineer), and Admin
(Administrator). Public signup accepts the first three only. The backend enforces
permissions; browser state cannot grant administrator privileges. Registration
requires a 12-128 character password. See the audit report for the permission matrix.

---

## 📁 Static HTML Demo (Legacy)

- `index.html` - Login page
- `register.html` - Registration page
- `dashboard.html` - Main dashboard
- `upload.html` - Image upload and preview
- `history.html` - Analysis history
- `report.html` - Demo report page
- `style.css` - Styling for the static app

### Run Manually
```bash
python -m http.server 8123
```
Open `http://localhost:8123/index.html` in your browser.

---

## ⚠ Clinical Research Disclaimer
All visualisations, stenosis percentages, and segmentations in this demonstration are AI-assisted research tools and are **not intended for standalone clinical diagnosis**. Every finding requires qualified clinical review.

