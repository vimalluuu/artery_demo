
import React from "react";
import { createRoot } from "react-dom/client";

import SegmentationEvaluationDashboard from "./components/evaluation/SegmentationEvaluationDashboard.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SegmentationEvaluationDashboard
      status="success"
      evaluations={[]}
    />
  </React.StrictMode>
);
