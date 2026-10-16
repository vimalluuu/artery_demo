import Brand from "./Brand";
import VesselArt from "./VesselArt";
export default function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand inverse />
        <div className="auth-story-content">
          <div className="page-eyebrow" style={{ color: "#aeb8a1" }}>
            MADE FOR THE CURIOUS
          </div>
          <h1>
            See beyond
            <br />
            the scan.
          </h1>
          <p>
            A shared workspace for vascular imaging, thoughtful research, and
            the questions that move us forward.
          </p>
          <VesselArt />
          <div style={{ borderTop: "1px solid #ffffff20", paddingTop: 20 }}>
            <p style={{ margin: 0 }}>
              Your studies. Your context. A clearer path forward.
            </p>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>VASCULAR INTELLIGENCE</span>
          <span>RESEARCH EDITION / 2026</span>
        </div>
      </section>
      <section className="auth-main">
        <div className="auth-form-wrap">
          {children}
          <div className="auth-bottom">
            Use de-identified research data only.
            <br />
            AI-assisted outputs require qualified review.
          </div>
        </div>
      </section>
    </div>
  );
}
