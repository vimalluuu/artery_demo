
import { useMemo, useState } from "react";

const METRICS = [
  { key: "dice", label: "Dice" },
  { key: "iou", label: "IoU" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
];

function formatMetric(value, status) {
  if (status !== "completed") {
    return "Pending";
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Not measured";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function formatStatus(status) {
  const labels = {
    completed: "Completed",
    pending: "Pending",
    running: "Running",
    failed: "Failed",
  };

  return labels[status] || "Unknown";
}

export default function CaseEvaluationTable({ cases = [] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("caseId");
  const [sortDirection, setSortDirection] = useState("asc");

  const filteredCases = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = cases.filter((item) => {
      const searchableText = [
        item.caseId,
        item.modelVersion,
        item.checkpoint,
        item.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });

    return [...filtered].sort((a, b) => {
      const first = a[sortKey] ?? "";
      const second = b[sortKey] ?? "";

      const comparison =
        typeof first === "number" && typeof second === "number"
          ? first - second
          : String(first).localeCompare(String(second));

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [cases, search, sortKey, sortDirection]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDirection((current) =>
        current === "asc" ? "desc" : "asc"
      );
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function sortButton(label, key) {
    return (
      <button
        type="button"
        className="case-sort-button"
        onClick={() => handleSort(key)}
        aria-label={`Sort by ${label}`}
        aria-sort={
          sortKey === key
            ? sortDirection === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        {label}
        {sortKey === key
          ? sortDirection === "asc"
            ? " ↑"
            : " ↓"
          : ""}
      </button>
    );
  }

  return (
    <section
      className="case-evaluation-section"
      aria-labelledby="case-evaluation-title"
    >
      <div className="case-evaluation-heading">
        <div>
          <h2 id="case-evaluation-title">
            Case-wise Evaluation
          </h2>
          <p>
            Segmentation metrics for individual validation cases.
          </p>
        </div>

        <span className="case-count">
          {cases.length} {cases.length === 1 ? "case" : "cases"}
        </span>
      </div>

      <label className="case-search-label" htmlFor="case-search">
        Search by case, model, checkpoint or status
      </label>

      <input
        id="case-search"
        className="case-search-input"
        type="search"
        placeholder="Search evaluations..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {cases.length === 0 ? (
        <div className="case-evaluation-empty" role="status">
          <h3>No case evaluations available</h3>
          <p>
            Case-wise results will appear here when the backend
            evaluation data becomes available.
          </p>
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="case-evaluation-empty" role="status">
          <h3>No matching cases found</h3>
          <p>Try another search term.</p>
        </div>
      ) : (
        <div className="case-table-wrapper">
          <table className="case-evaluation-table">
            <thead>
              <tr>
                <th>{sortButton("Case ID", "caseId")}</th>
                <th>{sortButton("Model Version", "modelVersion")}</th>
                <th>{sortButton("Checkpoint", "checkpoint")}</th>
                {METRICS.map(({ key, label }) => (
                  <th key={key}>{label}</th>
                ))}
                <th>{sortButton("Status", "status")}</th>
              </tr>
            </thead>

            <tbody>
              {filteredCases.map((item) => (
                <tr key={item.caseId}>
                  <td>{item.caseId || "Unavailable"}</td>
                  <td>{item.modelVersion || "Unavailable"}</td>
                  <td>{item.checkpoint || "Unavailable"}</td>

                  {METRICS.map(({ key }) => (
                    <td key={key}>
                      {formatMetric(item.metrics?.[key], item.status)}
                    </td>
                  ))}

                  <td>
                    <span
                      className={`case-status case-status-${item.status}`}
                    >
                      {formatStatus(item.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
