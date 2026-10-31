// Export an explicit allowlist; internal storage paths never leave the UI adapter.
export function caseRecord(item) {
  return {
    case_id: item.id,
    case_reference: item.caseCode,
    subject_id: item.patientId,
    study_type: item.studyType,
    modality: item.modality,
    anatomical_region: item.region,
    scan_date: item.scanDate,
    age_years: item.age,
    sex: item.gender,
    notes: item.notes,
    status: item.status,
    has_image: item.hasImage,
    has_volume: item.hasVolume,
    created_at: item.createdAt,
  };
}
export function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function serializeCsv(records) {
  if (!records.length) return "";
  const keys = Object.keys(records[0]);
  return [
    keys.map(csvCell).join(","),
    ...records.map((row) => keys.map((key) => csvCell(row[key])).join(",")),
  ].join("\r\n");
}

// A typed, authorized report snapshot; unlike caseRecord, this contains supplied
// analysis data. The API validator is the allowlisted contract boundary.
export function reportJsonBlob(report) {
  return new Blob([JSON.stringify({schema_version:report.schema_version,document_type:report.document_type,generated_at:report.generated_at,
    case:report.case,analysis:report.analysis,report_state:report.report_state,unavailable_reason:report.unavailable_reason,
    result:report.result,explanations:report.explanations,limitations:report.limitations},null,2)],{type:'application/json;charset=utf-8'});
}
export function downloadRecords(items, format) {
  const records = items.map(caseRecord);
  const content =
    format === "json"
      ? JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            document_type: "research_case_metadata",
            analysis_available: false,
            cases: records,
          },
          null,
          2,
        )
      : serializeCsv(records);
  const blob = new Blob([format === "csv" ? "\uFEFF" : "", content], {
    type:
      format === "json"
        ? "application/json;charset=utf-8"
        : "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vascuai-case-${items.length === 1 ? items[0].id : "records"}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
