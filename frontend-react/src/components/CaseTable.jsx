import { Link } from "react-router-dom";
import { ArrowUpRight, FileScan, ArrowDownUp } from "lucide-react";
import { EmptyState, Loading, StatusBadge } from "./ui";
import { formatDate } from "../lib/format";
export default function CaseTable({ cases, loading, onSort, emptyAction }) {
  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {[
              ["caseCode", "Case reference"],
              ["patientId", "Subject"],
              ["modality", "Modality"],
              ["status", "Status"],
              ["createdAt", "Created"],
            ].map(([key, label]) => (
              <th key={key}>
                {onSort ? (
                  <button className="sort-button" onClick={() => onSort(key)}>
                    {label}
                    <ArrowDownUp size={11} />
                  </button>
                ) : (
                  label
                )}
              </th>
            ))}
            <th>Study files</th>
            <th>
              <span className="sr-only">Open case</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7}>
                <Loading label="Loading studies…" />
              </td>
            </tr>
          ) : !cases.length ? (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  icon={FileScan}
                  title="No studies to show"
                  description="Create a case to begin, or adjust your filters to find a different study."
                >
                  {emptyAction}
                </EmptyState>
              </td>
            </tr>
          ) : (
            cases.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link to={`/cases/${item.id}`} className="table-title">
                    <span className="table-file-icon">
                      <FileScan size={16} />
                    </span>
                    <span className="table-code">{item.caseCode}</span>
                  </Link>
                </td>
                <td className="table-secondary">Subject #{item.patientId}</td>
                <td>{item.modality || "—"}</td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td className="table-secondary">
                  {formatDate(item.createdAt)}
                </td>
                <td className="table-secondary">
                  {[
                    item.hasVolume ? "Volume" : null,
                    item.hasImage ? "2D image" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No files"}
                </td>
                <td>
                  <Link
                    to={`/cases/${item.id}`}
                    className="icon-btn"
                    aria-label={`Open case ${item.caseCode}`}
                  >
                    <ArrowUpRight size={15} />
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
