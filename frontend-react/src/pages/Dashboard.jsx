import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import {
  Plus,
  FolderOpen,
  ScanLine,
  Clock3,
  CircleCheck,
  ArrowUpRight,
  ArrowRight,
  Upload,
  FileText,
  Users,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import AppShell from "../components/AppShell";
import VesselArt from "../components/VesselArt";
import CaseTable from "../components/CaseTable";
import {
  PageHeader,
  Panel,
  ErrorState,
  EmptyState,
  TextLink,
} from "../components/ui";
import { formatDate } from "../lib/format";
import { useRemote } from "../hooks/useRemote";
import { casesApi } from "../api/cases";
import { useAuth } from "../context/AuthContext";
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export default function Dashboard() {
  const { user, isRole } = useAuth();
  const { data, loading, error, reload } = useRemote(casesApi.list);
  const cases = data || [];
  const [days, setDays] = useState(7);
  const [today] = useState(() => new Date().toISOString());
  const recent = [...cases]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  const counts = ["Complete", "Processing", "Pending", "Failed"].map(
    (status) => ({
      status,
      count: cases.filter((c) => c.status === status).length,
    }),
  );
  const colors = ["#222222", "#8a9a7b", "#bdc7b0", "#d5c9b8"];
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1 - i));
    return {
      date,
      count: cases.filter((c) => {
        const created = new Date(c.createdAt);
        return created >= date && created < new Date(date.getTime() + 86400000);
      }).length,
    };
  });
  const roleCopy = {
    Clinician: [
      "Your studies, at a glance.",
      "Keep your cases organized and your next steps in focus.",
    ],
    Researcher: [
      "A new day for discovery.",
      "Explore study activity and prepare your next research question.",
    ],
    DataScientist: [
      "From data to understanding.",
      "Inspect your study inputs and research pipeline readiness.",
    ],
    Admin: [
      "Your workspace, in view.",
      "Keep track of case activity, access, and workspace operations.",
    ],
  }[user?.role] || ["Your workspace, at a glance.", "Continue your research."];
  const stats = [
    [
      "Total cases",
      cases.length,
      FolderOpen,
      "All registered studies",
      "/cases",
    ],
    [
      "With study files",
      cases.filter((c) => c.hasImage || c.hasVolume).length,
      ScanLine,
      "Image or volume available",
      "/uploads",
    ],
    [
      "Awaiting processing",
      counts[2].count,
      Clock3,
      "Pending cases",
      "/cases?status=Pending",
    ],
    [
      "Cases complete",
      counts[0].count,
      CircleCheck,
      "Reported case status",
      "/cases?status=Complete",
    ],
  ];
  const actions = isRole("Clinician", "Admin")
    ? [
        [Plus, "Create a case", "Start a new imaging study", "/cases/new"],
        [Upload, "Upload a study", "Add files to an existing case", "/uploads"],
        [Users, "Manage patients", "Open your subject directory", "/patients"],
      ]
    : [
        [
          FolderOpen,
          "Explore cases",
          "Browse available research studies",
          "/cases",
        ],
        [
          FlaskConical,
          "Research workspace",
          "Review evaluation readiness",
          "/evaluation",
        ],
        [
          FileText,
          "Export case data",
          "Download structured records",
          "/reports",
        ],
      ];
  return (
    <AppShell breadcrumbs={[{ label: "Overview" }]}>
      <PageHeader
        eyebrow={`${user?.role || "Research"} workspace`}
        title={`Hello, ${user?.name?.split(" ")[0] || "researcher"}.`}
        description={roleCopy[1]}
      >
        {isRole("Clinician", "Admin") && (
          <Link className="btn btn-primary" to="/cases/new">
            <Plus size={15} />
            New case
          </Link>
        )}
        <Link className="btn btn-ghost" to="/reports">
          <FileText size={15} />
          Export center
        </Link>
      </PageHeader>
      <section className="overview-hero">
        <div>
          <div className="page-eyebrow">A CLEARER PERSPECTIVE</div>
          <h2>{roleCopy[0]}</h2>
          <p>
            Every study has a story. Bring its files, context, and research
            records together in one considered workspace.
          </p>
          <Link
            className="btn btn-light"
            to={isRole("Clinician", "Admin") ? "/uploads" : "/cases"}
          >
            {isRole("Clinician", "Admin")
              ? "Upload a study"
              : "Explore your cases"}
            <ArrowRight size={14} />
          </Link>
        </div>
        <VesselArt />
      </section>
      {error && <ErrorState error={error} retry={reload} />}
      <div className="stats-grid">
        {stats.map(([label, value, Icon, foot, path]) => (
          <Link className="stat-card" key={label} to={path}>
            <div className="stat-top">
              <span className="stat-label">{label}</span>
              <Icon size={17} strokeWidth={1.5} />
            </div>
            <div className="stat-value">{loading || error ? "—" : value}</div>
            <div className="stat-foot">
              {foot}
              <ArrowUpRight size={11} />
            </div>
          </Link>
        ))}
      </div>
      <div className="overview-main">
        <div className="stack">
          <Panel
            title="Study activity"
            description="New cases created over time"
            action={
              <div className="segmented">
                {[7, 30].map((n) => (
                  <button
                    key={n}
                    className={days === n ? "selected" : ""}
                    onClick={() => setDays(n)}
                  >
                    {n} days
                  </button>
                ))}
              </div>
            }
          >
            <div className="chart-heading">
              <span className="stat-value" style={{ fontSize: 27 }}>
                {loading || error
                  ? "—"
                  : daily.reduce((sum, d) => sum + d.count, 0)}{" "}
                <span
                  className="text-xs text-muted"
                  style={{ fontWeight: 400, letterSpacing: 0 }}
                >
                  new cases
                </span>
              </span>
              <span className="text-xs text-muted">Created, not processed</span>
            </div>
            <div className="chart-wrap">
              <Bar
                role="img"
                aria-label={`New cases created in the last ${days} days: ${daily.reduce((sum, day) => sum + day.count, 0)}. Counts are based on case creation timestamps.`}
                data={{
                  labels: daily.map((d) =>
                    d.date.toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                    }),
                  ),
                  datasets: [
                    {
                      label: "Cases created",
                      data: daily.map((d) => d.count),
                      backgroundColor: "#929f83",
                      hoverBackgroundColor: "#222222",
                      borderRadius: 3,
                      maxBarThickness: 30,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { backgroundColor: "#222222" },
                  },
                  scales: {
                    x: {
                      grid: { display: false },
                      border: { display: false },
                      ticks: {
                        color: "#8a9081",
                        font: { size: 9 },
                        maxTicksLimit: 7,
                        maxRotation: 0,
                      },
                    },
                    y: {
                      beginAtZero: true,
                      border: { display: false },
                      ticks: {
                        precision: 0,
                        color: "#8a9081",
                        font: { size: 9 },
                      },
                      grid: { color: "#eef0e8" },
                    },
                  },
                }}
              />
            </div>
          </Panel>
          <Panel
            title="Recent studies"
            action={<TextLink to="/cases">View all cases</TextLink>}
          >
            <CaseTable cases={recent} loading={loading} />
          </Panel>
        </div>
        <div className="stack">
          <Panel
            title="Case status"
            description="Current persisted workflow states"
          >
            <div className="status-track">
              {counts.map((c, i) => (
                <span
                  key={c.status}
                  style={{
                    width: `${cases.length ? (c.count / cases.length) * 100 : 0}%`,
                    background: colors[i],
                  }}
                />
              ))}
            </div>
            {counts.map((c, i) => (
              <Link
                to={`/cases?status=${c.status}`}
                className="status-row"
                key={c.status}
              >
                <span
                  className="status-dot"
                  style={{ background: colors[i], width: 6, height: 6 }}
                />
                <span>{c.status}</span>
                <strong>{error || loading ? "—" : c.count}</strong>
              </Link>
            ))}
          </Panel>
          <Panel title="Quick actions">
            {actions.map(([Icon, title, desc, to]) => (
              <Link className="quick-action" to={to} key={to}>
                <Icon size={17} strokeWidth={1.5} />
                <span>
                  {title}
                  <small>{desc}</small>
                </span>
                <ArrowUpRight size={14} />
              </Link>
            ))}
            {isRole("Admin") && (
              <Link to="/admin/system-health" className="quick-action">
                <ShieldCheck size={17} />
                <span>Check system health</span>
                <ArrowUpRight size={14} />
              </Link>
            )}
          </Panel>
          <Panel
            title="Latest case activity"
            description="Creation events from available case records"
          >
            {!recent.length ? (
              <EmptyState
                title="A fresh start"
                description="Your case activity will appear here."
              />
            ) : (
              recent.slice(0, 3).map((c) => (
                <Link
                  to={`/cases/${c.id}`}
                  key={c.id}
                  className="activity-item"
                >
                  <span className="activity-icon">
                    <FolderOpen size={14} />
                  </span>
                  <div>
                    <strong>{c.caseCode} created</strong>
                    <p>{formatDate(c.createdAt, true)}</p>
                  </div>
                </Link>
              ))
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
