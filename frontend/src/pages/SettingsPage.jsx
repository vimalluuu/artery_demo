
import { useState } from "react";
import "./SettingsPage.css";

export default function SettingsPage() {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [reportFormat, setReportFormat] = useState("PDF");
  const [language, setLanguage] = useState("English");

  return (
    <section className="settings-page">
      <p className="settings-eyebrow">PREFERENCES</p>

      <h1>Settings</h1>
      <p className="settings-subtitle">
        Manage your VascuAI workspace preferences.
      </p>

      <div className="settings-card">
        <h2>Notifications</h2>
        <p>Choose whether to receive email notifications.</p>

        <label className="settings-toggle-row">
          <span>Email Notifications</span>
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(event) =>
              setEmailNotifications(event.target.checked)
            }
          />
        </label>
      </div>

      <div className="settings-card">
        <h2>Report Preferences</h2>
        <p>Choose your preferred report format and language.</p>

        <label className="settings-field">
          <span>Report Format</span>
          <select
            value={reportFormat}
            onChange={(event) => setReportFormat(event.target.value)}
          >
            <option value="PDF">PDF</option>
            <option value="CSV">CSV</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="English">English</option>
            <option value="Hindi">Hindi</option>
            <option value="Telugu">Telugu</option>
          </select>
        </label>
      </div>

      <div className="settings-card">
        <h2>Account</h2>
        <p>Manage your account-related actions.</p>

        <div className="settings-actions">
          <button
            type="button"
            onClick={() =>
              alert("Password change will be available after authentication integration.")
            }
          >
            Change Password
          </button>

          <button
            type="button"
            className="settings-logout-button"
            onClick={() =>
              alert("Logout will be available after authentication integration.")
            }
          >
            Logout
          </button>
        </div>
      </div>

      <p className="settings-note">
        These preferences currently apply only to this page session.
        Account saving and authentication are not connected yet.
      </p>
    </section>
  );
}
