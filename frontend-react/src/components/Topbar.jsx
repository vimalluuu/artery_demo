import { Link, useNavigate } from "react-router-dom";
import { Bell, Search, Menu, ArrowUpRight } from "lucide-react";
import { useState } from "react";

export default function Topbar({ breadcrumbs = [], onMenu }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button
          className="icon-btn mobile-only"
          aria-label="Open navigation"
          onClick={onMenu}
        >
          <Menu size={19} />
        </button>
        <nav className="topbar-left" aria-label="Breadcrumb">
          <Link to="/dashboard">Workspace</Link>
          {breadcrumbs.map((item, index) => (
            <span key={index}>
              <span className="sep">/</span>
              {item.href ? (
                <Link to={item.href}>{item.label}</Link>
              ) : (
                <span
                  aria-current={
                    index === breadcrumbs.length - 1 ? "page" : undefined
                  }
                >
                  {item.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="topbar-right">
        <form
          className="global-search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(`/cases?q=${encodeURIComponent(query.trim())}`);
          }}
        >
          <Search size={15} />
          <input
            aria-label="Search cases"
            placeholder="Search cases…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>↵</kbd>
        </form>
        <Link to="/help" className="research-label">
          Research use
          <ArrowUpRight size={13} />
        </Link>
        <Link
          className="icon-btn"
          to="/notifications"
          aria-label="Notifications"
        >
          <Bell size={18} />
        </Link>
      </div>
    </header>
  );
}
