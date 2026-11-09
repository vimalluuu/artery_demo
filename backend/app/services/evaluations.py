"""Bounded offline imports and authorized read models. Never executes a model."""
import hashlib
import json
import math
import logging
from pathlib import Path
from uuid import UUID, uuid4
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.config import settings
from app.models.evaluation import EvaluationArtifact, EvaluationModel, EvaluationModelRun, Evaluation, EvaluationCase
from app.models import Case, SegmentationResult
from app.routers import segmentation as case_access
from app.schemas.evaluation import EvaluationDocument, CaseEvaluation
from app.services.audit import record_event
from app.core.evaluation_upload import MAX_EVALUATION_FILE_BYTES
from app.services.source_fingerprint import file_version, source_sha256

MAX_ARTIFACT_BYTES = MAX_EVALUATION_FILE_BYTES
MAX_HISTORY_OFFSET = 1000000
logger = logging.getLogger(__name__)
METRICS = ("dice", "iou", "precision", "recall")
FORMULAS = {"dice": "2*TP/(2*TP+FP+FN)", "iou": "TP/(TP+FP+FN)",
            "precision": "TP/(TP+FP)", "recall": "TP/(TP+FN)"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def document(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result
    def invalid(value):
        raise ValueError("Non-finite JSON number")
    try:
        return EvaluationDocument.model_validate(json.loads(data.decode("utf-8-sig"), object_pairs_hook=pairs, parse_constant=invalid))
    except (ValueError, TypeError, ValidationError, RecursionError):
        raise HTTPException(422, "Invalid offline-evaluation/1.0 JSON, metrics, or provenance") from None


def authorize_cases(db, cases, *, threshold):
    for row in cases:
        # Exactly the shared existing policy: authenticated CASE_READERS, then
        # the same case lookup used for protected segmentation data. No owner ACL.
        case_access.get_case(db, row.case_id)
        if row.mask_provenance and row.mask_provenance.segmentation_result_id:
            prediction = db.get(SegmentationResult, str(row.mask_provenance.segmentation_result_id))
            if prediction is None or prediction.case_id != row.case_id:
                raise HTTPException(409, "Mask provenance does not reference a segmentation for this case")
            if prediction.metadata_json.get("checkpoint_sha256") != row.mask_provenance.model_checkpoint_sha256:
                raise HTTPException(409, "Mask checkpoint conflicts with the stored segmentation")
            recorded_threshold = prediction.metadata_json.get("threshold")
            if (isinstance(recorded_threshold, bool) or not isinstance(recorded_threshold, (int, float))
                    or not math.isfinite(recorded_threshold) or recorded_threshold != threshold):
                raise HTTPException(409, "Mask threshold is missing or conflicts with the stored segmentation")
            # Existing result records name their actual UUID-owned mask file;
            # they do not contain a mask digest. Verify those real bytes rather
            # than inventing a metadata field or trusting the imported checksum.
            try:
                directory = case_access.result_directory(prediction.id)
                path = (directory / "prediction_mask.nii.gz").resolve()
                if path.parent != directory or file_version(path)[2] > settings.MAX_VOLUME_COMPRESSED_MB * 1024 * 1024:
                    raise OSError("Unverifiable mask storage")
                if source_sha256(path) != row.mask_provenance.mask_sha256:
                    raise HTTPException(409, "Mask checksum conflicts with the stored segmentation artifact")
            except (OSError, RuntimeError, ValueError):
                raise HTTPException(409, "Exact prediction-mask provenance cannot be verified") from None


def artifact_path(artifact_id):
    root = Path(settings.UPLOAD_DIR).resolve()
    directory = (root / "evaluation-artifacts").resolve()
    if directory.parent != root:
        raise HTTPException(409, "Evaluation artifact storage is unavailable")
    return directory / f"{UUID(str(artifact_id))}.json"


def upload(db, user, data):
    if not data or len(data) > MAX_ARTIFACT_BYTES:
        raise HTTPException(413, "Evaluation JSON must be nonempty and at most 2 MiB")
    parsed = document(data)
    authorize_cases(db, parsed.cases, threshold=parsed.metadata.threshold)
    identifier = str(uuid4())
    path = artifact_path(identifier)
    path.parent.mkdir(parents=True, exist_ok=True)
    item = EvaluationArtifact(id=identifier, sha256=hashlib.sha256(data).hexdigest(), size_bytes=len(data), uploaded_by=user.id)
    created_file = False
    commit_attempted = False
    try:
        with path.open("xb") as stream:
            created_file = True
            stream.write(data)
        db.add(item)
        record_event(db, "evaluation.artifact_uploaded", user.id)
        db.flush()
        commit_attempted = True
        db.commit()
        db.refresh(item)
    except BaseException:
        try:
            db.rollback()
        finally:
            if created_file and not commit_attempted:
                path.unlink(missing_ok=True)
            elif created_file:
                logger.warning("Evaluation artifact %s retained after commit attempt; reconcile its record before cleanup", identifier)
        raise
    return dict(id=item.id, sha256=item.sha256, size_bytes=item.size_bytes, created_at=item.created_at,
                schema_version="offline-evaluation/1.0")


def read_artifact(db, identifier):
    item = db.get(EvaluationArtifact, str(identifier))
    if item is None:
        raise HTTPException(404, "Stored evaluation artifact not found")
    path = artifact_path(item.id)
    if path.resolve().parent != path.parent:
        raise HTTPException(409, "Stored evaluation artifact failed integrity verification")
    try:
        # Parse/hash the SAME bounded bytes read from one open file, never an
        # arbitrary client path/URL or a file reopened after verification.
        with path.open("rb") as stream:
            data = stream.read(MAX_ARTIFACT_BYTES + 1)
    except OSError:
        raise HTTPException(409, "Stored evaluation artifact is unavailable") from None
    if len(data) != item.size_bytes or len(data) > MAX_ARTIFACT_BYTES or hashlib.sha256(data).hexdigest() != item.sha256:
        raise HTTPException(409, "Stored evaluation artifact failed integrity verification")
    return item, document(data)


def import_result(db, user, request):
    artifact, parsed = read_artifact(db, request.source_artifact_id)
    authorize_cases(db, parsed.cases, threshold=parsed.metadata.threshold)
    metadata = parsed.metadata.model_dump(mode="json")
    if canonical(metadata) != canonical(request.metadata.model_dump(mode="json")):
        raise HTTPException(409, "Import metadata conflicts with the stored source artifact")
    payload = parsed.model_dump(mode="json")
    payload["cases"].sort(key=lambda row: row["case_id"])
    digest = hashlib.sha256(canonical(payload)).hexdigest()
    def existing():
        row = find_existing_evaluation(db, artifact.id)
        if row is not None and (row.payload_sha256 != digest or canonical(row.metadata_json) != canonical(metadata)):
            raise HTTPException(409, "Source artifact already has conflicting evaluation metadata")
        return row
    previous = existing()
    if previous:
        return previous, False
    model_info = parsed.metadata.model
    checkpoint = parsed.metadata.checkpoint
    model = db.get(EvaluationModel, model_info.id)
    if model and (model.architecture != model_info.architecture or model.display_name != model_info.display_name):
        raise HTTPException(409, "Model identity conflicts with the stored registry")
    run = db.scalar(select(EvaluationModelRun).where(EvaluationModelRun.model_id == model_info.id,
                    EvaluationModelRun.training_run_id == checkpoint.training_run_id))
    if run and (run.checkpoint_sha256 != checkpoint.sha256 or run.reported_training_steps != checkpoint.reported_training_steps):
        raise HTTPException(409, "Training run identity conflicts with the stored checkpoint or metadata")
    try:
        if model is None:
            db.add(EvaluationModel(**model_info.model_dump()))
            db.flush()
        if run is None:
            run = EvaluationModelRun(id=str(uuid4()), model_id=model_info.id, training_run_id=checkpoint.training_run_id,
                checkpoint_sha256=checkpoint.sha256, reported_training_steps=checkpoint.reported_training_steps, source_artifact_id=artifact.id)
            db.add(run)
            db.flush()
        row = Evaluation(id=str(uuid4()), source_artifact_id=artifact.id, model_id=model_info.id, model_run_id=run.id,
                         checkpoint_sha256=checkpoint.sha256, threshold=parsed.metadata.threshold,
                         metadata_json=metadata, payload_sha256=digest, created_by=user.id)
        row.history_sha256 = history_digest(row, [c.case_id for c in parsed.cases])
        db.add(row)
        db.flush()
        for value in parsed.cases:
            db.add(EvaluationCase(evaluation_id=row.id, case_id=value.case_id, payload_json=value.model_dump(mode="json")))
        record_event(db, "evaluation.imported", user.id)
        db.commit()
        db.refresh(row)
        return row, True
    except IntegrityError:
        db.rollback()
        previous = existing()
        if previous:
            return previous, False
        raise HTTPException(409, "Evaluation or model registry changed concurrently; retry the import") from None


def load(db, identifier):
    row = db.get(Evaluation, str(identifier))
    if row is None:
        raise HTTPException(404, "Evaluation not found")
    records = db.scalars(select(EvaluationCase).where(EvaluationCase.evaluation_id == row.id).order_by(EvaluationCase.case_id)).all()
    if not records:
        raise HTTPException(409, "Stored evaluation has no case evidence")
    try:
        values = [CaseEvaluation.model_validate(r.payload_json) for r in records]
        if any(r.case_id != value.case_id for r, value in zip(records, values)):
            raise ValueError()
        parsed = EvaluationDocument.model_validate(dict(schema_version="offline-evaluation/1.0", metadata=row.metadata_json,
                                                        cases=[c.model_dump(mode="json") for c in values]))
        payload = parsed.model_dump(mode="json")
        if (hashlib.sha256(canonical(payload)).hexdigest() != row.payload_sha256
                or parsed.metadata.model.id != row.model_id or parsed.metadata.checkpoint.sha256 != row.checkpoint_sha256
                or parsed.metadata.threshold != row.threshold or history_digest(row, [c.case_id for c in values]) != row.history_sha256):
            raise ValueError()
    except (ValueError, ValidationError):
        raise HTTPException(409, "Stored evaluation case evidence is inconsistent") from None
    authorize_cases(db, values, threshold=parsed.metadata.threshold)
    return row, values


def identity(row):
    return dict(id=row.id, source_artifact_id=row.source_artifact_id, model_id=row.model_id,
                model_run_id=row.model_run_id, checkpoint_sha256=row.checkpoint_sha256,
                threshold=row.threshold, metadata=row.metadata_json, created_at=row.created_at)


def summary(row, cases):
    included = [c for c in cases if c.exclusion_reason is None]
    macro = {}
    denominators = {}
    for name in METRICS:
        values = [getattr(c.metrics, name) for c in included if getattr(c.metrics, name) is not None]
        macro[name] = math.fsum(values) / len(values) if values else None
        denominators[name] = dict(defined_cases=len(values), undefined_cases=len(included)-len(values))
    pooled = None
    if included and all(c.confusion_counts is not None for c in included):
        # Python integer sums are not restricted to a single case's count cap.
        tp = sum(c.confusion_counts.tp for c in included)
        fp = sum(c.confusion_counts.fp for c in included)
        fn = sum(c.confusion_counts.fn for c in included)
        ratio = lambda n, d: n / d if d else None
        pooled = dict(dice=ratio(2*tp,2*tp+fp+fn), iou=ratio(tp,tp+fp+fn), precision=ratio(tp,tp+fp), recall=ratio(tp,tp+fn))
    return dict(**identity(row), case_ids=[c.case_id for c in cases], case_count=len(cases), included_case_count=len(included),
                exclusions=[dict(case_id=c.case_id, reason=c.exclusion_reason) for c in cases if c.exclusion_reason],
                headline_aggregation="macro_unweighted_per_case", macro_metrics=macro, macro_denominators=denominators,
                pooled_micro_metrics=pooled, pooled_status="available" if pooled is not None else "unavailable_without_complete_included_confusion_counts",
                metric_formulas=FORMULAS, zero_denominator="null", undefined_macro_policy="omit_undefined_per_metric_and_report_count")


def case_details(row, cases):
    return dict(**identity(row), metric_definitions=row.metadata_json["metric_definitions"], metric_formulas=FORMULAS,
                undefined_macro_policy="omit_undefined_per_metric_and_report_count",
                cases=[c.model_dump(mode="json") for c in cases])


def comparison(db, identifiers):
    loaded = [load(db, identifier) for identifier in identifiers]
    expected = {c.case_id for c in loaded[0][1]}
    if any({c.case_id for c in cases} != expected for _, cases in loaded[1:]):
        raise HTTPException(409, "Evaluations cannot be compared: case sets must match exactly, including excluded members")
    return dict(case_ids=sorted(expected), evaluations=[summary(row, cases) for row, cases in loaded],
                metric_definitions_match=all(row.metadata_json["metric_definitions"] == loaded[0][0].metadata_json["metric_definitions"] for row, _ in loaded),
                reference_artifacts_match=all({c.case_id:c.reference_sha256 for c in cases} == {c.case_id:c.reference_sha256 for c in loaded[0][1]} for _, cases in loaded),
                exclusions_match=all({c.case_id:c.exclusion_reason for c in cases} == {c.case_id:c.exclusion_reason for c in loaded[0][1]} for _, cases in loaded))


def find_existing_evaluation(db, artifact_id):
    return db.scalar(select(Evaluation).where(Evaluation.source_artifact_id == artifact_id))


def history_digest(row, case_ids):
    return hashlib.sha256(canonical(dict(id=row.id, source_artifact_id=row.source_artifact_id, model_id=row.model_id,
        model_run_id=row.model_run_id, checkpoint_sha256=row.checkpoint_sha256, threshold=row.threshold,
        metadata=row.metadata_json, case_ids=sorted(case_ids)))).hexdigest()


def history_members(db, row, access=None):
    # Only indexed member IDs, never the potentially large case/section payloads.
    ids = list(db.scalars(select(EvaluationCase.case_id).where(EvaluationCase.evaluation_id == row.id)
                          .order_by(EvaluationCase.case_id).limit(1001)))
    if not ids or len(ids) > 1000 or history_digest(row, ids) != row.history_sha256:
        raise HTTPException(409, "Stored evaluation history evidence is inconsistent")
    access = {} if access is None else access
    for case_id in ids:
        if access.get(case_id) is False:
            raise HTTPException(404, "Case not found")
        if case_id not in access:
            try:
                case_access.get_case(db, case_id)
            except HTTPException as exc:
                if exc.status_code in {403, 404}:
                    access[case_id] = False
                raise
            access[case_id] = True
    return ids


def model_runs(db, model_id, *, limit=20, offset=0):
    model = db.get(EvaluationModel, model_id)
    if model is None:
        raise HTTPException(404, "Model not found")
    # Exclude an evaluation if ANY member is outside the very same SQL scope
    # used by the protected case lookup. Denied records never occupy an offset
    # or the look-ahead slot. No detailed case payloads are reconstructed.
    readable_ids = case_access.readable_cases().with_only_columns(Case.id)
    denied_member = select(EvaluationCase.case_id).where(
        EvaluationCase.evaluation_id == Evaluation.id,
        EvaluationCase.case_id.not_in(readable_ids)).correlate(Evaluation).exists()
    rows = db.scalars(select(Evaluation).where(Evaluation.model_id == model_id)
        .where(~denied_member)
        .order_by(Evaluation.created_at, Evaluation.id).offset(offset).limit(limit + 1)).all()
    more = len(rows) > limit
    evaluations = []
    visible_rows = []
    access = {}  # Request-local only: never reused across users or requests.
    for row in rows:
        # If access changed after SQL selected the window, fail the request;
        # also check the look-ahead row before exposing a continuation.
        ids = history_members(db, row, access)
        if len(evaluations) == limit:
            break
        evaluations.append(dict(**identity(row), case_ids=ids))
        visible_rows.append(row)
    run_ids = {row.model_run_id for row in visible_rows}
    runs = db.scalars(select(EvaluationModelRun).where(EvaluationModelRun.model_id == model_id, EvaluationModelRun.id.in_(run_ids))
        .order_by(EvaluationModelRun.created_at, EvaluationModelRun.id).limit(limit)).all() if run_ids else []
    visible_runs = []
    for run in runs:
        # A shared run's original source may belong to a different, inaccessible
        # evaluation. Do not expose that source ID or count the run in that case.
        origin = db.scalar(select(Evaluation).where(Evaluation.source_artifact_id == run.source_artifact_id))
        if origin is None:
            raise HTTPException(409, "Training-run source evidence is unavailable")
        try:
            history_members(db, origin, access)
        except HTTPException as exc:
            if exc.status_code in {403, 404}:
                continue
            raise
        checkpoint = origin.metadata_json["checkpoint"]
        if (origin.model_id != run.model_id or checkpoint["training_run_id"] != run.training_run_id
                or checkpoint["sha256"] != run.checkpoint_sha256
                or checkpoint["reported_training_steps"] != run.reported_training_steps):
            raise HTTPException(409, "Training-run history evidence is inconsistent")
        visible_runs.append(run)
    next_offset = offset + limit if more else None
    offset_limit_reached = next_offset is not None and next_offset > MAX_HISTORY_OFFSET
    if offset_limit_reached:
        next_offset = None
    return dict(model=dict(id=model.id, architecture=model.architecture, display_name=model.display_name),
        training_runs=[dict(id=r.id, training_run_id=r.training_run_id, checkpoint_sha256=r.checkpoint_sha256,
                            reported_training_steps=r.reported_training_steps, source_artifact_id=r.source_artifact_id,
                            record_origin="imported_offline_evaluation_metadata", created_at=r.created_at) for r in visible_runs],
        evaluations=evaluations, pagination=dict(limit=limit, offset=offset, next_offset=next_offset,
            offset_limit_reached=offset_limit_reached,
            returned_evaluations=len(evaluations), returned_training_runs=len(visible_runs)))


def sections(db, evaluation_id, case_id):
    row, cases = load(db, evaluation_id)
    case = next((c for c in cases if c.case_id == case_id), None)
    if case is None:
        raise HTTPException(404, "Case is not a member of this evaluation")
    # There is no validated gate registry/provider in this application. An
    # imported diagnostic status cannot authorize quantitative measurements.
    unavailable = "measurement_unavailable_no_validated_gate"
    return dict(evaluation_id=row.id, case_id=case_id, source_artifact_id=row.source_artifact_id,
        measurement_status=unavailable, validated_resolution_gate=None, mask_provenance=case.mask_provenance,
        sections=[dict(**s.model_dump(), measurement_status=unavailable) for s in case.sections],
        section_data_status="available" if case.sections else "unavailable_no_section_records",
        provenance=row.metadata_json["provenance"], quantitative_stenosis_available=False)
