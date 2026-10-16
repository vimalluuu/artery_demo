import { Activity } from "lucide-react";
import { Link } from "react-router-dom";

export default function Brand({ to = "/", inverse = false }) {
  return (
    <Link
      to={to}
      className={`brand${inverse ? " inverse" : ""}`}
      aria-label="VascuAI home"
    >
      <span className="brand-symbol">
        <Activity size={25} strokeWidth={1.7} />
      </span>
      <span>
        vascu<span className="brand-ai">AI</span>
        <small>VASCULAR INTELLIGENCE</small>
      </span>
    </Link>
  );
}
