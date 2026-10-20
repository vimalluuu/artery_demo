
import "./DashboardPage.css";

const summaryCards = [
  {
    title: "Total Analyses",
    value: "—",
    note: "Analysis count unavailable",
  },
  {
    title: "Completed Analyses",
    value: "—",
    note: "Completion data unavailable",
  },
  {
    title: "Pending Analyses",
    value: "—",
    note: "Pending data unavailable",
  },
];

export default function DashboardPage({ onNavigate }) {
  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">WORKSPACE OVERVIEW</p>
          <h1>Dashboard</h1>
          <p className="dashboard-subtitle">
            Welcome to VascuAI. Manage your artery analysis workflow.
          </p>
        </div>

        <button
          className="dashboard-primary-button"
          onClick={() => onNavigate("New Analysis")}
        >
          + New Analysis
        </button>
      </div>

      <div className="dashboard-summary-grid">
        {summaryCards.map((card) => (
          <article className="dashboard-summary-card" key={card.title}>
            <p>{card.title}</p>
            <h2>{card.value}</h2>
            <span>{card.note}</span>
          </article>
        ))}
      </div>

      <div className="dashboard-section-heading">
        <div>
          <h2>Recent Analyses</h2>
          <p>Your latest analysis cases will appear here.</p>
        </div>

        <button
          className="dashboard-secondary-button"
          onClick={() => onNavigate("Analysis History")}
        >
          View History
        </button>
      </div>

      <div className="dashboard-table-container">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Case ID</th>
              <th>Date</th>
              <th>Analysis Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="4" className="dashboard-empty-state">
                No analysis records available yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="dashboard-notice">
        <strong>Research workspace</strong>
        <p>
          This dashboard displays the frontend interface.
          Real analysis records will appear when data integration is implemented.
        </p>
      </div>
    </section>
  );
}
