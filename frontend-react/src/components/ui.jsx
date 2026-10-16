import {
  AlertCircle,
  ArrowRight,
  Inbox,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";

export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <div className="page-header">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  children,
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </div>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-sub">{description}</p>
      {children}
    </div>
  );
}
export function ErrorState({ error, retry }) {
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>We couldn’t load this information.</strong>
        <p>{error?.message || error || "Please try again."}</p>
      </div>
      {retry && (
        <button className="btn btn-ghost btn-sm" onClick={retry}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}
export function Loading({ label = "Loading workspace…" }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={20} />
      {label}
    </div>
  );
}
export function StatusBadge({ status }) {
  const style =
    { Complete: "green", Processing: "blue", Pending: "yellow", Failed: "red" }[
      status
    ] || "gray";
  return (
    <span className={`badge badge-${style}`}>
      <span className="status-dot" />
      {status || "Not available"}
    </span>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          {description && <p className="panel-description">{description}</p>}
        </div>
        {action}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}
export function TextLink({ to, children }) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={14} />
    </Link>
  );
}
export function Metadata({ items }) {
  return (
    <dl className="metadata-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value == null || value === ""
              ? "Not recorded"
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
