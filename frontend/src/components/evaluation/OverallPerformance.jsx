
const METRICS = [
  { key: "dice", label: "Dice Score" },
  { key: "iou", label: "IoU" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
];

function formatMetric(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Pending";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function MetricGroup({ title, metrics }) {
  return (
    <section className="overall-performance-group">
      <h3>{title}</h3>

      <div className="overall-performance-grid">
        {METRICS.map(({ key, label }) => (
          <article className="overall-performance-card" key={key}>
            <span>{label}</span>
            <strong>{formatMetric(metrics?.[key])}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function OverallPerformance({ summary }) {
  const evaluatedCases =
    typeof summary?.successfullyEvaluatedCases === "number" &&
    Number.isFinite(summary.successfullyEvaluatedCases)
      ? summary.successfullyEvaluatedCases
      : null;

  return (
    <section
      className="overall-performance"
      aria-labelledby="overall-performance-title"
    >
      <div className="overall-performance-heading">
        <div>
          <h2 id="overall-performance-title">
            Overall Model Performance
          </h2>
          <p>
            Performance metrics from completed segmentation evaluations.
          </p>
        </div>

        <span className="overall-performance-status">
          {summary ? "Evaluation summary" : "Awaiting evaluation data"}
        </span>
      </div>

      <article className="overall-case-count">
        <span>Successfully evaluated cases</span>
        <strong>{evaluatedCases ?? "Pending"}</strong>
      </article>

      <MetricGroup
        title="Macro-average metrics"
        metrics={summary?.macroAverage}
      />

      <p className="overall-performance-description">
        Macro averages give equal weight to each successfully evaluated case.
      </p>

      <MetricGroup
        title="Pooled metrics"
        metrics={summary?.pooled}
      />

      <p className="overall-performance-description">
        Pooled metrics are calculated from combined evaluation totals,
        rather than averaging the individual case scores.
      </p>
    </section>
  );
}
