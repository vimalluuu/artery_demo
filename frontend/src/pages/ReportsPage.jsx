
import "./ReportsPage.css";

export default function ReportsPage() {
  return (
    <section className="reports-page">
      <p className="reports-eyebrow">ANALYSIS DOCUMENTATION</p>

      <h1>Reports</h1>
      <p className="reports-subtitle">
        View and organize reports generated from analysis cases.
      </p>

      <div className="reports-summary">
        <article className="reports-card">
          <span>Total Reports</span>
          <strong>—</strong>
          <p>Report count unavailable</p>
        </article>

        <article className="reports-card">
          <span>Available Reports</span>
          <strong>—</strong>
          <p>Report records unavailable</p>
        </article>
      </div>

      <div className="reports-table-card">
        <div className="reports-table-heading">
          <div>
            <h2>Analysis Reports</h2>
            <p>Reports associated with your analysis cases.</p>
          </div>
        </div>

        <div className="reports-table-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Case ID</th>
                <th>Generated Date</th>
                <th>Format</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td colSpan="5" className="reports-empty">
                  No reports available yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="reports-notice">
        <strong>Research workspace</strong>
        <p>
          Report generation and downloads are not connected yet.
          This page displays the frontend interface only.
        </p>
      </div>
    </section>
  );
}
