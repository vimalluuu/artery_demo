
import { Fragment, useState } from "react";

function formatStatus(status) {
  if (!status) return "Pending";

  const labels = {
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
  };

  return labels[status.toLowerCase()] || "Unavailable";
}

function StatusBadge({ status }) {
  const normalizedStatus = ["pending", "running", "completed", "failed"]
    .includes(status?.toLowerCase())
    ? status.toLowerCase()
    : "unavailable";

  return (
    <span className={`training-status training-status-${normalizedStatus}`}>
      {formatStatus(status)}
    </span>
  );
}

export default function TrainingRunHistory({ runs = [] }) {
  const [expandedRun, setExpandedRun] = useState(null);

  return (
    <section
      className="training-history-section"
      aria-labelledby="training-history-title"
    >
      <div className="training-history-heading">
        <div>
          <h2 id="training-history-title">
            Training and Evaluation History
          </h2>
          <p>
            Review model training runs, saved checkpoints and evaluation progress.
          </p>
        </div>

        <span className="training-history-count">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>

      {runs.length === 0 ? (
        <div className="training-history-empty" role="status">
          <h3>No training history available</h3>
          <p>
            Training runs and evaluation details will appear here
            when the backend provides the history data.
          </p>
        </div>
      ) : (
        <div className="training-history-table-wrapper">
          <table className="training-history-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Architecture</th>
                <th>Checkpoint</th>
                <th>Training Status</th>
                <th>Evaluation Status</th>
                <th>Details</th>
              </tr>
            </thead>

            <tbody>
              {runs.map((run, index) => {
                const runId = run.runId || `run-${index}`;
                const isExpanded = expandedRun === runId;

                return (
                  <Fragment key={runId}>
                    <tr>
                      <td>{run.runId || "Unavailable"}</td>
                      <td>{run.architecture || "Unavailable"}</td>
                      <td>{run.checkpoint || "Unavailable"}</td>
                      <td>
                        <StatusBadge status={run.trainingStatus} />
                      </td>
                      <td>
                        <StatusBadge status={run.evaluationStatus} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="training-details-button"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpandedRun(isExpanded ? null : runId)
                          }
                        >
                          {isExpanded ? "Hide details" : "View details"}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={6}>
                          <div className="training-run-details">
                            <p>
                              <strong>Run ID:</strong>{" "}
                              {run.runId || "Unavailable"}
                            </p>
                            <p>
                              <strong>Architecture:</strong>{" "}
                              {run.architecture || "Unavailable"}
                            </p>
                            <p>
                              <strong>Checkpoint reference:</strong>{" "}
                              {run.checkpoint || "Unavailable"}
                            </p>
                            <p>
                              <strong>Evaluation ID:</strong>{" "}
                              {run.evaluationId || "Not available"}
                            </p>
                            <p>
                              <strong>Created at:</strong>{" "}
                              {run.createdAt || "Not available"}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
