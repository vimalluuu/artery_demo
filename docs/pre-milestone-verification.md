# Verification before the integrated 3D segmentation milestone

This is the historical UI checkpoint, subsequently merged through PR #6. Its
model-prerequisite statements and test counts describe the state before model
integration. See [the current model verification](model-integration-verification.md)
and [integration guide](../backend/app/services/segmentation/README.md) for the
new backend inference capability and measured sample results.

## Four roles, one verified contract

The current canonical values are `Clinician`, `Researcher`, `DataScientist`, and `Admin`. The backend Python enum, database role constraint, registration schema, frontend route guards, and navigation agree. The earlier three-role description is outdated.

`frontend-react/src/constants/access-policy.json` records the frontend policy. Backend regression tests compare it with the actual enum, reader/writer groups, and public-registration schema, then exercise the protected API endpoints for all four roles. Browser tests check navigation and direct route access for each role.

| Capability | Clinician | Researcher | DataScientist | Admin |
| --- | --- | --- | --- | --- |
| Read cases and image/volume metadata | Yes | Yes | Yes | Yes |
| Read/register patients | Yes | No | No | Yes |
| Create/edit cases | Yes | No | No | Yes |
| Upload images/NIfTI | Yes | No | No | Yes |
| View research readiness screens | No | Yes | Yes | Yes |
| Manage users/read audit events | No | No | No | Yes |
| Change own profile/password/logout | Yes | Yes | Yes | Yes |

Public registration accepts the three non-administrator roles only. Backend authorization uses the current database role, not the JWT role claim. Access changes revoke existing sessions. The prototype grants each case-reader role access to all case records; assignment-level or per-subject access restrictions are not implemented.

The admin system-health page is a UI restriction. `/health` and `/health/ready` are intentionally public monitoring endpoints and do not expose account or study data. Dataset, model, experiment, and evaluation screens have no corresponding working management APIs yet, so no backend permissions for those nonexistent operations are claimed.

## NIfTI findings and fixes

The audit reproduced acceptance of valid headers with missing voxel payloads in both `.nii` and `.nii.gz`. It also reproduced rejection of valid meter/micron geometries due to assumed millimeter thresholds, and found that the configured voxel-count limit was not passed to validation.

These are fixed:

- Compare the actual raw/expanded file length with the header's voxel offset, dimensions, time dimension, and data type size. Reject truncated or over-limit declared payloads.
- Enforce the configured spatial voxel limit and include all 4D frames in the byte budget.
- Parse only the fixed NIfTI header; avoid loading voxel arrays or attacker-sized extension blocks during ingestion.
- Validate finite positive spacing in the recorded spatial units; use a scale-independent affine degeneracy check. Do not rescale or rewrite the original study.
- Preserve original file bytes, shape, qform/sform codes, units, dtype, and the selected affine. The selected affine follows [NiBabel's sform/qform/fallback precedence](https://nipy.org/nibabel/nifti_images.html#choosing-the-image-affine).
- Clean newly written files on any pre-commit failure; retain the previous committed study on failed replacement. Do not delete a committed file because a later refresh failed. Update the volume upload timestamp when replacing a volume.

Tests cover NIfTI-1/2, raw/compressed files, actual stored voxel equality, geometry preservation, incomplete payloads, configured limits, and replacement rollback using synthetic non-patient volumes.

**Current capability:** validated ingestion, original-file storage, and spatial metadata inspection. Volumetric preprocessing, trained segmentation, 3D result viewing, and evaluation are not implemented. DICOM remains unsupported. Header/file validity is not a claim of model compatibility, de-identification, image quality, or clinical validity.

## Production routing

`deploy/` contains the compiled-frontend nginx configuration, Dockerfiles, Compose reference, private environment example, and an executable routing check. It preserves `/api/v1`, handles both health endpoints separately from the SPA fallback, forwards multipart uploads, preserves API error statuses, and supports direct frontend route refresh.

Health requests now use a separate HTTP client so a configured external monitoring host never receives the authenticated API token. Liveness and database readiness require their respective exact response states.

See `deploy/README.md` for startup, migration, TLS/domain, CORS, persistent storage, and verification details. Compose syntax and real nginx routing were checked locally. Container-image builds/full-stack startup remain unverified because the Docker daemon is not running. Nothing was remotely deployed.

## Next milestone: real segmentation, not placeholder results

The repository contains no trained checkpoint (`.pt`, `.pth`, `.onnx`, `.ckpt`, etc.), inference implementation, de-identified example volume, or reference segmentation mask. Model-dependent work requires those assets and their documented input/output contract.

Before wiring the run button, identify:

1. Model artifact, architecture/loader, version/checksum, and permitted use.
2. Intended modality, target anatomy, label definitions, and 3D input shape.
3. Training-time orientation, spatial units, resampling, intensity normalization, padding/cropping, patching, and postprocessing requirements.
4. A de-identified example study and, for genuine evaluation, a matching ground-truth mask and split provenance.
5. Supported hardware and measured memory/runtime limits.

The implemented milestone should then save an immutable run record, preprocess without losing the input-to-output transform, execute the real artifact in a background job, map predictions back to source geometry, serve protected outputs, display the 3D segmentation, calculate appropriate segmentation metrics against the aligned reference, and export a traceable research report.

Without reference annotations, segmentation may be displayed but Dice/IoU and other reference-dependent scores must remain unavailable. Segmentation alone does not establish stenosis, severity, calibrated confidence, or clinical findings. Those remain unavailable until their separate methods and validation evidence exist. The system remains a research/decision-support prototype, not an autonomous diagnostic system.

## Measured verification results

- Backend: **235 tests passed** on disposable SQLite and **235 passed** on an isolated PostgreSQL 18 cluster. No existing application database was modified.
- Frontend: **57 unit/contract tests passed** and **3 real Axios-to-FastAPI integration tests passed** against a disposable test database.
- Browser: **16 scenarios passed**, covering all four roles, navigation/route guards, study workflows, health-token isolation, responsive layouts, and automated accessibility checks across the current screens.
- Production frontend build passed. Lint reports only the pre-existing AuthContext Fast Refresh warning; backend tests report existing framework deprecation warnings.
- nginx 1.30.6 syntax and executable routing checks passed using the checked-in server configuration and isolated loopback services.
- Docker Compose configuration validation passed. The Docker daemon was unavailable, so Linux container-image builds and full-stack container startup are still unverified.

These checks validate software behavior with synthetic volumes; they do not establish clinical performance or validate any trained segmentation model.
