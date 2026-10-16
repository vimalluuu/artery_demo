import { Link, useParams } from "react-router-dom";
import { Layers, CircleCheck, CircleDashed, ArrowRight } from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Panel, Loading, ErrorState } from "../components/ui";
import { CaseTabs } from "./CaseDetail";
import { useCase } from "../hooks/useCase";

export default function AnalysisResult() {
  const { id } = useParams();
  const { data: item, loading, error, reload } = useCase();
  const checks = [
    [
      "Study record",
      "A persisted case with subject association.",
      Boolean(item),
    ],
    [
      "Input study",
      "A 2D image or NIfTI volume is uploaded.",
      Boolean(item?.hasImage || item?.hasVolume),
    ],
    [
      "Segmentation model",
      "A compatible model artifact and inference service.",
      false,
    ],
    [
      "Measurement pipeline",
      "Spatially calibrated vessel and stenosis measurements.",
      false,
    ],
    [
      "Review & provenance",
      "Persistent analysis versions and review decisions.",
      false,
    ],
  ];
  return (
    <AppShell
      breadcrumbs={[
        { label: "Cases", href: "/cases" },
        { label: item?.caseCode || id, href: `/cases/${id}` },
        { label: "Analysis" },
      ]}
    >
      <PageHeader
        eyebrow="ANALYSIS READINESS"
        title="Ready for the next question."
        description="Understand what is available before starting an analysis."
      />
      <CaseTabs id={id} />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <>
          <section className="availability-hero">
            <Layers size={34} strokeWidth={1.3} />
            <div>
              <h2>Inference is not connected yet.</h2>
              <p>
                No model output exists for this case. Segmentation, vessel
                measurements, stenosis assessment, and explanation maps will
                appear only when produced by an integrated pipeline.
              </p>
            </div>
          </section>
          <div className="two-column">
            <Panel title="Pipeline readiness">
              {checks.map(([title, desc, ready]) => (
                <div className="readiness-item" key={title}>
                  {ready ? (
                    <CircleCheck size={18} style={{ color: "#738b60" }} />
                  ) : (
                    <CircleDashed size={18} className="text-muted" />
                  )}
                  <div>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                  </div>
                  <span className={`badge badge-${ready ? "green" : "gray"}`}>
                    {ready ? "Available" : "Not connected"}
                  </span>
                </div>
              ))}
            </Panel>
            <div className="stack">
              <Panel title="Your next step">
                <p className="text-sm text-muted" style={{ lineHeight: 1.9 }}>
                  Confirm your source data and its spatial metadata. A study
                  upload alone does not produce a segmentation or clinical
                  finding.
                </p>
                <Link className="btn btn-primary" to={`/cases/${id}/imaging`}>
                  Inspect metadata
                  <ArrowRight size={14} />
                </Link>
              </Panel>
              <Panel title="Result provenance">
                <p
                  className="text-xs text-muted"
                  style={{ lineHeight: 1.9, margin: 0 }}
                >
                  A future analysis must identify the exact input, preprocessing
                  configuration, model version, timestamp, and output artifacts.
                  Clinical confidence and severity remain unavailable.
                </p>
              </Panel>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
