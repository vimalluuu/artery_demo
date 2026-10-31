"""On-demand research snapshots; no stored report/count table or medical methods."""
import csv
import io
import re

from fastapi import HTTPException
from app.models import Case
from app.schemas.stenosis_reporting import StenosisReport
from app.schemas.stenosis_explanations import ExplanationList
from app.services import stenosis_jobs as jobs, stenosis_results as results, stenosis_explanations as xai

LIMITATIONS = [
    "Experimental research prototype; not a clinically validated diagnosis or autonomous medical decision.",
    "An unavailable/incomplete analysis or zero candidate findings does not establish absence of stenosis.",
    "Only supplied measurements, anatomy and severity are reproduced; methods are not harmonized or inferred.",
    "Explanation records describe model attribution, not correctness, calibrated confidence or clinical evidence.",
    "This is a timestamped snapshot. Source geometry agreement is not independently verified anatomical registration.",
]


def report(db, case_id, analysis_id):
    job = jobs.get_job(db, case_id, analysis_id)
    case = db.get(Case, case_id)
    state, reason, result, explanations = job.status, None, None, None
    if job.stale:
        state, reason = "stale", "The source is stale or cannot be verified. Findings are withheld."
    elif job.status != "completed":
        reason = "This analysis is " + job.status + "; no completed findings report is available."
    else:
        try:
            result = results.retrieve_result(db, case_id, analysis_id)
            items = xai.load_metadata(db, result.result_id, result.result)
            explanations = ExplanationList(contract_version="1.0", case_id=case_id, analysis_id=analysis_id, result_id=result.result_id,
                status="not_generated" if not items else "available" if result.visualization.status=="supported" else "unsupported_geometry",
                unavailable_reason={"code":"not_provided","message":"No explanation artifact is recorded for this result."} if not items else None,items=items)
        except HTTPException as failure:
            if failure.status_code != 409: raise
            code = failure.detail.get("code") if isinstance(failure.detail,dict) else None
            state = "stale" if code == "source_changed" else "integrity_error"
            reason, result, explanations = "The report source or stored result could not be verified; findings are withheld.", None, None
    return StenosisReport(schema_version="1.0",document_type="stenosis_analysis_research_report",generated_at=jobs.now(),
        case={"case_id":case.id,"case_reference":case.case_code,"patient_id":case.patient_id},analysis=job,
        report_state=state,unavailable_reason=reason,result=result,explanations=explanations,limitations=LIMITATIONS)


# One row per actual lesion. Completed zero-lesion CSV is header-only, never a
# fabricated 'negative' row; JSON carries the analysis-level zero-finding context.
CSV_COLUMNS = ["schema_version","generated_at","case_id","case_reference","patient_id","analysis_id","result_id","analysis_status",
    "analysis_method","analysis_method_version","checkpoint_sha256","source_sha256","parent_segmentation_id","completed_at",
    "lesion_id","vessel_label","anatomical_location","ijk_i","ijk_j","ijk_k","ras_r_mm","ras_a_mm","ras_s_mm","localization_unavailable_reason"]
for field in ("reference_diameter","minimum_lumen_diameter","percentage_narrowing"):
    CSV_COLUMNS.extend(field+"_"+suffix for suffix in ("value","unit","unavailable_reason","method","method_version","definition","reference_region"))
CSV_COLUMNS.extend(["severity_category","severity_method","severity_method_version","severity_unavailable_reason"])


def csv_cell(value):
    if isinstance(value,(int,float)):
        return value  # Typed finite numeric values are not spreadsheet formulas.
    text = "" if value is None else str(value)
    return "'"+text if re.match(r"^\s*[=+\-@]",text) else text


def csv_report(value):
    if value.report_state != "completed" or value.result is None:
        raise jobs.conflict("report_not_completed", "CSV findings export requires a current verified completed result.")
    output = io.StringIO(newline="")
    writer = csv.writer(output,quoting=csv.QUOTE_ALL,lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for lesion in value.result.result.lesions:
        source = value.result.result.provenance.source
        row = {"schema_version":"1.0","generated_at":value.generated_at.isoformat(),"case_id":value.case.case_id,
            "case_reference":value.case.case_reference,"patient_id":value.case.patient_id,"analysis_id":str(value.analysis.analysis_id),
            "result_id":str(value.result.result_id),"analysis_status":value.analysis.status,"analysis_method":value.analysis.provenance.method_id,
            "analysis_method_version":value.analysis.provenance.method_version,"checkpoint_sha256":value.analysis.provenance.checkpoint_sha256,
            "source_sha256":source.source_sha256,"parent_segmentation_id":str(source.parent_segmentation_result_id),"completed_at":value.analysis.completed_at.isoformat(),
            "lesion_id":str(lesion.lesion_id),"vessel_label":lesion.vessel_label,"anatomical_location":lesion.anatomical_location,
            "localization_unavailable_reason":lesion.localization_unavailable_reason.message if lesion.localization_unavailable_reason else None,
            "severity_category":lesion.severity.category,"severity_method":lesion.severity.method_id,"severity_method_version":lesion.severity.method_version,
            "severity_unavailable_reason":lesion.severity.unavailable_reason.message if lesion.severity.unavailable_reason else None}
        if lesion.location:
            row.update(zip(["ijk_i","ijk_j","ijk_k","ras_r_mm","ras_a_mm","ras_s_mm"],[*lesion.location.voxel_indices,*lesion.location.world_coordinates]))
        for field in ("reference_diameter","minimum_lumen_diameter","percentage_narrowing"):
            item = getattr(lesion.measurements,field)
            row.update({field+"_value":item.value,field+"_unit":item.unit,field+"_unavailable_reason":item.unavailable_reason.message if item.unavailable_reason else None,
                field+"_method":item.method_id,field+"_method_version":item.method_version,field+"_definition":item.definition,field+"_reference_region":item.reference_region})
        writer.writerow([csv_cell(row.get(column)) for column in CSV_COLUMNS])
    return "\ufeff" + output.getvalue()
