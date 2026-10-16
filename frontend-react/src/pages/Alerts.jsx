import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  AlertCircle,
  FolderPlus,
  ArrowUpRight,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Loading, ErrorState, EmptyState } from "../components/ui";
import { formatDate } from "../lib/format";
import { useRemote } from "../hooks/useRemote";
import { casesApi } from "../api/cases";
import { useAuth } from "../context/AuthContext";
import { getPreferences } from "../lib/preferences";

export default function Alerts() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useRemote(casesApi.list);
  const key = `vascuai_read_events_${user.id}`;
  const [read, setRead] = useState(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(stored)
          ? stored.filter((value) => typeof value === "string")
          : [];
      } catch {
        return [];
      }
    }),
    [filter, setFilter] = useState("All");
  function mark(ids) {
    setRead((old) => {
      const updated = [...new Set([...old, ...ids])].slice(-1000);
      localStorage.setItem(key, JSON.stringify(updated));
      return updated;
    });
  }
  const events = (data || [])
    .flatMap((c) => [
      {
        id: `created-${c.id}-${c.createdAt}`,
        title: `${c.caseCode} was created`,
        body: "A case record is available in your workspace.",
        time: c.createdAt,
        category: "Activity",
        caseId: c.id,
      },
      ...(c.status === "Failed"
        ? [
            {
              id: `failed-${c.id}`,
              title: `${c.caseCode} needs attention`,
              body: "This case currently has a failed status. Open its record to inspect the available context.",
              time: null,
              category: "Processing",
              caseId: c.id,
            },
          ]
        : []),
    ])
    .filter(
      (e) => getPreferences().showLocalActivity || e.category !== "Activity",
    )
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  const visible = events.filter(
    (e) =>
      filter === "All" ||
      (filter === "Unread" ? !read.includes(e.id) : e.category === filter),
  );
  return (
    <AppShell breadcrumbs={[{ label: "Notifications" }]}>
      <PageHeader
        eyebrow="WORKSPACE ACTIVITY"
        title="Stay in the loop."
        description="Case activity and processing states, drawn from available records."
      >
        <button
          className="btn btn-ghost"
          onClick={() => mark(events.map((e) => e.id))}
          disabled={!events.some((e) => !read.includes(e.id))}
        >
          <CheckCheck size={15} />
          Mark all read
        </button>
      </PageHeader>
      <div className="notice">
        This activity view is derived from cases you can access. Read state is
        saved on this device. A dedicated notification service is not connected.
      </div>
      <div className="segmented" style={{ marginBottom: 22 }}>
        {["All", "Unread", "Processing", "Activity"].map((f) => (
          <button
            key={f}
            className={filter === f ? "selected" : ""}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <div className="card">
          {!visible.length ? (
            <EmptyState
              icon={Bell}
              title="You’re all caught up."
              description="Relevant case activity will appear here. Adjust your activity preferences in settings."
            />
          ) : (
            visible.map((e) => (
              <article
                className={`notification${read.includes(e.id) ? " read" : ""}`}
                key={e.id}
              >
                <span className="activity-icon">
                  {e.category === "Processing" ? (
                    <AlertCircle size={16} />
                  ) : (
                    <FolderPlus size={16} />
                  )}
                </span>
                <div className="notification-content">
                  <h3>{e.title}</h3>
                  <p>{e.body}</p>
                  <div className="notification-time">
                    {e.time
                      ? formatDate(e.time, true)
                      : "Current status · Event timestamp unavailable"}{" "}
                    · {e.category}
                  </div>
                  <Link
                    className="text-link"
                    style={{ marginTop: 12 }}
                    to={`/cases/${e.caseId}`}
                    onClick={() => mark([e.id])}
                  >
                    Open case
                    <ArrowUpRight size={13} />
                  </Link>
                </div>
                {!read.includes(e.id) && (
                  <button
                    className="icon-btn"
                    aria-label={`Mark ${e.title} as read`}
                    onClick={() => mark([e.id])}
                  >
                    <CheckCheck size={14} />
                  </button>
                )}
              </article>
            ))
          )}
        </div>
      )}
    </AppShell>
  );
}
