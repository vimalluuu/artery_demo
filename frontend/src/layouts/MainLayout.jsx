
import "./MainLayout.css";

const navigationItems = [
  "Dashboard",
  "New Analysis",
  "Analysis History",
  "Reports",
  "Segmentation Evaluation",
  "Settings",
];

export default function MainLayout({
  children,
  activePage,
  onNavigate,
}) {
  return (
    <div className="vascuai-layout">
      <aside className="vascuai-sidebar">
        <h2 className="vascuai-brand">VascuAI</h2>
        <p className="vascuai-sidebar-label">WORKSPACE</p>

        <nav aria-label="Main navigation">
          {navigationItems.map((item) => (
            <button
              key={item}
              type="button"
              className={
                activePage === item
                  ? "vascuai-nav-item active"
                  : "vascuai-nav-item"
              }
              onClick={() => onNavigate(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="vascuai-sidebar-footer">
          Research interface · Experimental
        </div>
      </aside>

      <main className="vascuai-main">
        <header className="vascuai-topbar">
          <span>
            Artery Segmentation &amp; Stenosis Detection
          </span>
          <span className="vascuai-user-label">
            Research workspace
          </span>
        </header>

        <div className="vascuai-content">{children}</div>
      </main>
    </div>
  );
}
