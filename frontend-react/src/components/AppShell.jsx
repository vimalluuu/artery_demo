import Sidebar from './Sidebar';
import Topbar  from './Topbar';

export default function AppShell({ children, breadcrumbs }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Topbar breadcrumbs={breadcrumbs} />
        <main className="page-content fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
