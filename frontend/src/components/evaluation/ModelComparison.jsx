
import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
);

const METRICS = [
  { key: "dice", label: "Dice Score" },
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

export default function ModelComparison({ results = [] }) {
  const [selectedMetric, setSelectedMetric] = useState("dice");

  const selectedMetricLabel =
    METRICS.find((metric) => metric.key === selectedMetric)?.label ??
    "Dice Score";

  const chartResults = useMemo(
    () =>
      results.filter(
        (item) =>
          item.status === "completed" &&
          typeof item.metrics?.[selectedMetric] === "number" &&
          Number.isFinite(item.metrics[selectedMetric])
      ),
    [results, selectedMetric]
  );

  const chartData = {
    labels: chartResults.map(
      (item) => `${item.modelVersion} · ${item.checkpoint}`
    ),
    datasets: [
      {
        label: selectedMetricLabel,
        data: chartResults.map(
          (item) => item.metrics[selectedMetric] * 100
        ),
        backgroundColor: "#176b87",
        borderRadius: 6,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top",
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        min: 0,
        max: 100,
        title: {
          display: true,
          text: "Score (%)",
        },
      },
      x: {
        ticks: {
          autoSkip: false,
          maxRotation: 35,
          minRotation: 0,
        },
      },
    },
  };

  return (
    <section
      className="model-comparison-section"
      aria-labelledby="model-comparison-title"
    >
      <div className="model-comparison-heading">
        <div>
          <h2 id="model-comparison-title">Model Comparison</h2>
          <p>
            Compare segmentation performance across model versions
            and checkpoints.
          </p>
        </div>

        <span className="model-comparison-count">
          {results.length} {results.length === 1 ? "result" : "results"}
        </span>
      </div>

      {results.length === 0 ? (
        <div className="model-comparison-empty" role="status">
          <h3>No model comparison data available</h3>
          <p>
            Model comparisons will appear here after completed
            evaluations are provided by the backend.
          </p>
        </div>
      ) : (
        <>
          <div className="model-comparison-chart-header">
            <div>
              <h3>Performance Comparison Chart</h3>
              <label htmlFor="comparison-metric">
                Select metric
              </label>
            </div>

            <select
              id="comparison-metric"
              value={selectedMetric}
              onChange={(event) =>
                setSelectedMetric(event.target.value)
              }
            >
              {METRICS.map((metric) => (
                <option key={metric.key} value={metric.key}>
                  {metric.label}
                </option>
              ))}
            </select>
          </div>

          {chartResults.length > 0 ? (
            <div
              className="model-comparison-chart"
              role="img"
              aria-label={`${selectedMetricLabel} comparison across completed model evaluations`}
            >
              <Bar data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div className="model-comparison-empty" role="status">
              <p>
                No completed results are available for{" "}
                {selectedMetricLabel}.
              </p>
            </div>
          )}

          <h3 className="model-comparison-table-title">
            Model and checkpoint details
          </h3>

          <div className="model-comparison-table-wrapper">
            <table className="model-comparison-table">
              <thead>
                <tr>
                  <th>Model Version</th>
                  <th>Architecture</th>
                  <th>Checkpoint</th>
                  <th>Dice</th>
                  <th>IoU</th>
                  <th>Precision</th>
                  <th>Recall</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {results.map((item, index) => (
                  <tr
                    key={
                      item.runId ??
                      `${item.modelVersion}-${item.checkpoint}-${index}`
                    }
                  >
                    <td>{item.modelVersion || "Unavailable"}</td>
                    <td>{item.architecture || "Unavailable"}</td>
                    <td>{item.checkpoint || "Unavailable"}</td>

                    {METRICS.map((metric) => (
                      <td key={metric.key}>
                        {formatMetric(
                          item.metrics?.[metric.key],
                          item.status
                        )}
                      </td>
                    ))}

                    <td>
                      {item.status === "completed"
                        ? "Completed"
                        : item.status === "failed"
                          ? "Failed"
                          : item.status === "running"
                            ? "Running"
                            : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
