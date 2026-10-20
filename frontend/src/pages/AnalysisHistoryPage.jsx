
import "./AnalysisHistoryPage.css";

export default function AnalysisHistoryPage() {
  return (
    <section className="history-page">
      <p className="history-eyebrow">CASE MANAGEMENT</p>

      <div className="history-heading">
        <div>
          <h1>Analysis History</h1>
          <p>
            Review and track your previous artery analysis cases.
          </p>
        </div>
      </div>

      <div className="history-summary">
        <div>
          <span>Total Cases</span>
          <strong>—</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>—</strong>
        </div>
        <div>
          <span>Pending</span>
          <strong>—</strong>
        </div>
      </div>

      <div className="history-table-card">
        <div className="history-table-heading">
          <h2>All Analysis Cases</h2>
          <span>Research workspace</span>
        </div>

        <div className="history-table-scroll">
          <table className="history-table">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Date</th>
                <th>Image / File</th>
                <th>Analysis Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan="5" className="history-empty">
                  No analysis cases available yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="history-note">
        Case records will appear when backend and database integration
        is available. No real analysis records are displayed here yet.
      </p>
    </section>
  );
}
