import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import OverallPerformance from "./OverallPerformance.jsx";

afterEach(() => {
  cleanup();
});
describe("OverallPerformance", () => {
  it("shows pending values when summary is unavailable", () => {
    render(<OverallPerformance summary={null} />);

    expect(
      screen.getByText("Overall Model Performance")
    ).toBeInTheDocument();

    expect(screen.getAllByText("Pending")).toHaveLength(9);
  });

  it("displays supplied macro and pooled metrics", () => {
    render(
      <OverallPerformance
        summary={{
          successfullyEvaluatedCases: 10,
          macroAverage: {
            dice: 0.91,
            iou: 0.82,
            precision: 0.95,
            recall: 0.88,
          },
          pooled: {
            dice: 0.92,
            iou: 0.83,
            precision: 0.94,
            recall: 0.89,
          },
        }}
      />
    );

    expect(screen.getByText("91.00%")).toBeInTheDocument();
    expect(screen.getByText("82.00%")).toBeInTheDocument();
    expect(screen.getByText("95.00%")).toBeInTheDocument();
    expect(screen.getByText("88.00%")).toBeInTheDocument();

    expect(screen.getByText("92.00%")).toBeInTheDocument();
    expect(screen.getByText("83.00%")).toBeInTheDocument();

    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("shows pending for missing individual metrics", () => {
    render(
      <OverallPerformance
        summary={{
          successfullyEvaluatedCases: 2,
          macroAverage: { dice: 0.9 },
          pooled: {},
        }}
      />
    );

    expect(screen.getAllByText("Pending")).toHaveLength(7);
  });
});
