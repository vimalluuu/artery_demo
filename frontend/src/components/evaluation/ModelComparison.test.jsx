
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import ModelComparison from "./ModelComparison.jsx";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="comparison-chart" />,
}));

afterEach(() => {
  cleanup();
});

const testResults = [
  {
    runId: "RUN-001",
    modelVersion: "U-Net v1",
    architecture: "U-Net",
    checkpoint: "checkpoint-001",
    status: "completed",
    metrics: {
      dice: 0.91,
      iou: 0.82,
      precision: 0.95,
      recall: 0.88,
    },
  },
  {
    runId: "RUN-002",
    modelVersion: "U-Net v2",
    architecture: "U-Net",
    checkpoint: "checkpoint-002",
    status: "pending",
    metrics: {},
  },
];

describe("ModelComparison", () => {
  it("shows an empty state when no comparison results exist", () => {
    render(<ModelComparison results={[]} />);

    expect(
      screen.getByText("No model comparison data available")
    ).toBeInTheDocument();
  });

  it("displays model versions and checkpoint details", () => {
    render(<ModelComparison results={testResults} />);

    expect(screen.getByText("U-Net v1")).toBeInTheDocument();
    expect(screen.getByText("U-Net v2")).toBeInTheDocument();
    expect(screen.getByText("checkpoint-001")).toBeInTheDocument();
    expect(screen.getByText("checkpoint-002")).toBeInTheDocument();
    expect(screen.queryByText("RUN-001")).not.toBeInTheDocument();
  });

  it("renders the chart for completed evaluation results", () => {
    render(<ModelComparison results={testResults} />);

    expect(screen.getByTestId("comparison-chart")).toBeInTheDocument();
  });

  it("allows the user to select a comparison metric", () => {
    render(<ModelComparison results={testResults} />);

    const metricSelect = screen.getByLabelText("Select metric");

    fireEvent.change(metricSelect, {
      target: { value: "iou" },
    });

    expect(metricSelect).toHaveValue("iou");
  });
});
