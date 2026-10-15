import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login        from './pages/Login';
import Register     from './pages/Register';
import Dashboard    from './pages/Dashboard';
import Cases        from './pages/Cases';
import NewCase      from './pages/NewCase';
import CaseDetail   from './pages/CaseDetail';
import AnalysisResult from './pages/AnalysisResult';
import Reports      from './pages/Reports';
import Alerts       from './pages/Alerts';
import Profile      from './pages/Profile';
import AdminUsers   from './pages/admin/AdminUsers';
import AdminModels  from './pages/admin/AdminModels';

function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f4f8' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 80, fontWeight: 900, color: '#e2e8f0', letterSpacing: '-4px' }}>404</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#334155', margin: '12px 0 8px' }}>Page not found</div>
        <div style={{ color: '#64748b', marginBottom: 24 }}>The page you're looking for doesn't exist.</div>
        <a href="/dashboard" style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', borderRadius: 10, fontWeight: 600, fontSize: 14 }}>
          ← Back to Dashboard
        </a>
      </div>
    </div>
  );
}

function AccessDenied() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f4f8' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 80, fontWeight: 900, color: '#e2e8f0', letterSpacing: '-4px' }}>403</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#334155', margin: '12px 0 8px' }}>Access denied</div>
        <div style={{ color: '#64748b', marginBottom: 24 }}>You don't have permission to view this page.</div>
        <a href="/dashboard" style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', borderRadius: 10, fontWeight: 600, fontSize: 14 }}>
          ← Back to Dashboard
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/403"      element={<AccessDenied />} />

          {/* Protected — any authenticated user */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/cases"     element={<ProtectedRoute><Cases /></ProtectedRoute>} />
          <Route path="/cases/new" element={<ProtectedRoute roles={['Clinician', 'Admin']}><NewCase /></ProtectedRoute>} />
          <Route path="/cases/:id" element={<ProtectedRoute><CaseDetail /></ProtectedRoute>} />
          <Route path="/cases/:id/analysis/:analysisId" element={<ProtectedRoute><AnalysisResult /></ProtectedRoute>} />
          <Route path="/analysis"  element={<ProtectedRoute><Navigate to="/cases" replace /></ProtectedRoute>} />
          <Route path="/reports"   element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/alerts"    element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
          <Route path="/profile"   element={<ProtectedRoute><Profile /></ProtectedRoute>} />

          {/* Admin / DataScientist only */}
          <Route path="/admin/users"  element={<ProtectedRoute roles={['Admin']}><AdminUsers /></ProtectedRoute>} />
          <Route path="/admin/models" element={<ProtectedRoute roles={['Admin', 'DataScientist']}><AdminModels /></ProtectedRoute>} />

          {/* Default redirects */}
          <Route path="/"  element={<Navigate to="/dashboard" replace />} />
          <Route path="*"  element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
