
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import SegmentationEvaluationDashboard from "./SegmentationEvaluationDashboard";

afterEach(() => {
  cleanup();
});

describe("SegmentationEvaluationDashboard", () => {
  it("shows an empty state when no evaluations exist", () => {
    render(<SegmentationEvaluationDashboard evaluations={[]} />);

    expect(
      screen.getByText("No evaluation results yet")
    ).toBeInTheDocument();

    expect(
      screen.getByText("Experimental results — not for clinical use.")
    ).toBeInTheDocument();
  });

  it("shows missing metrics as Not measured", () => {
    render(
      <SegmentationEvaluationDashboard
        evaluations={[
          {
            modelName: "Test model",
            validationSplit: "Validation",
            runId: "run-test",
            metrics: {},
          },
        ]}
      />
    );

    expect(screen.getByText("Test model")).toBeInTheDocument();
    expect(screen.getByText("run-test")).toBeInTheDocument();

    expect(screen.getAllByText("Not measured")).toHaveLength(6);
  });

  it("displays supplied metrics correctly", () => {
    render(
      <SegmentationEvaluationDashboard
        evaluations={[
          {
            modelName: "Evaluation model",
            validationSplit: "Validation split A",
            runId: "run-001",
            metrics: {
              dice: 0.91,
              iou: 0.82,
              precision: 0.95,
              recall: 0.88,
              boundaryDistance: 2.4,
              hausdorff95: 5.1,
            },
          },
        ]}
      />
    );

    expect(screen.getByText("91.00%")).toBeInTheDocument();
    expect(screen.getByText("82.00%")).toBeInTheDocument();
    expect(screen.getByText("95.00%")).toBeInTheDocument();
    expect(screen.getByText("88.00%")).toBeInTheDocument();
    expect(screen.getByText("2.4")).toBeInTheDocument();
    expect(screen.getByText("5.1")).toBeInTheDocument();

    expect(
      screen.getByText("Validation split A")
    ).toBeInTheDocument();
  });

  it("announces loading accessibly", () => {
    render(
      <SegmentationEvaluationDashboard
        status="loading"
        evaluations={[]}
      />
    );

    expect(
      screen.getByText("Loading evaluation results…")
    ).toBeInTheDocument();
  });

  it("announces errors accessibly", () => {
    render(
      <SegmentationEvaluationDashboard
        status="error"
        errorMessage="Evaluation failed."
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Evaluation failed."
    );
  });

  it("shows the unavailable-data state", () => {
    render(
      <SegmentationEvaluationDashboard
        status="unavailable"
        evaluations={[]}
      />
    );

    expect(
      screen.getByText("Evaluation data unavailable")
    ).toBeInTheDocument();
  });

  it("compares supplied evaluation runs", () => {
    render(
      <SegmentationEvaluationDashboard
        evaluations={[
          {
            modelName: "Model A",
            validationSplit: "Validation A",
            runId: "run-A",
            metrics: { dice: 0.9 },
          },
          {
            modelName: "Model B",
            validationSplit: "Validation B",
            runId: "run-B",
            metrics: { dice: 0.85 },
          },
        ]}
      />
    );

    const comparison = screen.getByRole("table");

    expect(within(comparison).getByText("Model A")).toBeInTheDocument();
    expect(within(comparison).getByText("Model B")).toBeInTheDocument();

    expect(
      within(comparison).getByText("Validation A")
    ).toBeInTheDocument();

    expect(
      within(comparison).getByText("Validation B")
    ).toBeInTheDocument();

    expect(within(comparison).getByText("90.00%")).toBeInTheDocument();
    expect(within(comparison).getByText("85.00%")).toBeInTheDocument();
  });
});
    