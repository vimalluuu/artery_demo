import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppShell({ children, breadcrumbs }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const change = () => setMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const sidebar = document.querySelector(".sidebar");
    const previous = document.activeElement;
    sidebar.querySelector("button, a")?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key !== "Tab") return;
      const targets = [...sidebar.querySelectorAll("a, button")].filter(
        (element) => element.getClientRects().length,
      );
      const first = targets[0],
        last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [menuOpen, mobile]);
  return (
    <div className={`app-shell${menuOpen ? " menu-open" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <Sidebar
        hidden={mobile && !menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      <div
        className="main-content"
        inert={mobile && menuOpen ? true : undefined}
      >
        <Topbar breadcrumbs={breadcrumbs} onMenu={() => setMenuOpen(true)} />
        <main id="main-content" className="page-content fade-in" tabIndex={-1}>
          {children}
        </main>
        <footer className="workspace-footer">
          <span>VascuAI / Research workspace</span>
          <span>Experimental research visualization — not for diagnostic use.</span>
        </footer>
      </div>
    </div>
  );
}
