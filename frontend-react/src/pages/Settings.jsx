import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, Monitor, ShieldCheck, LogOut } from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Panel, Metadata } from "../components/ui";
import { formatDate } from "../lib/format";
import {
  getPreferences,
  savePreferences,
  DEFAULT_PREFERENCES,
} from "../lib/preferences";
import { useAuth } from "../context/AuthContext";

export default function Settings() {
  const [prefs, setPrefs] = useState(getPreferences),
    [saved, setSaved] = useState(false);
  function save(e) {
    e.preventDefault();
    savePreferences(prefs);
    setSaved(true);
  }
  return (
    <AppShell breadcrumbs={[{ label: "Settings" }]}>
      <PageHeader
        eyebrow="MAKE IT YOURS"
        title="A workspace that works for you."
        description="Display and activity preferences saved on this device."
      />
      <div className="two-column">
        <Panel title="Workspace preferences">
          <form onSubmit={save}>
            {saved && (
              <div className="notice success" role="status">
                <CheckCircle size={16} />
                Preferences saved on this device.
              </div>
            )}
            <label className="preference-row" htmlFor="page-size">
              <div>
                <strong>Cases per page</strong>
                <p>Default page size in the case directory.</p>
              </div>
              <select
                id="page-size"
                className="form-select"
                value={prefs.pageSize}
                onChange={(e) => {
                  setPrefs({ ...prefs, pageSize: Number(e.target.value) });
                  setSaved(false);
                }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} cases
                  </option>
                ))}
              </select>
            </label>
            <label className="preference-row" htmlFor="show-activity">
              <div>
                <strong>Show case creation activity</strong>
                <p>Include case creation events in your notification view.</p>
              </div>
              <input
                id="show-activity"
                type="checkbox"
                className="switch"
                checked={prefs.showLocalActivity}
                onChange={(e) => {
                  setPrefs({ ...prefs, showLocalActivity: e.target.checked });
                  setSaved(false);
                }}
              />
            </label>
            <div className="preference-row">
              <div>
                <strong>Appearance</strong>
                <p>Charcoal & off-white · #222222 / #FDFFFC</p>
              </div>
              <span className="badge badge-gray">VascuAI standard</span>
            </div>
            <div className="page-actions" style={{ marginTop: 25 }}>
              <button className="btn btn-primary">Save preferences</button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setPrefs({ ...DEFAULT_PREFERENCES });
                  setSaved(false);
                }}
              >
                Reset defaults
              </button>
            </div>
          </form>
        </Panel>
        <Panel title="Your account">
          <Monitor size={24} strokeWidth={1.5} />
          <p
            className="text-sm text-muted"
            style={{ lineHeight: 1.9, marginTop: 16 }}
          >
            Profile and password changes are saved to your account. Display
            preferences are stored separately on this browser.
          </p>
          <div className="stack" style={{ gap: 14 }}>
            <Link className="text-link" to="/profile">
              Edit profile
            </Link>
            <Link className="text-link" to="/settings/security">
              Security & session
            </Link>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
export function Security() {
  const { user, logout } = useAuth();
  return (
    <AppShell
      breadcrumbs={[
        { label: "Settings", href: "/settings" },
        { label: "Security" },
      ]}
    >
      <PageHeader
        eyebrow="ACCOUNT SECURITY"
        title="Your access, under control."
        description="Current account information and session actions."
      />
      <div className="two-column">
        <Panel title="Account & current session">
          <Metadata
            items={[
              ["Name", user.name],
              ["Email", user.email],
              ["Role", user.role],
              ["Account status", user.is_active ? "Active" : "Inactive"],
              [
                "Last login",
                user.last_login ? formatDate(user.last_login, true) : null,
              ],
            ]}
          />
          <div className="notice" style={{ marginTop: 20 }}>
            <ShieldCheck size={17} />
            <span>
              Your identity is restored from the server. Changing your password
              revokes previous sessions and issues a new session for this
              device.
            </span>
          </div>
          <div className="page-actions">
            <Link className="btn btn-primary" to="/profile?tab=password">
              Change password
            </Link>
            <button className="btn btn-ghost" onClick={logout}>
              <LogOut size={14} />
              Sign out of this device
            </button>
          </div>
        </Panel>
        <Panel title="Other sessions">
          <p className="text-sm text-muted" style={{ lineHeight: 1.9 }}>
            A list of active devices and individual session revocation are not
            exposed by this deployment. Contact your administrator if you need
            account access reviewed.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
