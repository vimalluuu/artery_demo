
import { useMemo, useState } from "react";

const STATUS_CLASSES = {
  completed: "evaluation-history-status-completed",
  pending: "evaluation-history-status-pending",
  running: "evaluation-history-status-running",
  failed: "evaluation-history-status-failed",
  stale: "evaluation-history-status-stale",
  integrity_error: "evaluation-history-status-failed",
};

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }

  return String(value);
}

function formatDate(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleString();
}

function getCaseCount(evaluation, type) {
  const count =
    evaluation.case_counts?.[type] ??
    evaluation[`${type}_cases`];

  return typeof count === "number" && Number.isFinite(count)
    ? count
    : "Not available";
}

export default function EvaluationHistory({
  history = [],
  status = "success",
  errorMessage,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const safeHistory = Array.isArray(history) ? history : [];

  const filteredHistory = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return safeHistory.filter((evaluation) => {
      const matchesSearch = [
        evaluation.evaluation_id,
        evaluation.run_id,
        evaluation.checkpoint_id,
        evaluation.split,
        evaluation.status,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(search));

      const matchesStatus =
        selectedStatus === "all" ||
        String(evaluation.status ?? "").toLowerCase() === selectedStatus;

      return matchesSearch && matchesStatus;
    });
  }, [safeHistory, searchTerm, selectedStatus]);

  return (
    <section
      className="evaluation-history-section"
      aria-labelledby="evaluation-history-title"
    >
      <div className="evaluation-history-heading">
        <div>
          <h2 id="evaluation-history-title">Evaluation History</h2>
          <p>
            Review previous segmentation evaluation runs and their results.
          </p>
        </div>

        <span className="evaluation-history-count">
          {safeHistory.length} evaluations
        </span>
      </div>

      {status === "loading" && (
        <div className="evaluation-history-message" role="status">
          Loading evaluation history...
        </div>
      )}

      {status === "error" && (
        <div className="evaluation-history-message evaluation-history-message--error" role="alert">
          {errorMessage || "Unable to load evaluation history."}
        </div>
      )}

      {status === "unavailable" && (
        <div className="evaluation-history-empty" role="status">
          <h3>Evaluation history unavailable</h3>
          <p>History data has not been supplied.</p>
        </div>
      )}

      {status === "success" && safeHistory.length === 0 && (
        <div className="evaluation-history-empty" role="status">
          <h3>No evaluation history yet</h3>
          <p>
            Previous evaluations will appear here when evaluation records
            become available.
          </p>
        </div>
      )}

      {status === "success" && safeHistory.length > 0 && (
        <>
          <div className="evaluation-history-filters">
            <div>
              <label htmlFor="evaluation-history-search">
                Search evaluations
              </label>
              <input
                id="evaluation-history-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by evaluation, run or checkpoint ID"
              />
            </div>

            <div>
              <label htmlFor="evaluation-history-status">
                Filter by status
              </label>
              <select
                id="evaluation-history-status"
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="failed">Failed</option>
                <option value="stale">Stale</option>
                <option value="integrity_error">Integrity error</option>
              </select>
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="evaluation-history-empty" role="status">
              <h3>No matching evaluations</h3>
              <p>Try changing your search or status filter.</p>
            </div>
          ) : (
            <div className="evaluation-history-table-wrapper">
              <table className="evaluation-history-table">
                <caption>
                  Previous segmentation evaluations, including their
                  status and case counts.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Evaluation ID</th>
                    <th scope="col">Run ID</th>
                    <th scope="col">Checkpoint ID</th>
                    <th scope="col">Split</th>
                    <th scope="col">Status</th>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Evaluated cases</th>
                    <th scope="col">Excluded cases</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((evaluation, index) => {
                    const evaluationStatus = String(
                      evaluation.status ?? "unavailable"
                    ).toLowerCase();

                    return (
                      <tr
                        key={
                          evaluation.evaluation_id ||
                          `${evaluation.run_id || "run"}-${index}`
                        }
                      >
                        <td>{displayValue(evaluation.evaluation_id)}</td>
                        <td>{displayValue(evaluation.run_id)}</td>
                        <td>{displayValue(evaluation.checkpoint_id)}</td>
                        <td>{displayValue(evaluation.split)}</td>
                        <td>
                          <span
                            className={`evaluation-history-status ${
                              STATUS_CLASSES[evaluationStatus] ||
                              "evaluation-history-status-unavailable"
                            }`}
                          >
                            {evaluationStatus.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          {formatDate(
                            evaluation.timestamp ||
                            evaluation.completed_at ||
                            evaluation.created_at
                          )}
                        </td>
                        <td>{getCaseCount(evaluation, "evaluated")}</td>
                        <td>{getCaseCount(evaluation, "excluded")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
