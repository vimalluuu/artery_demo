"""SQL-derived operational counts; never reads CT bytes or invokes a model."""
from datetime import datetime, time, timezone

from fastapi import HTTPException
from sqlalchemy import Date, cast, func, select

from app.models import Case, Patient, SegmentationResult, StenosisAnalysisJob as Job, StenosisAnalysisResult as Result, StenosisLesion as Lesion, StenosisExplanationArtifact as Explanation
from app.schemas.stenosis import AnalysisProvenance
from app.schemas.stenosis_reporting import AnalyticsSummary, AnalyticsFilters, AnalysisIndex, TrendResponse
from app.services import stenosis_jobs as jobs
from app.services.stenosis import capabilities
from app.services.stenosis_geometry import geometry_fingerprint
from app.services.source_fingerprint import observed_source_sha256
from app.routers.cases import UPLOAD_DIR, VOLUME_DIR

MAX_COHORT = 2000
DEFINITIONS = {
    "jobs": "Persisted job IDs in the UTC job-creation cohort; generic case status is never used.",
    "current": "Completed canonical results with matching metadata/counts and a previously verified unchanged source version; excludes stale, unverified and inconsistent results.",
    "lesions": "Stored lesion rows across eligible analysis IDs; repeat real executions remain separate analyses, never distinct patients.",
    "zero_findings": "Eligible completed results with exactly zero lesion rows; not evidence of absence of stenosis.",
    "measurements": "Presence counts only, per eligible lesion; zero is available. No numerical averages or derived narrowing.",
    "explanations": "Recorded metadata counts, not downloaded-file integrity, explanation quality or model performance.",
    "anatomy": "Exact provider-supplied labels grouped by analysis method/version; no inferred or harmonized anatomy.",
    "freshness": "Stat-only cached checksum observations. A cold/evicted observation is unverified; changed versions require explicit result/source verification.",
}


def now():
    return datetime.now(timezone.utc)


def scope(db, filters, patient_authorized):
    if filters.patient_id is not None and not patient_authorized:
        raise HTTPException(403, "Patient-level filters require the existing clinical-writer role.")
    case = db.get(Case, filters.case_id) if filters.case_id else None
    if filters.case_id and (case is None or (filters.patient_id and case.patient_id != filters.patient_id)):
        raise HTTPException(404, "Matching case not found")
    if filters.patient_id and db.get(Patient, filters.patient_id) is None:
        raise HTTPException(404, "Patient not found")
    return filters.resolved()


def conditions(filters):
    result = [Job.created_at >= datetime.combine(filters.start_date, time.min, timezone.utc),
        Job.created_at <= datetime.combine(filters.end_date, time.max, timezone.utc)]
    for field in ("case_id", "status", "method_id", "method_version"):
        if getattr(filters, field) is not None: result.append(getattr(Job, field) == getattr(filters, field))
    if filters.patient_id: result.append(Case.patient_id == filters.patient_id)
    return result


def job_query(filters):
    return select(Job).join(Case, Job.case_id == Case.id).where(*conditions(filters))


