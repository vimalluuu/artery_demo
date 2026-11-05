
import "./SegmentationEvaluationDashboard.css";
import OverallPerformance from "./OverallPerformance.jsx";
import CaseEvaluationTable from "./CaseEvaluationTable.jsx";
import ModelComparison from "./ModelComparison.jsx";
import TrainingRunHistory from "./TrainingRunHistory.jsx";
import EvaluationHistory from "./EvaluationHistory.jsx";
const METRICS = [
  { key: "dice", label: "Dice coefficient", percentage: true },
  { key: "iou", label: "Intersection over Union (IoU)", percentage: true },
  { key: "precision", label: "Precision", percentage: true },
  { key: "recall", label: "Recall / Sensitivity", percentage: true },
  { key: "boundaryDistance", label: "Average boundary distance" },
  { key: "hausdorff95", label: "95th percentile Hausdorff distance" },
];

function formatMetric(value, percentage = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Not measured";
  }

  return percentage ? `${(value * 100).toFixed(2)}%` : String(value);
}

function EvaluationIdentity({ evaluation }) {
  return (
    <dl className="evaluation-identity">
      <div>
        <dt>Model</dt>
        <dd>{evaluation.modelName || "Not specified"}</dd>
      </div>
      <div>
        <dt>Validation split</dt>
        <dd>{evaluation.validationSplit || "Not specified"}</dd>
      </div>
      <div>
        <dt>Evaluation run</dt>
        <dd>{evaluation.runId || "Not specified"}</dd>
      </div>
    </dl>
  );
}

function MetricCard({ label, value, percentage }) {
  return (
    <article className="evaluation-metric">
      <h3>{label}</h3>
      <p className="evaluation-metric__value">
        {formatMetric(value, percentage)}
      </p>
    </article>
  );
}

export default function SegmentationEvaluationDashboard({
  status = "success",
  evaluations = [],
  errorMessage,
  summary = null,
  caseEvaluations = [],
  modelComparisons = [],
  trainingRuns = [],
  evaluationHistory = [],
}) {
  const validStatuses = ["loading", "error", "unavailable", "success"];
  const currentStatus = validStatuses.includes(status)
    ? status
    : "unavailable";

  const safeEvaluations = Array.isArray(evaluations) ? evaluations : [];

  return (
    <main
      className="evaluation-dashboard"
      aria-labelledby="evaluation-title"
    >
      <header className="evaluation-header">
        <div>
          <p className="evaluation-eyebrow">VascuAI </p>
          <h1 id="evaluation-title">Segmentation Evaluation</h1>
          <p className="evaluation-subtitle">
            Review model performance using available validation metrics.
          </p>
        </div>
        <span className="evaluation-status-badge">Experimental</span>
      </header>

      <aside
        className="evaluation-warning"
        aria-label="Experimental use warning"
      >
        <strong>Experimental results — not for clinical use.</strong>
        <p>
          These results are for research and model evaluation only.
          They must not be used to diagnose conditions or make treatment
          decisions.
        </p>
      </aside>
      <OverallPerformance summary={summary} />
      <CaseEvaluationTable cases={caseEvaluations} />
      <ModelComparison results={modelComparisons} />
      <TrainingRunHistory runs={trainingRuns} />
      <EvaluationHistory history={evaluationHistory} />
      <section
        className="evaluation-section"
        aria-labelledby="results-title"
      >
        <h2 id="results-title">Evaluation results</h2>

        {currentStatus === "loading" && (
          <div className="evaluation-message" role="status">
            <span className="evaluation-spinner" aria-hidden="true" />
            <p>Loading evaluation results…</p>
          </div>
        )}

        {currentStatus === "error" && (
          <div
            className="evaluation-message evaluation-message--error"
            role="alert"
          >
            <h3>Unable to load evaluation results</h3>
            <p>
              {errorMessage ||
                "An unexpected error occurred. Please try again later."}
            </p>
          </div>
        )}

        {currentStatus === "unavailable" && (
          <div className="evaluation-message" role="status">
            <h3>Evaluation data unavailable</h3>
            <p>
              Results cannot currently be displayed because evaluation
              data has not been supplied.
            </p>
          </div>
        )}

        {currentStatus === "success" && safeEvaluations.length === 0 && (
          <div className="evaluation-message" role="status">
            <h3>No evaluation results yet</h3>
            <p>
              Metrics will appear here after an evaluation is completed
              and its results are provided.
            </p>
          </div>
        )}

        {currentStatus === "success" &&
          safeEvaluations.map((evaluation, index) => (
            <article
              className="evaluation-run"
              key={evaluation.runId || `${evaluation.modelName || "model"}-${index}`}
            >
              <EvaluationIdentity evaluation={evaluation} />

              <h3 className="evaluation-run__heading">
                Segmentation metrics
              </h3>
              <div className="evaluation-metrics-grid">
                {METRICS.filter((metric) => metric.percentage).map(
                  ({ key, label, percentage }) => (
                    <MetricCard
                      key={key}
                      label={label}
                      percentage={percentage}
                      value={evaluation.metrics?.[key]}
                    />
                  )
                )}
              </div>

              <h3 className="evaluation-run__heading">
                Boundary-distance metrics
              </h3>
              <div className="evaluation-metrics-grid evaluation-metrics-grid--boundary">
                {METRICS.filter((metric) => !metric.percentage).map(
                  ({ key, label }) => (
                    <MetricCard
                      key={key}
                      label={label}
                      value={evaluation.metrics?.[key]}
                    />
                  )
                )}
              </div>
              <p className="evaluation-note">
                Boundary-distance values are displayed without unit
                conversion. Confirm their units and definitions before
                interpreting or comparing them.
              </p>
            </article>
          ))}

        {currentStatus === "success" && safeEvaluations.length > 1 && (
          <section
            className="evaluation-comparison"
            aria-labelledby="comparison-title"
          >
            <h3 id="comparison-title">Model comparison</h3>
            <div className="evaluation-table-wrapper">
              <table>
                <caption>
                  Supplied evaluation runs. Missing values are not measured.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Model / run</th>
                    <th scope="col">Validation split</th>
                    {METRICS.map(({ key, label }) => (
                      <th scope="col" key={key}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {safeEvaluations.map((evaluation, index) => (
                    <tr key={evaluation.runId || `comparison-${index}`}>
                      <th scope="row">
                        {evaluation.modelName || "Not specified"}
                        <br />
                        <small>{evaluation.runId || "Run not specified"}</small>
                      </th>
                      <td>{evaluation.validationSplit || "Not specified"}</td>
                      {METRICS.map(({ key, percentage }) => (
                        <td key={key}>
                          {formatMetric(
                            evaluation.metrics?.[key],
                            percentage
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>

      <footer className="evaluation-footer">
        Experimental evaluation interface · No clinical conclusions are provided.
      </footer>
    </main>
  );
}
