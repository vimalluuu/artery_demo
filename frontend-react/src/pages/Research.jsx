import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Database,
  FlaskConical,
  Cpu,
  ChartNoAxesCombined,
  CircleDashed,
  CheckCircle,
  ArrowRight,
  GitBranch,
  FileCheck,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Panel, EmptyState } from "../components/ui";

const content = {
  datasets: {
    icon: Database,
    eyebrow: "DATA FOUNDATIONS",
    title: "A source for every study.",
    description:
      "Dataset provenance, annotation definitions, and split integrity.",
    headline: "Dataset registration is not connected.",
    body: "Uploaded cases are available in the case directory. A versioned dataset registry, annotation manifests, and immutable train / validation / test splits require additional backend integration.",
    empty: "No registered datasets",
    emptyBody:
      "Cases are not automatically treated as a validated research dataset.",
    checks: [
      [
        "Source & usage rights",
        "Record the dataset source, license, and de-identification status.",
      ],
      [
        "Annotations & labels",
        "Define target anatomy, annotation format, and ground-truth availability.",
      ],
      [
        "Patient-level splits",
        "Keep related studies together and preserve the held-out test split.",
      ],
    ],
    columns: [
      "Dataset / version",
      "Modality",
      "Studies",
      "Annotation type",
      "Split manifest",
    ],
  },
  models: {
    icon: Cpu,
    eyebrow: "MODEL OPERATIONS",
    title: "Know the model behind the result.",
    description:
      "Model artifacts, intended use, versions, and deployment provenance.",
    headline: "No model registry service is connected.",
    body: "This deployment does not expose registered models or serving status. Model versions, deployment changes, and rollback controls become available only through an authorized model lifecycle API.",
    empty: "No registered model artifacts",
    emptyBody:
      "A model name alone does not indicate a loaded or validated model.",
    checks: [
      [
        "Model artifact & version",
        "Register a specific artifact and supported input geometry.",
      ],
      [
        "Model card & limitations",
        "Document intended use, training source, and known failure cases.",
      ],
      [
        "Evaluation & approval",
        "Associate reproducible evaluation evidence before deployment.",
      ],
    ],
    columns: [
      "Model / version",
      "Architecture",
      "Input format",
      "Dataset version",
      "Deployment",
    ],
  },
  experiments: {
    icon: FlaskConical,
    eyebrow: "EXPERIMENT TRACKING",
    title: "Make every experiment reproducible.",
    description:
      "Training history, configurations, checkpoints, and research provenance.",
    headline: "A training job runner is not connected.",
    body: "Experiment creation and live training controls require a real job runner. This workspace does not start training or simulate progress, loss curves, or checkpoint histories.",
    empty: "No training runs available",
    emptyBody:
      "Connect persistent training jobs to track real progress and configuration history.",
    checks: [
      ["Versioned inputs", "Record dataset version, split seed, and manifest."],
      [
        "Training configuration",
        "Preserve architecture, loss, optimizer, augmentation, and hardware.",
      ],
      [
        "Reproducibility record",
        "Associate code version, environment, checkpoints, and results.",
      ],
    ],
    columns: [
      "Experiment",
      "Configuration",
      "Dataset / split",
      "Epoch",
      "Status",
    ],
  },
};
export default function Research({ section = "models" }) {
  const c = content[section];
  const Icon = c.icon;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Research" },
        {
          label:
            section === "models"
              ? "Model registry"
              : section === "datasets"
                ? "Datasets"
                : "Experiments",
        },
      ]}
    >
      <PageHeader
        eyebrow={c.eyebrow}
        title={c.title}
        description={c.description}
      >
        <Link className="btn btn-ghost" to="/help#research">
          Research methodology
          <ArrowRight size={13} />
        </Link>
      </PageHeader>
      <section className="availability-hero">
        <Icon size={34} strokeWidth={1.3} />
        <div>
          <h2>{c.headline}</h2>
          <p>{c.body}</p>
        </div>
      </section>
      <div className="two-column">
        <Panel
          title={
            section === "models"
              ? "Model registry"
              : section === "datasets"
                ? "Dataset registry"
                : "Experiment history"
          }
          description="Persistent records will appear when the service is connected."
        >
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  {c.columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <EmptyState icon={Icon} title={c.empty} description={c.emptyBody} />
          <Link className="text-link" to="/cases">
            Explore available study records
            <ArrowRight size={13} />
          </Link>
        </Panel>
        <Panel title="Readiness requirements">
          {c.checks.map(([title, body]) => (
            <div className="readiness-item" key={title}>
              <CircleDashed size={17} />
              <div>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </Panel>
      </div>
      <div className="feature-grid" style={{ marginTop: 24 }}>
        {[
          [
            GitBranch,
            "Traceable by version",
            "Keep source inputs and derived artifacts linked to the configuration that produced them.",
          ],
          [
            FileCheck,
            "Evidence before metrics",
            "Only show performance numbers from a recorded evaluation protocol.",
          ],
          [
            CheckCircle,
            "Human review",
            "Distinguish experimental output, reviewed output, and approved research artifacts.",
          ],
        ].map(([I, title, body]) => (
          <article className="feature-card" key={title}>
            <I size={22} strokeWidth={1.5} />
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
const metrics = {
  Segmentation: [
    "Dice coefficient",
    "Intersection over Union",
    "Precision",
    "Recall / sensitivity",
    "Hausdorff distance",
    "Average surface distance",
  ],
  Stenosis: [
    "Precision",
    "Recall",
    "F1 score",
    "ROC-AUC",
    "False-positive rate",
    "False-negative rate",
  ],
  Classification: [
    "Accuracy",
    "Macro F1",
    "Weighted F1",
    "Per-class precision",
    "Per-class recall",
    "Confusion matrix",
  ],
};
export function Evaluation({ initialTab = "Segmentation" }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <AppShell
      breadcrumbs={[{ label: "Research" }, { label: "Model evaluation" }]}
    >
      <PageHeader
        eyebrow="RESEARCH EVALUATION"
        title="Evidence makes the difference."
        description="Separate model tasks. Preserve the context behind every metric."
      />
      <section className="availability-hero">
        <ChartNoAxesCombined size={34} strokeWidth={1.3} />
        <div>
          <h2>No evaluation runs available.</h2>
          <p>
            Evaluation requires a model artifact, a versioned dataset,
            ground-truth annotations, and a recorded protocol. No performance
            scores are fabricated or inferred from case counts.
          </p>
        </div>
      </section>
      <div className="segmented" style={{ marginBottom: 22 }}>
        {Object.keys(metrics).map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="feature-grid" style={{ marginBottom: 24 }}>
        {metrics[tab].map((metric) => (
          <div className="metric-placeholder" key={metric}>
            <h3>{metric}</h3>
            <strong>—</strong>
            <p>No evaluation result</p>
          </div>
        ))}
      </div>
      <div className="equal-columns">
        <Panel title="Evaluation context">
          <dl className="metadata-list">
            {[
              "Model artifact & version",
              "Dataset & split version",
              "Ground-truth annotation source",
              "Evaluation date & sample size",
              "Metric calculation protocol",
            ].map((label) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>Not available</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Comparable by design">
          <p className="text-sm text-muted" style={{ lineHeight: 1.9 }}>
            Compare models on the same input, held-out split, preprocessing, and
            annotation reference. Keep training, validation, and test results
            distinct.
          </p>
          <Link className="btn btn-ghost" to="/models/compare">
            Model comparison
            <ArrowRight size={13} />
          </Link>
        </Panel>
      </div>
    </AppShell>
  );
}
export function ModelComparison() {
  return (
    <AppShell
      breadcrumbs={[
        { label: "Models", href: "/models" },
        { label: "Comparison" },
      ]}
    >
      <PageHeader
        eyebrow="MODEL COMPARISON"
        title="Put results side by side."
        description="A shared protocol is the foundation of a meaningful comparison."
      />
      <div className="equal-columns">
        {["Model A", "Model B"].map((label) => (
          <Panel title={label} key={label}>
            <EmptyState
              icon={Cpu}
              title="No evaluated model available"
              description="A registered model, evaluation dataset, and protocol are required before comparison."
            />
          </Panel>
        ))}
      </div>
      <div className="notice" style={{ marginTop: 24 }}>
        There are no model artifacts or evaluation runs in the connected API.
        Comparisons, scores, and rankings are unavailable.
      </div>
      <Link className="btn btn-primary" to="/models">
        Back to model registry
        <ArrowRight size={14} />
      </Link>
    </AppShell>
  );
}
