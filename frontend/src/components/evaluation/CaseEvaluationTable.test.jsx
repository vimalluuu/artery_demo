
import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import CaseEvaluationTable from "./CaseEvaluationTable.jsx";

afterEach(() => {
  cleanup();
});

const testCases = [
  {
    caseId: "CASE-002",
    modelVersion: "U-Net v2",
    checkpoint: "checkpoint-002",
    status: "completed",
    metrics: {
      dice: 0.91,
      iou: 0.82,
      precision: 0.95,
      recall: 0.88,
    },
  },
  {
    caseId: "CASE-001",
    modelVersion: "U-Net v1",
    checkpoint: "checkpoint-001",
    status: "pending",
    metrics: {},
  },
];

describe("CaseEvaluationTable", () => {
  it("shows an empty state when there are no cases", () => {
    render(<CaseEvaluationTable cases={[]} />);

    expect(
      screen.getByText("No case evaluations available")
    ).toBeInTheDocument();
  });

  it("displays case information and completed metrics", () => {
    render(<CaseEvaluationTable cases={testCases} />);

    expect(screen.getByText("CASE-002")).toBeInTheDocument();
    expect(screen.getByText("U-Net v2")).toBeInTheDocument();
    expect(screen.getByText("checkpoint-002")).toBeInTheDocument();

    expect(screen.getByText("91.00%")).toBeInTheDocument();
    expect(screen.getByText("82.00%")).toBeInTheDocument();
    expect(screen.getByText("95.00%")).toBeInTheDocument();
    expect(screen.getByText("88.00%")).toBeInTheDocument();
  });

  it("shows pending metrics for an unfinished evaluation", () => {
  render(<CaseEvaluationTable cases={testCases} />);

  expect(screen.getByText("CASE-001")).toBeInTheDocument();

  // Four pending metrics and one pending status.
  expect(screen.getAllByText("Pending")).toHaveLength(5);
});

  it("filters cases using the search field", () => {
    render(<CaseEvaluationTable cases={testCases} />);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "CASE-002" },
    });

    expect(screen.getByText("CASE-002")).toBeInTheDocument();
    expect(screen.queryByText("CASE-001")).not.toBeInTheDocument();
  });
  
  it("sorts cases by case ID", () => {
  render(<CaseEvaluationTable cases={testCases} />);

  fireEvent.click(
    screen.getByRole("button", { name: /sort by case id/i })
  );

  const rows = screen.getAllByRole("row").slice(1);

  // Clicking the initially ascending sort changes it to descending.
  expect(rows[0]).toHaveTextContent("CASE-002");
  expect(rows[1]).toHaveTextContent("CASE-001");
});
});
