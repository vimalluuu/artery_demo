import { Link } from "react-router-dom";
import {
  ArrowRight,
  ScanLine,
  ShieldCheck,
  Layers,
  FileText,
  Fingerprint,
  GitBranch,
  Database,
  MoveUpRight,
} from "lucide-react";
import Brand from "../components/Brand";
import VesselArt from "../components/VesselArt";
import { useAuth } from "../context/AuthContext";

export default function Landing() {
  const { user } = useAuth();
  return (
    <>
      <header className="public-nav">
        <Brand />
        <nav className="public-nav-links" aria-label="Public navigation">
          <a href="#platform">Platform</a>
          <a href="#workflow">Workflow</a>
          <Link to="/help">Documentation</Link>
          <Link className="btn btn-primary" to={user ? "/dashboard" : "/login"}>
            {user ? "Open workspace" : "Sign in"}
            <ArrowRight size={14} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="public-hero">
          <div>
            <div className="hero-kicker">
              <i />A workspace for vascular imaging research
            </div>
            <h1>
              A clearer view.
              <br />
              <em>A deeper understanding.</em>
            </h1>
            <p>
              Bring your studies, imaging metadata, and research workflow
              together. Built for the people exploring what lies beyond the
              scan.
            </p>
            <div className="hero-actions">
              <Link
                className="btn btn-primary btn-lg"
                to={user ? "/dashboard" : "/register"}
              >
                Enter your workspace
                <ArrowRight size={16} />
              </Link>
              <a className="btn btn-ghost btn-lg" href="#workflow">
                Explore the workflow
                <MoveUpRight size={15} />
              </a>
            </div>
            <div className="hero-note">
              <ShieldCheck size={13} />
              De-identified data. Traceable research. Human review.
            </div>
          </div>
          <div className="public-visual">
            <div className="visual-topline">
              <strong>VASCULAR RESEARCH / 01</strong>
              <span>SCHEMATIC VIEW</span>
            </div>
            <VesselArt caption={false} />
            <div className="visual-chip">
              <strong>
                <GitBranch
                  size={13}
                  style={{ display: "inline", marginRight: 6 }}
                />
                Connected by design
              </strong>
              <small>From study intake to research review</small>
            </div>
            <div className="visual-bottomline">
              <span>STRUCTURE. CONTEXT. UNDERSTANDING.</span>
              <span>VASCUAI</span>
            </div>
          </div>
        </section>
        <div className="public-strip">
          <span>
            <ScanLine size={16} />
            NIfTI volume ingestion
          </span>
          <span>
            <Layers size={16} />
            2D image preprocessing
          </span>
          <span>
            <Fingerprint size={16} />
            Role-based access
          </span>
          <span>
            <FileText size={16} />
            Structured case exports
          </span>
        </div>
        <section id="platform" className="public-section">
          <div className="page-eyebrow">THE PLATFORM</div>
          <h2>One workspace. Every perspective.</h2>
          <p>
            A thoughtful foundation for clinicians, researchers, and data
            scientists, with a shared record of every study.
          </p>
          <div className="feature-grid">
            {[
              [
                ScanLine,
                "Your studies, in context",
                "Create cases, associate research subjects, upload images and volumes, and inspect the metadata behind each study.",
              ],
              [
                ShieldCheck,
                "Access with accountability",
                "Four distinct roles, server-enforced permissions, account controls, and an administrator audit trail.",
              ],
              [
                Database,
                "An honest research foundation",
                "Persisted case data and metadata today, with clear readiness states for segmentation, evaluation, and model operations.",
              ],
            ].map(([Icon, title, body]) => (
              <article className="feature-card" key={title}>
                <Icon size={26} strokeWidth={1.4} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          id="workflow"
          className="public-section"
          style={{ paddingTop: 0 }}
        >
          <div className="page-eyebrow">A CONNECTED WORKFLOW</div>
          <h2>From the first upload to the next insight.</h2>
          <p>
            Start with reliable study intake. Extend the workflow as validated
            research capabilities become available.
          </p>
          <div className="workflow-grid">
            {[
              [
                "01",
                "Organize",
                "Register a de-identified subject and create a case with its study information.",
              ],
              [
                "02",
                "Upload & validate",
                "Upload a 2D image or NIfTI volume and inspect the available image metadata.",
              ],
              [
                "03",
                "Prepare for analysis",
                "Review input readiness. Model inference and 3D viewing require additional integration.",
              ],
              [
                "04",
                "Review & export",
                "Inspect persisted case records and export a case summary as JSON, CSV, or a printable document.",
              ],
            ].map(([n, title, body]) => (
              <div className="workflow-step" key={n}>
                <span>{n} /</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="public-section" style={{ paddingTop: 0 }}>
          <div className="public-cta">
            <div>
              <h2>Your next study starts here.</h2>
              <p>A considered workspace for a complex field.</p>
            </div>
            <Link
              className="btn btn-light btn-lg"
              to={user ? "/dashboard" : "/register"}
            >
              Get started
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>© 2026 VascuAI · Vascular imaging research</span>
        <span>Research prototype · Not for autonomous diagnosis</span>
        <Link to="/help">
          Documentation
          <ArrowRight size={12} style={{ display: "inline", marginLeft: 6 }} />
        </Link>
      </footer>
    </>
  );
}
