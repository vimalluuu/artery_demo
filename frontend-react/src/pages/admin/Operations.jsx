import { useState } from "react";
import {
  Search,
  ShieldCheck,
  HeartPulse,
  RefreshCw,
  CircleDashed,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import AppShell from "../../components/AppShell";
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  EmptyState,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useRemote } from "../../hooks/useRemote";
import api from "../../api/client";
import { checkHealth } from "../../api/health";

const loadAudit = async () => {
  let events = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data } = await api.get("/admin/audit", {
      params: { limit: 500, offset },
    });
    events.push(...data);
    if (data.length < 500) break;
  }
  return events;
};
export function AuditLogs() {
  const { data, loading, error, reload } = useRemote(loadAudit);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [page, setPage] = useState(1);
  const rows = (data || []).filter(
    (e) =>
      (!query ||
        `${e.action} ${e.actor_id ?? ""} ${e.resource_id ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (category === "All" || e.action.startsWith(category + ".")),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, pages);
  return (
    <AppShell
      breadcrumbs={[{ label: "Administration" }, { label: "Audit trail" }]}
    >
      <PageHeader
        eyebrow="ACCOUNTABILITY"
        title="A record of what matters."
        description="Recorded account, access, and study events from the server."
      >
        <button className="btn btn-ghost" onClick={reload}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </PageHeader>
      <div className="filters-bar">
        <div className="search-bar">
          <Search size={15} />
          <input
            aria-label="Search audit events"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search action, actor, or resource…"
          />
        </div>
        <select
          aria-label="Filter audit category"
          className="form-select filter-select"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="All">All categories</option>
          {[...new Set((data || []).map((e) => e.action.split(".")[0]))].map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </select>
      </div>
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <Panel
          title="Audit events"
          description="Latest available events, up to 5,000 records. Identifiers refer to server records."
        >
          {loading ? (
            <Loading />
          ) : !rows.length ? (
            <EmptyState
              icon={ShieldCheck}
              title="No matching events"
              description="Try a different action, actor, or category."
            />
          ) : (
            <>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Event ID</th>
                      <th>Timestamp</th>
                      <th>Action</th>
                      <th>Actor ID</th>
                      <th>Resource ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice((current - 1) * 20, current * 20).map((e) => (
                      <tr key={e.id}>
                        <td className="text-muted">#{e.id}</td>
                        <td>{formatDate(e.created_at, true)}</td>
                        <td className="mono">{e.action}</td>
                        <td>{e.actor_id ?? "System / unavailable"}</td>
                        <td>{e.resource_id ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-footer">
                <span>{rows.length} matching events</span>
                <div className="pagination">
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={current === 1}
                    onClick={() => setPage(current - 1)}
                  >
                    Previous
                  </button>
                  {current} / {pages}
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={current === pages}
                    onClick={() => setPage(current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </Panel>
      )}
    </AppShell>
  );
}
export function SystemHealth() {
  const { data, loading, error, reload } = useRemote(checkHealth);
  return (
    <AppShell
      breadcrumbs={[{ label: "Administration" }, { label: "System health" }]}
    >
      <PageHeader
        eyebrow="WORKSPACE OPERATIONS"
        title="Keep an eye on the essentials."
        description="On-demand availability checks for connected services."
      >
        <button className="btn btn-primary" disabled={loading} onClick={reload}>
          <RefreshCw size={14} />
          Run health check
        </button>
      </PageHeader>
      {error && <ErrorState error={error} retry={reload} />}
      <div className="equal-columns" style={{ marginBottom: 24 }}>
        {["API availability", "Database readiness"].map((label, i) => (
          <Panel key={label} title={label} action={<HeartPulse size={18} />}>
            {loading ? (
              <Loading label="Checking service…" />
            ) : (
              <div>
                <div className="readiness-item">
                  {data?.checks[i].available ? (
                    <CheckCircle size={22} style={{ color: "#738b60" }} />
                  ) : (
                    <AlertCircle size={22} style={{ color: "#9a4d43" }} />
                  )}
                  <div>
                    <strong>
                      {data?.checks[i].available ? "Available" : "Unavailable"}
                    </strong>
                    <p>{data?.checks[i].detail}</p>
                  </div>
                </div>
                <p className="form-hint">
                  Checked {formatDate(data?.checkedAt, true)}
                </p>
              </div>
            )}
          </Panel>
        ))}
      </div>
      <Panel
        title="Additional services"
        description="Status is unknown unless a dedicated monitor is connected."
      >
        {[
          [
            "Inference service",
            "No model-serving health endpoint is connected.",
          ],
          [
            "Background queue",
            "Queue depth and job telemetry are unavailable.",
          ],
          ["Storage service", "No storage health endpoint is exposed."],
          [
            "Compute & performance",
            "GPU metrics and processing latency are not instrumented.",
          ],
        ].map(([title, desc]) => (
          <div className="readiness-item" key={title}>
            <CircleDashed size={18} />
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
            <span className="badge badge-gray">Not monitored</span>
          </div>
        ))}
      </Panel>
    </AppShell>
  );
}
