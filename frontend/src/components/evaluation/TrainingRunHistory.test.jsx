
import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import TrainingRunHistory from "./TrainingRunHistory.jsx";

afterEach(() => {
  cleanup();
});

const testRuns = [
  {
    runId: "RUN-001",
    architecture: "U-Net",
    checkpoint: "checkpoint-001",
    trainingStatus: "completed",
    evaluationStatus: "pending",
    evaluationId: "EVAL-001",
    createdAt: "2026-11-05",
  },
];

describe("TrainingRunHistory", () => {
  it("shows an empty state when no training runs exist", () => {
    render(<TrainingRunHistory runs={[]} />);

    expect(
      screen.getByText("No training history available")
    ).toBeInTheDocument();
  });

  it("displays run and checkpoint information", () => {
    render(<TrainingRunHistory runs={testRuns} />);

    expect(screen.getByText("RUN-001")).toBeInTheDocument();
    expect(screen.getByText("U-Net")).toBeInTheDocument();
    expect(screen.getByText("checkpoint-001")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("opens and closes run details", () => {
    render(<TrainingRunHistory runs={testRuns} />);

    fireEvent.click(screen.getByRole("button", { name: "View details" }));

    expect(screen.getByText("EVAL-001")).toBeInTheDocument();
    expect(screen.getByText("2026-11-05")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));

    expect(screen.queryByText("EVAL-001")).not.toBeInTheDocument();
  });

  it("shows unavailable when a status is not recognized", () => {
    const runs = [
      {
        runId: "RUN-002",
        architecture: "U-Net",
        checkpoint: "checkpoint-002",
        trainingStatus: "unknown",
        evaluationStatus: null,
      },
    ];

    render(<TrainingRunHistory runs={runs} />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
