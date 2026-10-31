import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { Loading } from "./components/ui";
import {
  CLINICAL_WRITERS,
  RESEARCH_READERS,
  ADMINISTRATORS,
} from "./constants/permissions";
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Cases = lazy(() => import("./pages/Cases"));
const NewCase = lazy(() => import("./pages/NewCase"));
const CaseDetail = lazy(() => import("./pages/CaseDetail"));
const Imaging = lazy(() =>
  import("./pages/CaseDetail").then((m) => ({ default: m.Imaging })),
);
const CaseHistory = lazy(() =>
  import("./pages/CaseDetail").then((m) => ({ default: m.CaseHistory })),
);
const AnalysisResult = lazy(() => import("./pages/AnalysisResult"));
const StenosisCapabilities = lazy(() => import("./pages/StenosisCapabilities"));
const StenosisReport = lazy(() => import("./pages/StenosisReport"));
const Patients = lazy(() => import("./pages/Patients"));
const NewPatient = lazy(() =>
  import("./pages/Patients").then((m) => ({ default: m.NewPatient })),
);
const PatientDetail = lazy(() =>
  import("./pages/Patients").then((m) => ({ default: m.PatientDetail })),
);
const Uploads = lazy(() => import("./pages/Uploads"));
const Reports = lazy(() => import("./pages/Reports"));
const ReportPreview = lazy(() =>
  import("./pages/Reports").then((m) => ({ default: m.ReportPreview })),
);
const Alerts = lazy(() => import("./pages/Alerts"));
const Research = lazy(() => import("./pages/Research"));
const Evaluation = lazy(() =>
  import("./pages/Research").then((m) => ({ default: m.Evaluation })),
);
const ModelComparison = lazy(() =>
  import("./pages/Research").then((m) => ({ default: m.ModelComparison })),
);
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const Security = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Security })),
);
const Help = lazy(() => import("./pages/Help"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AuditLogs = lazy(() =>
  import("./pages/admin/Operations").then((m) => ({ default: m.AuditLogs })),
);
const SystemHealth = lazy(() =>
  import("./pages/admin/Operations").then((m) => ({ default: m.SystemHealth })),
);
const writers = CLINICAL_WRITERS,
  researchers = RESEARCH_READERS;
function ErrorPage({ denied = false }) {
  return (
    <main className="error-page">
      <strong>{denied ? "403" : "404"}</strong>
      <h1>
        {denied
          ? "This area needs different access."
          : "We couldn’t find that page."}
      </h1>
      <p>
        {denied
          ? "Your account role does not permit access to this page."
          : "The address may have changed. Your workspace is still here."}
      </p>
      <Link className="btn btn-primary" to="/dashboard">
        Back to workspace
      </Link>
    </main>
  );
}
export default function App() {
  const protectedPages = [
    ["/dashboard", () => <Dashboard />],
    ["/cases", () => <Cases />],
    ["/cases/new", () => <NewCase />, writers],
    ["/cases/:id", () => <CaseDetail />],
    ["/cases/:id/imaging", () => <Imaging />],
    ["/cases/:id/analysis", () => <AnalysisResult />],
    ["/cases/:id/analysis/:analysisId", () => <AnalysisResult />],
    ["/cases/:id/stenosis", () => <StenosisCapabilities />],
    ["/cases/:id/stenosis/report", () => <StenosisReport />],
    ["/cases/:id/stenosis/report/:analysisId", () => <StenosisReport />],
    ["/cases/:id/history", () => <CaseHistory />],
    ["/patients", () => <Patients />, writers],
    ["/patients/new", () => <NewPatient />, writers],
    ["/patients/:patientId", () => <PatientDetail />, writers],
    ["/uploads", () => <Uploads />],
    ["/reports", () => <Reports />],
    ["/reports/:id", () => <ReportPreview />],
    ["/notifications", () => <Alerts />],
    ["/alerts", () => <Navigate to="/notifications" replace />],
    ["/analysis", () => <Navigate to="/cases" replace />],
    ["/datasets", () => <Research section="datasets" />, researchers],
    ["/models", () => <Research section="models" />, researchers],
    ["/models/compare", () => <ModelComparison />, researchers],
    ["/evaluation", () => <Evaluation />, researchers],
    [
      "/evaluation/segmentation",
      () => <Evaluation initialTab="Segmentation" />,
      researchers,
    ],
    [
      "/evaluation/stenosis",
      () => <Evaluation initialTab="Stenosis" />,
      researchers,
    ],
    ["/experiments", () => <Research section="experiments" />, researchers],
    ["/admin/models", () => <Navigate to="/models" replace />, researchers],
    ["/profile", () => <Profile />],
    ["/settings", () => <Settings />],
    ["/settings/security", () => <Security />],
    ["/admin/users", () => <AdminUsers />, ADMINISTRATORS],
    ["/admin/audit-logs", () => <AuditLogs />, ADMINISTRATORS],
    ["/admin/system-health", () => <SystemHealth />, ADMINISTRATORS],
  ];
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/help" element={<Help />} />
            <Route path="/403" element={<ErrorPage denied />} />
            {protectedPages.map(([path, render, roles]) => (
              <Route
                key={path}
                path={path}
                element={
                  <ProtectedRoute roles={roles}>{render()}</ProtectedRoute>
                }
              />
            ))}
            <Route path="*" element={<ErrorPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
