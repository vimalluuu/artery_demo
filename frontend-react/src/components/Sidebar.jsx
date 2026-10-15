import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, FolderOpen, PlusCircle, BarChart3,
  FileText, Bell, Settings, Users, LogOut, Cpu, ChevronRight,
} from 'lucide-react';

const NAV = [
  { label: 'Overview', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Cases',    icon: FolderOpen,      path: '/cases' },
  { label: 'New Case', icon: PlusCircle,      path: '/cases/new' },
  { label: 'Analysis', icon: BarChart3,       path: '/analysis', divider: true },
  { label: 'Reports',  icon: FileText,        path: '/reports' },
  { label: 'Alerts',   icon: Bell,            path: '/alerts' },
];

const ADMIN_NAV = [
  { label: 'Users',    icon: Users,           path: '/admin/users' },
  { label: 'Models',   icon: Cpu,             path: '/admin/models' },
];

export default function Sidebar() {
  const { user, logout, isRole } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const go = (path) => navigate(path);
  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">V</div>
        <div className="sidebar-brand-text">
          <div className="brand-name">VascuAI</div>
          <div className="brand-sub">Research Console</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-section-label">Workspace</div>
        {NAV.filter((item) => item.path !== '/cases/new' || isRole('Clinician', 'Admin')).map((item) => (
          <button
            key={item.path}
            className={`nav-item${isActive(item.path) ? ' active' : ''}`}
            onClick={() => go(item.path)}
            aria-current={isActive(item.path) ? 'page' : undefined}
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}

        {isRole('Admin', 'DataScientist') && (
          <>
            <div className="nav-section-label">Administration</div>
            {ADMIN_NAV.filter((item) => item.path !== '/admin/users' || isRole('Admin')).map((item) => (
              <button
                key={item.path}
                className={`nav-item${isActive(item.path) ? ' active' : ''}`}
                onClick={() => go(item.path)}
                aria-current={isActive(item.path) ? 'page' : undefined}
              >
                <item.icon size={17} />
                {item.label}
              </button>
            ))}
          </>
        )}

        <div className="nav-section-label">Account</div>
        <button
          className={`nav-item${isActive('/profile') ? ' active' : ''}`}
          onClick={() => go('/profile')}
        >
          <Settings size={17} />
          Profile &amp; Settings
        </button>
      </nav>

      {/* Footer user card */}
      <div className="sidebar-footer">
        <div className="sidebar-user" onClick={() => go('/profile')} role="button" tabIndex={0}>
          <div className="user-avatar">
            {user?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2) || 'U'}
          </div>
          <div className="user-info" style={{ flex: 1, minWidth: 0 }}>
            <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || 'User'}
            </div>
            <div className="user-role">{user?.role || 'Clinician'}</div>
          </div>
          <ChevronRight size={14} style={{ color: 'rgba(148,163,184,0.5)', flexShrink: 0 }} />
        </div>
        <button
          className="nav-item"
          style={{ marginTop: 4, color: '#f87171' }}
          onClick={logout}
        >
          <LogOut size={17} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
