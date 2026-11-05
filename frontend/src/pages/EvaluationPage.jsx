import SegmentationEvaluationDashboard from
  "../components/evaluation/SegmentationEvaluationDashboard.jsx";

export default function EvaluationPage() {
  return (
    <SegmentationEvaluationDashboard
      status="success"
      evaluations={[]}
      summary={null}
      caseEvaluations={[]}
      modelComparisons={[]}
      trainingRuns={[]}
      evaluationHistory={[]}
    />
  );
}