import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FileText,
  Search,
  Download,
  ArrowUpRight,
  Printer,
  Info,
} from "lucide-react";
import AppShell from "../components/AppShell";
import Brand from "../components/Brand";
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  EmptyState,
  StatusBadge,
  Metadata,
} from "../components/ui";
import { formatDate } from "../lib/format";
import { casesApi } from "../api/cases";
import { useRemote } from "../hooks/useRemote";
import { useCase } from "../hooks/useCase";
import { downloadRecords } from "../lib/exports";

export default function Reports() {
  const { data, loading, error, reload } = useRemote(casesApi.list);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("All");
  const cases = (data || []).filter(
    (c) =>
      c.caseCode.toLowerCase().includes(query.toLowerCase()) &&
      (status === "All" || status === c.status),
  );
  return (
    <AppShell breadcrumbs={[{ label: "Reports & exports" }]}>
      <PageHeader
        eyebrow="RESEARCH RECORDS"
        title="Put your work in perspective."
        description="Preview case summaries and export the records you can access."
      />
      <div className="notice">
        <Info size={16} />
        <span>
          These exports contain persisted case metadata. Open a case's stenosis
          history for separately authorized structured analysis reports. Genuine
          analysis generation remains unavailable with the current provider.
        </span>
      </div>
      <div className="filters-bar">
        <div className="search-bar">
          <Search size={15} />
          <input
            aria-label="Search case summaries"
            placeholder="Find a case summary…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter case summaries by status"
          className="form-select filter-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["All", "Pending", "Processing", "Complete", "Failed"].map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <div className="page-actions" style={{ marginLeft: "auto" }}>
          <button
            className="btn btn-ghost"
            disabled={!cases.length}
            onClick={() => downloadRecords(cases, "csv")}
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            className="btn btn-ghost"
            disabled={!cases.length}
            onClick={() => downloadRecords(cases, "json")}
          >
            <Download size={14} />
            Export JSON
          </button>
        </div>
      </div>
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <Panel
          title="Available case summaries"
          description="Documents are generated on demand from current case data."
        >
          {loading ? (
            <Loading />
          ) : !cases.length ? (
            <EmptyState
              icon={FileText}
              title="Your research records belong here"
              description="Case summaries become available when cases are created."
            />
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Case summary</th>
                    <th>Study</th>
                    <th>Case status</th>
                    <th>Case created</th>
                    <th>Formats</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link className="table-title" to={`/reports/${c.id}`}>
                          <span className="table-file-icon">
                            <FileText size={16} />
                          </span>
                          <strong className="table-code">{c.caseCode}</strong>
                        </Link>
                      </td>
                      <td className="text-muted">
                        {c.modality || c.studyType}
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="text-muted">{formatDate(c.createdAt)}</td>
                      <td className="text-xs">JSON · CSV · Print</td>
                      <td>
                        <Link
                          className="icon-btn"
                          to={`/reports/${c.id}`}
                          aria-label={`Preview summary ${c.caseCode}`}
                        >
                          <ArrowUpRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </AppShell>
  );
}
export function ReportPreview() {
  const { id } = useParams();
  const { data: item, loading, error, reload } = useCase();
  const [preparedAt] = useState(() => new Date().toISOString());
  return (
    <AppShell
      breadcrumbs={[
        { label: "Reports", href: "/reports" },
        { label: item?.caseCode || id },
      ]}
    >
      <PageHeader
        eyebrow="CASE SUMMARY"
        title={item?.caseCode || "Case summary"}
        description="A printable snapshot of the current persisted case record."
      >
        {item && (
          <>
            <button
              className="btn btn-ghost"
              onClick={() => downloadRecords([item], "json")}
            >
              <Download size={14} />
              JSON
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => downloadRecords([item], "csv")}
            >
              <Download size={14} />
              CSV
            </button>
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer size={14} />
              Print / save PDF
            </button>
          </>
        )}
      </PageHeader>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <article className="card report-sheet">
          <div className="report-brand-row">
            <Brand to="/dashboard" />
            <span className="badge badge-gray">RESEARCH CASE RECORD</span>
          </div>
          <h2>Study summary</h2>
          <p className="report-reference">
            {item.caseCode} / Prepared from current case metadata on{" "}
            {formatDate(preparedAt, true)}
          </p>
          <h3>01 / Case & study information</h3>
          <Metadata
            items={[
              ["Case reference", item.caseCode],
              ["Subject reference", `#${item.patientId}`],
              ["Study type", item.studyType],
              ["Modality", item.modality],
              ["Anatomical region", item.region],
              ["Scan date", item.scanDate ? formatDate(item.scanDate) : null],
              ["Case created", formatDate(item.createdAt, true)],
              ["Case status", item.status],
            ]}
          />
          <h3>02 / Input availability</h3>
          <Metadata
            items={[
              ["2D image", item.hasImage ? "Uploaded" : "Not uploaded"],
              ["NIfTI volume", item.hasVolume ? "Uploaded" : "Not uploaded"],
            ]}
          />
          <h3>03 / Analysis & review</h3>
          <div className="notice">
            <span>
              This summary includes case metadata only. Use the case segmentation
              workspace to review segmentation history and any available outputs.
              Case status is a workflow value and does not certify an AI result.{" "}
              <Link to={`/cases/${item.id}/analysis`}>
                Open case segmentation workspace
              </Link>
              {" "}<Link to={`/cases/${item.id}/stenosis/report`}>Open stenosis analytics and reports</Link>
            </span>
          </div>
          <h3>04 / Study notes</h3>
          <p
            className="text-sm text-muted"
            style={{ whiteSpace: "pre-wrap", lineHeight: 1.9 }}
          >
            {item.notes || "No study notes recorded."}
          </p>
          <div className="divider" />
          <p className="text-xs text-muted" style={{ lineHeight: 1.9 }}>
            VascuAI is an AI-assisted research prototype. This document is a
            case metadata summary, not a diagnostic report. All future findings
            require qualified review.
          </p>
        </article>
      )}
    </AppShell>
  );
}
