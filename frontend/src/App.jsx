
import { useState } from "react";

import MainLayout from "./layouts/MainLayout.jsx";

import EvaluationPage from "./pages/EvaluationPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import NewAnalysisPage from "./pages/NewAnalysisPage.jsx";
import AnalysisHistoryPage from "./pages/AnalysisHistoryPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

const pageDescriptions = {
  Dashboard: "View your VascuAI project overview and analysis summary.",
  "New Analysis": "Upload a medical image to begin a new analysis.",
  "Analysis History": "Review your previous analysis cases.",
  Reports: "View and organize analysis reports.",
  Settings: "Manage your application preferences.",
};

function App() {
  const [activePage, setActivePage] = useState(
    "Segmentation Evaluation"
  );

  function renderPage() {
    switch (activePage) {
      case "Dashboard":
        return <DashboardPage onNavigate={setActivePage} />;

      case "New Analysis":
        return <NewAnalysisPage />;

      case "Analysis History":
        return <AnalysisHistoryPage />;

      case "Reports":
        return <ReportsPage />;

      case "Settings":
        return <SettingsPage />;

      case "Segmentation Evaluation":
        return <EvaluationPage />;

      default:
        return (
          <section style={{ padding: "32px" }}>
            <h1>{activePage}</h1>
            <p>
              {pageDescriptions[activePage] ||
                "This page is under development."}
            </p>
          </section>
        );
    }
  }

  return (
    <MainLayout
      activePage={activePage}
      onNavigate={setActivePage}
    >
      {renderPage()}
    </MainLayout>
  );
}

export default App;