def eligibility(db, filters, page_ids=None):
    """Small scalar/provenance scan for source eligibility; never loads lesions.

    Typed immutable writes are the trust boundary. SQL verifies row counts/IDs;
    reports additionally run full result/lesion contract validation on retrieval.
    """
    candidate_ids = select(Job.result_reference).join(Case,Case.id==Job.case_id).where(*conditions(filters),Job.status=="completed")
    if page_ids is not None: candidate_ids=candidate_ids.where(Job.id.in_(page_ids))
    counts = select(Lesion.result_id, func.count().label("n")).where(Lesion.result_id.in_(candidate_ids)).group_by(Lesion.result_id).subquery()
    invalid = select(Lesion.result_id, func.count().label("n")).where(
        (Lesion.payload_json["lesion_id"].as_string().is_(None)) |
        (Lesion.payload_json["lesion_id"].as_string() != Lesion.lesion_id)).where(Lesion.result_id.in_(candidate_ids)).group_by(Lesion.result_id).subquery()
    query = select(Job, Case, SegmentationResult, Result, counts.c.n, invalid.c.n).join(Case, Job.case_id == Case.id).outerjoin(
        SegmentationResult, SegmentationResult.id == Job.parent_segmentation_result_id).outerjoin(Result, Result.id == Job.result_reference).outerjoin(
        counts, counts.c.result_id == Result.id).outerjoin(invalid, invalid.c.result_id == Result.id).where(*conditions(filters), Job.status == "completed")
    if page_ids is not None: query = query.where(Job.id.in_(page_ids))
    states, valid, observed = {}, [], {}
    for job, case, parent, result, count, invalid_count in db.execute(query):
        state = "integrity_error"
        try:
            if (result is None or parent is None or result.analysis_id != job.id or result.case_id != case.id
                or result.parent_segmentation_result_id != job.parent_segmentation_result_id or result.source_sha256 != job.source_sha256
                or result.status != "completed" or result.schema_version != "1.0" or result.finding_count != (count or 0) or invalid_count):
                raise ValueError()
            provenance = AnalysisProvenance.model_validate(result.provenance_json)
            if (provenance.source != jobs.source_for(job) or provenance.geometry is None
                or (provenance.method_id, provenance.method_version, provenance.checkpoint_sha256) != (job.method_id,job.method_version,job.checkpoint_sha256)
                or geometry_fingerprint(provenance.geometry,job.source_sha256) != result.geometry_fingerprint
                or parent.case_id != case.id or tuple(parent.metadata_json.get("shape",[])) != provenance.geometry.shape
                or parent.metadata_json.get("affine") != [list(row) for row in provenance.geometry.affine]
                or parent.metadata_json.get("xyzt_units",0)&7 != 2): raise ValueError()
            if parent.source_volume_path != case.volume_path or parent.metadata_json.get("source_sha256") != job.source_sha256:
                state = "stale"
            else:
                if case.id not in observed:
                    try:
                        path = (UPLOAD_DIR/case.volume_path).resolve() if case.volume_path else None
                        if path is None or path.parent != VOLUME_DIR: raise OSError()
                        observed[case.id] = observed_source_sha256(path)
                    except (OSError, RuntimeError): observed[case.id] = "changed"
                digest = observed[case.id]
                state = "unverified" if digest is None else "current" if digest == job.source_sha256 else "stale"
        except (ValueError, TypeError, KeyError, AttributeError):
            state = "integrity_error"
        states[job.id] = state
        if state == "current": valid.append(result.id)
    return states, valid


def trends(db, filters):
    # Day denotes job creation, not an inferred completion event or model latency.
    day = cast(func.timezone("UTC",Job.created_at),Date) if db.bind.dialect.name == "postgresql" else func.date(Job.created_at)
    grouped = db.execute(select(day,Job.status,func.count()).join(Case,Case.id==Job.case_id).where(*conditions(filters)).group_by(day,Job.status)).all()
    days = {}
    for date, status, count in grouped:
        key = str(date)
        days.setdefault(key,{"date":key,"queued":0,"running":0,"completed":0,"failed":0})[status] = count
    return TrendResponse(contract_version="1.0", generated_at=now(), filters=filters, timezone="UTC",
        definition="UTC job-creation day with current lifecycle status; observed days only, not completion-event throughput.",items=[days[key] for key in sorted(days)])


