import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  ScanLine,
  FileText,
  Bell,
  Settings,
  LogOut,
  Cpu,
  FlaskConical,
  Database,
  ChartNoAxesCombined,
  ShieldCheck,
  HeartPulse,
  BookOpen,
  ChevronRight,
  X,
} from "lucide-react";
import Brand from "./Brand";
import {
  CLINICAL_WRITERS,
  RESEARCH_READERS,
  ADMINISTRATORS,
} from "../constants/permissions";

export default function Sidebar({ onClose, hidden }) {
  const { user, logout, isRole } = useAuth();
  const groups = [
    [
      "WORKSPACE",
      [
        ["Overview", "/dashboard", LayoutDashboard],
        ...(isRole(...CLINICAL_WRITERS)
          ? [["Patients", "/patients", Users]]
          : []),
        ["Cases", "/cases", FolderOpen],
        ["Upload center", "/uploads", ScanLine],
        ["Reports & exports", "/reports", FileText],
        ["Notifications", "/notifications", Bell],
      ],
    ],
    ...(isRole(...RESEARCH_READERS)
      ? [
          [
            "RESEARCH",
            [
              ["Datasets", "/datasets", Database],
              ["Model evaluation", "/evaluation", ChartNoAxesCombined],
              ["Experiments", "/experiments", FlaskConical],
              ["Model registry", "/models", Cpu],
            ],
          ],
        ]
      : []),
    ...(isRole(...ADMINISTRATORS)
      ? [
          [
            "ADMINISTRATION",
            [
              ["User management", "/admin/users", Users],
              ["Audit trail", "/admin/audit-logs", ShieldCheck],
              ["System health", "/admin/system-health", HeartPulse],
            ],
          ],
        ]
      : []),
  ];
  return (
    <aside
      className="sidebar"
      aria-label="Workspace navigation"
      aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}
    >
      <div className="sidebar-brand">
        <Brand to="/dashboard" />
        <button
          className="icon-btn mobile-only"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="workspace-switch">
        <span className="workspace-mark">R</span>
        <div>
          <strong>Research workspace</strong>
          <small>{user?.institution || "Personal workspace"}</small>
        </div>
        <span className="workspace-tag">BETA</span>
      </div>
      <nav className="sidebar-nav">
        {groups.map(([label, items]) => (
          <div className="nav-group" key={label}>
            <div className="nav-section-label">{label}</div>
            {items.map(([name, path, Icon]) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/cases"}
                onClick={onClose}
                className={({ isActive }) =>
                  `nav-item${isActive ? " active" : ""}`
                }
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{name}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="nav-group nav-bottom">
          <NavLink
            to="/help"
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <BookOpen size={18} />
            Help & documentation
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <Settings size={18} />
            Account settings
          </NavLink>
        </div>
      </nav>
      <div className="sidebar-footer">
        <NavLink className="sidebar-user" to="/profile">
          <span className="user-avatar">
            {user?.name
              ?.split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2) || "U"}
          </span>
          <span className="user-info">
            <span className="user-name">{user?.name || "Researcher"}</span>
            <span className="user-role">{user?.role}</span>
          </span>
          <ChevronRight size={15} />
        </NavLink>
        <button className="signout-btn" onClick={logout}>
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
