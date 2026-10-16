import { useNavigate } from 'react-router-dom';
import { Bell, Search, Sun, Moon, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export default function Topbar({ breadcrumbs = [] }) {
  const navigate = useNavigate();
  const [dark, setDark] = useState(false);

  return (
    <>
      {/* AI Disclaimer sticky bar */}
      <div className="ai-disclaimer-bar" role="alert">
        <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
        AI-assisted research prototype — not a clinical diagnosis tool. All findings require qualified clinical review.
      </div>

      <header className="topbar">
        {/* Breadcrumb */}
        <nav className="topbar-left" aria-label="Breadcrumb">
          <span style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate('/dashboard')}>
            VascuAI
          </span>
          {breadcrumbs.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="sep">/</span>
              {b.href
                ? <span style={{ cursor: 'pointer', color: '#000' }} onClick={() => navigate(b.href)}>{b.label}</span>
                : <span style={{ color: '#000', fontWeight: 600 }}>{b.label}</span>
              }
            </span>
          ))}
        </nav>

        {/* Right actions */}
        <div className="topbar-right">
          <button className="icon-btn" aria-label="Search" onClick={() => {}}>
            <Search size={16} />
          </button>
          <button className="icon-btn" aria-label="Notifications" onClick={() => navigate('/alerts')}>
            <Bell size={16} />
            <span className="badge">3</span>
          </button>
          <button
            className="icon-btn"
            aria-label="Toggle theme"
            onClick={() => setDark((d) => !d)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
    </>
  );
}