def summary(db, filters, patient_authorized=False):
    filters = scope(db,filters,patient_authorized)
    status_counts = dict(db.execute(select(Job.status,func.count()).join(Case,Case.id==Job.case_id).where(*conditions(filters)).group_by(Job.status)).all())
    total = sum(status_counts.values())
    if total > MAX_COHORT: raise jobs.conflict("analytics_scope_too_large","Narrow the date/case/method filters to at most 2000 jobs.",413)
    states, valid = eligibility(db,filters)
    current = {"analyses":len(valid),"unique_cases":0,"unique_patients":0 if patient_authorized else None,
        "patient_count_reason":None if patient_authorized else "Patient-level counts require the existing clinical-writer role.",
        "lesions":0,"analyses_with_lesions":0,"cases_with_lesions":0,"zero_finding_analyses":0,"explanation_artifacts":0,"analyses_with_explanations":0}
    measures = []; anatomy = []; explanation_methods = []; severity = 0
    if valid:
        counts = db.execute(select(func.count(func.distinct(Result.case_id)),func.count(func.distinct(Case.patient_id)),func.sum(Result.finding_count),
            func.count().filter(Result.finding_count>0),func.count(func.distinct(Result.case_id)).filter(Result.finding_count>0),
            func.count().filter(Result.finding_count==0)).select_from(Result).join(Case,Case.id==Result.case_id).where(Result.id.in_(valid))).one()
        current.update(unique_cases=counts[0],unique_patients=counts[1] if patient_authorized else None,lesions=counts[2] or 0,
            analyses_with_lesions=counts[3],cases_with_lesions=counts[4],zero_finding_analyses=counts[5])
        ec = db.execute(select(func.count(),func.count(func.distinct(Explanation.result_id))).where(Explanation.result_id.in_(valid))).one()
        current.update(explanation_artifacts=ec[0],analyses_with_explanations=ec[1])
        severity = db.scalar(select(func.count()).select_from(Lesion).where(Lesion.result_id.in_(valid),Lesion.payload_json["severity"]["category"].as_string().is_not(None)))
        label = Lesion.payload_json["vessel_label"].as_string()
        anatomy = [{"label":name,"method_id":method,"method_version":version,"count":n} for name,method,version,n in db.execute(
            select(label,Job.method_id,Job.method_version,func.count()).select_from(Lesion).join(Result,Result.id==Lesion.result_id).join(Job,Job.id==Result.analysis_id)
            .where(Result.id.in_(valid),label.is_not(None)).group_by(label,Job.method_id,Job.method_version).order_by(Job.method_id,Job.method_version,label))]
        method, version = Explanation.metadata_json["method_id"].as_string(),Explanation.metadata_json["method_version"].as_string()
        explanation_methods = [{"label":m,"method_id":m,"method_version":v,"count":n} for m,v,n in db.execute(select(method,version,func.count())
            .where(Explanation.result_id.in_(valid)).group_by(method,version).order_by(method,version))]
    for field in ("reference_diameter","minimum_lumen_diameter","percentage_narrowing"):
        available = db.scalar(select(func.count()).select_from(Lesion).where(Lesion.result_id.in_(valid),Lesion.payload_json["measurements"][field]["value"].as_float().is_not(None))) if valid else 0
        measures.append({"field":field,"available":available,"unavailable":current["lesions"]-available})
    detection=next(item for item in capabilities().capabilities if item.id=="stenosis_detection")
    return AnalyticsSummary(contract_version="1.0",generated_at=now(),filters=filters,execution_available=detection.execution_permitted,
        execution_reason=detection.availability_reason+" Counts describe persisted records, not model performance.",
        jobs={"total":total,**{key:status_counts.get(key,0) for key in ("queued","running","completed","failed")}},current=current,
        quality={"stale":list(states.values()).count("stale"),"unverified":list(states.values()).count("unverified"),"integrity_errors":list(states.values()).count("integrity_error"),"freshness_policy":DEFINITIONS["freshness"]},
        severity_status="unavailable",severity_reason="No agreed severity taxonomy/version is integrated. Supplied labels are not combined or derived from narrowing.",severity_distribution=None,supplied_severity_labels=severity,
        measurements=measures,measurement_summary_status="unavailable",measurement_summary_reason="No approved cross-record measurement compatibility policy is integrated; presence counts only, no averages.",
        anatomy=anatomy,explanation_methods=explanation_methods,trends=trends(db,filters),definitions=DEFINITIONS)


def index(db, filters, patient_authorized=False, limit=20, offset=0):
    filters=scope(db,filters,patient_authorized)
    query=job_query(filters)
    total=db.scalar(select(func.count()).select_from(query.subquery()))
    page=db.scalars(query.order_by(Job.created_at.desc(),Job.id.desc()).limit(limit).offset(offset)).all()
    states,_=eligibility(db,filters,[job.id for job in page])
    return AnalysisIndex(contract_version="1.0",filters=filters,total=total,limit=limit,offset=offset,has_more=offset+len(page)<total,
        items=[{"analysis_id":job.id,"case_id":job.case_id,"status":job.status,"created_at":job.created_at,"completed_at":job.completed_at,
            "method_id":job.method_id,"method_version":job.method_version,"result_id":job.result_reference,"result_availability":states.get(job.id,"not_completed")} for job in page])
