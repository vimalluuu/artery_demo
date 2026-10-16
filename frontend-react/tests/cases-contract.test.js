/**
 * cases-contract.test.js
 *
 * Tests for the cases and patients API adapters:
 *   - Field mapping (backend → UI shape) including new metadata fields
 *   - Status title-casing
 *   - fromCaseForm: new fields included in payload / empty strings → omitted
 *   - fromCaseUpdateForm: partial update semantics
 *   - casesApi.update: PATCH call construction
 *   - Request payloads (UI form → backend JSON / FormData)
 *   - Upload FormData construction
 *   - Error handling (403, 404, 409, 415)
 *   - Unsupported fields are null/[] rather than invented
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toCase, fromCaseForm, fromCaseUpdateForm, createCasesApi,
} from '../src/api/cases-contract.js';
import {
  toPatient, fromPatientForm, createPatientsApi,
} from '../src/api/patients-contract.js';
import { IMAGING_GUIDANCE } from '../src/constants/imaging-guidance.js';

// ─── toCase field mapping ─────────────────────────────────────────────────────

test('toCase maps backend integer id to UI id', () => {
  const raw = {
    id: 42, patient_id: 7, case_code: 'CASE-001', study_type: 'Coronary Artery Analysis',
    status: 'pending', image_path: null, created_at: '2026-10-15T10:00:00Z',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const c = toCase(raw);
  assert.equal(c.id, 42, 'id must be the integer DB PK');
  assert.equal(c.caseCode, 'CASE-001');
  assert.equal(c.patientId, 7);
  assert.equal(c.studyType, 'Coronary Artery Analysis');
  assert.equal(c.status, 'Pending');
  assert.equal(c.hasImage, false, 'null image_path → hasImage false');
  assert.equal(c.createdAt, '2026-10-15T10:00:00Z');
});

test('toCase sets hasImage=true when image_path is a non-null string', () => {
  const raw = {
    id: 1, patient_id: 1, case_code: 'C', study_type: 'S',
    status: 'complete', image_path: '/uploads/abc.png', created_at: '2026-01-01T00:00:00Z',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  assert.equal(toCase(raw).hasImage, true);
});

test('toCase title-cases lowercase backend status values', () => {
  // Backend DB stores lowercase; adapter must normalise to title-case for UI
  const statuses = [
    ['pending',    'Pending'],
    ['processing', 'Processing'],
    ['complete',   'Complete'],
    ['failed',     'Failed'],
  ];
  for (const [backendStatus, expectedUI] of statuses) {
    const raw = { id: 1, patient_id: 1, case_code: 'C', study_type: 'S', status: backendStatus,
      image_path: null, created_at: '', modality: null, region: null, scan_date: null,
      age_years: null, sex: null, notes: null };
    assert.equal(toCase(raw).status, expectedUI, `'${backendStatus}' should map to '${expectedUI}'`);
  }
});

// ─── toCase: new metadata fields (migration 0003_case_meta) ───────────────────

test('toCase maps all new metadata fields from backend', () => {
  const raw = {
    id: 5, patient_id: 2, case_code: 'CASE-007', study_type: 'Renal Artery Analysis',
    status: 'pending', image_path: null, created_at: '2026-10-01T00:00:00Z',
    modality:  'CT Angiography',
    region:    'Renal',
    scan_date: '2026-09-20',
    age_years: 58,
    sex:       'M',
    notes:     'Mild stenosis suspected',
  };
  const c = toCase(raw);
  assert.equal(c.modality,  'CT Angiography',        'modality must be mapped');
  assert.equal(c.region,    'Renal',                  'region must be mapped');
  assert.equal(c.scanDate,  '2026-09-20',             'scan_date → scanDate');
  assert.equal(c.age,       58,                       'age_years → age');
  assert.equal(c.gender,    'M',                      'sex → gender');
  assert.equal(c.notes,     'Mild stenosis suspected','notes must be mapped');
});

test('toCase maps null metadata fields for pre-migration cases', () => {
  const raw = {
    id: 1, patient_id: 1, case_code: 'C', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const c = toCase(raw);
  assert.equal(c.modality,  null, 'null modality preserved');
  assert.equal(c.region,    null, 'null region preserved');
  assert.equal(c.scanDate,  null, 'null scan_date → null scanDate');
  assert.equal(c.age,       null, 'null age_years → null age');
  assert.equal(c.gender,    null, 'null sex → null gender');
  assert.equal(c.notes,     null, 'null notes preserved');
});

test('toCase maps absent metadata fields (undefined → null)', () => {
  // Backend response from before migration may lack the new columns
  const raw = {
    id: 1, patient_id: 1, case_code: 'C', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    // No modality, region, scan_date, age_years, sex, notes keys at all
  };
  const c = toCase(raw);
  assert.equal(c.modality, null);
  assert.equal(c.region,   null);
  assert.equal(c.scanDate, null);
  assert.equal(c.age,      null);
  assert.equal(c.gender,   null);
  assert.equal(c.notes,    null);
});

test('toCase does NOT invent values for still-unsupported backend fields', () => {
  const raw = {
    id: 1, patient_id: 1, case_code: 'C', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const c = toCase(raw);
  // These fields have no backend column — must remain null/[], not invented
  assert.equal(c.severity,   null, 'severity must be null — not supported by backend');
  assert.equal(c.confidence, null, 'confidence must be null — not supported by backend');
  assert.equal(c.createdBy,  null, 'createdBy must be null — not supported by backend');
  assert.deepEqual(c.riskFactors, [], 'riskFactors must be [] — not supported by backend');
  assert.deepEqual(c.analyses,    [], 'analyses must be [] — no inference backend');
});

// ─── toCase: volume fields (migration 0004_volume_ingestion) ──────────────────

test('toCase maps volume fields correctly when volume_path is present', () => {
  const raw = {
    id: 1, patient_id: 1, case_code: 'C-VOL', study_type: 'S', status: 'pending',
    image_path: null, volume_path: 'volumes/abc-123.nii.gz', created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const c = toCase(raw);
  assert.equal(c.hasVolume, true, 'hasVolume must be true when volume_path is non-null');
  assert.equal(c.volumePath, 'volumes/abc-123.nii.gz', 'volumePath must match raw volume_path');
});

test('toCase maps volume fields correctly when volume_path is null or missing', () => {
  const rawWithNull = {
    id: 1, patient_id: 1, case_code: 'C-NOVOL', study_type: 'S', status: 'pending',
    image_path: null, volume_path: null, created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const c1 = toCase(rawWithNull);
  assert.equal(c1.hasVolume, false, 'hasVolume must be false when volume_path is null');
  assert.equal(c1.volumePath, null, 'volumePath must be null');

  const rawWithoutField = {
    id: 2, patient_id: 1, case_code: 'C-OLD', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const c2 = toCase(rawWithoutField);
  assert.equal(c2.hasVolume, false, 'hasVolume must be false when volume_path is undefined');
  assert.equal(c2.volumePath, null, 'volumePath must be null when undefined');
});

// ─── fromCaseForm payload ─────────────────────────────────────────────────────

test('fromCaseForm sends required fields', () => {
  const form = { patientId: '5', caseCode: ' CASE-007 ', studyType: 'Renal Artery Analysis',
    modality: '', region: '', scanDate: '', age: '', gender: '', notes: '' };
  const payload = fromCaseForm(form);
  assert.equal(payload.patient_id, 5);
  assert.equal(payload.case_code, 'CASE-007');
  assert.equal(payload.study_type, 'Renal Artery Analysis');
});

test('fromCaseForm includes new metadata fields when provided', () => {
  const form = {
    patientId: '3', caseCode: 'CASE-X', studyType: 'Coronary Artery Analysis',
    modality: 'CT Angiography', region: 'Coronary',
    scanDate: '2026-09-01', age: '62', gender: 'F', notes: 'Stable angina',
  };
  const payload = fromCaseForm(form);
  assert.equal(payload.modality,  'CT Angiography');
  assert.equal(payload.region,    'Coronary');
  assert.equal(payload.scan_date, '2026-09-01');
  assert.equal(payload.age_years, 62, 'age string parsed to integer age_years');
  assert.equal(payload.sex,       'F', 'gender → sex');
  assert.equal(payload.notes,     'Stable angina');
  assert.ok(!('gender' in payload), 'UI field name "gender" must not be sent — backend expects "sex"');
  assert.ok(!('age'    in payload), 'UI field name "age" must not be sent — backend expects "age_years"');
  assert.ok(!('scanDate' in payload), 'UI field name "scanDate" must not be sent — backend expects "scan_date"');
});

test('fromCaseForm omits metadata fields when empty strings', () => {
  const form = { patientId: '1', caseCode: 'X', studyType: 'Y',
    modality: '', region: '', scanDate: '', age: '', gender: '', notes: '' };
  const payload = fromCaseForm(form);
  assert.ok(!('modality'  in payload), 'empty modality omitted');
  assert.ok(!('region'    in payload), 'empty region omitted');
  assert.ok(!('scan_date' in payload), 'empty scan_date omitted');
  assert.ok(!('age_years' in payload), 'empty age omitted');
  assert.ok(!('sex'       in payload), 'empty gender/sex omitted');
  assert.ok(!('notes'     in payload), 'blank notes omitted');
});

test('fromCaseForm parses patientId as integer', () => {
  const payload = fromCaseForm({ patientId: '12', caseCode: 'X', studyType: 'Y',
    modality: '', region: '', scanDate: '', age: '', gender: '', notes: '' });
  assert.equal(typeof payload.patient_id, 'number');
  assert.equal(payload.patient_id, 12);
});

// ─── fromCaseUpdateForm (PATCH partial update) ────────────────────────────────

test('fromCaseUpdateForm includes only non-empty fields', () => {
  const form = { studyType: 'Aortic Analysis', modality: 'MRA', region: '',
    scanDate: '', age: '71', gender: 'M', notes: '' };
  const payload = fromCaseUpdateForm(form);
  assert.equal(payload.study_type, 'Aortic Analysis');
  assert.equal(payload.modality,   'MRA');
  assert.equal(payload.age_years,  71);
  assert.equal(payload.sex,        'M');
  assert.ok(!('region'    in payload), 'empty region omitted from PATCH');
  assert.ok(!('scan_date' in payload), 'empty scan_date omitted from PATCH');
  assert.ok(!('notes'     in payload), 'empty notes omitted from PATCH');
});

test('fromCaseUpdateForm returns empty object when nothing set', () => {
  const payload = fromCaseUpdateForm({ studyType: '', modality: '', region: '',
    scanDate: '', age: '', gender: '', notes: '' });
  assert.deepEqual(payload, {}, 'empty form produces empty payload');
});

// ─── createCasesApi — list / get / create / update ───────────────────────────

test('casesApi.list maps all results through toCase', async () => {
  const raw = [
    { id: 1, patient_id: 1, case_code: 'A', study_type: 'S', status: 'pending',
      image_path: null, created_at: '2026-01-01T00:00:00Z',
      modality: 'MRA', region: 'Carotid', scan_date: '2026-01-01',
      age_years: 45, sex: 'F', notes: null },
    { id: 2, patient_id: 2, case_code: 'B', study_type: 'T', status: 'complete',
      image_path: '/x.png', created_at: '2026-01-02T00:00:00Z',
      modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null },
  ];
  const api = createCasesApi({ get: async () => ({ data: raw }) });
  const cases = await api.list();
  assert.equal(cases.length, 2);
  assert.equal(cases[0].modality, 'MRA');
  assert.equal(cases[0].gender, 'F');
  assert.equal(cases[1].hasImage, true);
  assert.equal(cases[0].analyses.length, 0, 'analyses always empty');
});

test('casesApi.get sends correct path with integer id', async () => {
  let calledPath;
  const raw = { id: 7, patient_id: 3, case_code: 'C', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null };
  const api = createCasesApi({ get: async (path) => { calledPath = path; return { data: raw }; } });
  const c = await api.get(7);
  assert.equal(calledPath, '/cases/7');
  assert.equal(c.id, 7);
});

test('casesApi.create sends full payload including new metadata fields', async () => {
  const calls = [];
  const raw = { id: 10, patient_id: 5, case_code: 'CASE-NEW', study_type: 'Renal Artery Analysis',
    status: 'pending', image_path: null, created_at: '',
    modality: 'CT Angiography', region: 'Renal', scan_date: '2026-09-01',
    age_years: 62, sex: 'F', notes: 'Suspected stenosis' };
  const api = createCasesApi({
    post: async (path, body) => { calls.push({ path, body }); return { data: raw }; },
  });
  const form = { patientId: '5', caseCode: 'CASE-NEW', studyType: 'Renal Artery Analysis',
    modality: 'CT Angiography', region: 'Renal', scanDate: '2026-09-01',
    age: '62', gender: 'F', notes: 'Suspected stenosis' };
  const c = await api.create(form);
  assert.equal(calls[0].path, '/cases');
  assert.equal(calls[0].body.patient_id,  5);
  assert.equal(calls[0].body.modality,    'CT Angiography');
  assert.equal(calls[0].body.region,      'Renal');
  assert.equal(calls[0].body.scan_date,   '2026-09-01');
  assert.equal(calls[0].body.age_years,   62);
  assert.equal(calls[0].body.sex,         'F');
  assert.equal(calls[0].body.notes,       'Suspected stenosis');
  assert.equal(c.id, 10);
  assert.equal(c.modality, 'CT Angiography');
  assert.equal(c.gender, 'F');
  assert.equal(c.age, 62);
});

test('casesApi.update sends PATCH to correct path', async () => {
  const calls = [];
  const raw = { id: 3, patient_id: 1, case_code: 'C', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    modality: 'MRA', region: null, scan_date: null, age_years: null, sex: null, notes: null };
  const api = createCasesApi({
    patch: async (path, body) => { calls.push({ path, body }); return { data: raw }; },
  });
  const form = { modality: 'MRA', region: '', scanDate: '', age: '', gender: '', notes: '', studyType: '' };
  const c = await api.update(3, form);
  assert.equal(calls[0].path, '/cases/3');
  assert.deepEqual(calls[0].body, { modality: 'MRA' }, 'only non-empty field sent');
  assert.equal(c.modality, 'MRA');
});

test('casesApi.update skips request when payload is empty', async () => {
  let getCalled = false;
  const raw = { id: 3, patient_id: 1, case_code: 'C', study_type: 'S', status: 'pending',
    image_path: null, created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null };
  const api = createCasesApi({
    get: async () => { getCalled = true; return { data: raw }; },
    patch: async () => { throw new Error('PATCH should not be called for empty update'); },
  });
  await api.update(3, { modality: '', region: '', scanDate: '', age: '', gender: '', notes: '', studyType: '' });
  assert.ok(getCalled, 'falls back to GET when nothing to update');
});

// ─── createCasesApi — upload ───────────────────────────────────────────────────

test('casesApi.upload posts FormData to correct path with multipart header', async () => {
  const calls = [];
  const raw = { id: 3, patient_id: 1, case_code: 'C', study_type: 'S', status: 'processing',
    image_path: '/x.png', created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null };
  const api = createCasesApi({
    post: async (path, body, opts) => { calls.push({ path, body, opts }); return { data: raw }; },
  });
  const fd = new FormData();
  fd.append('file', new Blob(['img'], { type: 'image/png' }), 'test.png');
  const updated = await api.upload(3, fd);
  assert.equal(calls[0].path, '/cases/3/image');
  assert.ok(calls[0].body instanceof FormData, 'body must be FormData');
  assert.equal(calls[0].opts.headers['Content-Type'], 'multipart/form-data');
  assert.equal(updated.hasImage, true);
});

// ─── createCasesApi — getImageMetadata ────────────────────────────────────────

test('casesApi.getImageMetadata returns null on 404', async () => {
  const api = createCasesApi({
    get: async () => { const e = new Error('not found'); e.response = { status: 404 }; throw e; },
  });
  const meta = await api.getImageMetadata(99);
  assert.equal(meta, null);
});

test('casesApi.getImageMetadata propagates non-404 errors', async () => {
  const api = createCasesApi({
    get: async () => { const e = new Error('server error'); e.response = { status: 500 }; throw e; },
  });
  await assert.rejects(api.getImageMetadata(1), /server error/);
});

// ─── createCasesApi — uploadVolume ──────────────────────────────────────────

test('casesApi.uploadVolume posts FormData to /cases/{id}/volume with multipart header and maps response', async () => {
  const calls = [];
  const raw = {
    id: 7, patient_id: 2, case_code: 'C-7', study_type: 'S', status: 'pending',
    image_path: null, volume_path: 'volumes/scan7.nii.gz', created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const api = createCasesApi({
    post: async (path, body, opts) => { calls.push({ path, body, opts }); return { data: raw }; },
  });
  const fd = new FormData();
  fd.append('file', new Blob(['test-nii'], { type: 'application/octet-stream' }), 'scan.nii.gz');
  const updated = await api.uploadVolume(7, fd);
  assert.equal(calls[0].path, '/cases/7/volume');
  assert.ok(calls[0].body instanceof FormData, 'body must be FormData');
  assert.equal(calls[0].opts.headers['Content-Type'], 'multipart/form-data');
  assert.equal(updated.hasVolume, true);
  assert.equal(updated.volumePath, 'volumes/scan7.nii.gz');
});

test('casesApi.uploadVolume passes upload progress to onProgress callback', async () => {
  let capturedOpts;
  const raw = {
    id: 7, patient_id: 2, case_code: 'C-7', study_type: 'S', status: 'pending',
    image_path: null, volume_path: 'volumes/scan7.nii.gz', created_at: '',
    modality: null, region: null, scan_date: null, age_years: null, sex: null, notes: null,
  };
  const api = createCasesApi({
    post: async (path, body, opts) => { capturedOpts = opts; return { data: raw }; },
  });
  const fd = new FormData();
  let reportedPct = 0;
  await api.uploadVolume(7, fd, (pct) => { reportedPct = pct; });
  assert.ok(typeof capturedOpts.onUploadProgress === 'function', 'onUploadProgress must be configured');
  capturedOpts.onUploadProgress({ loaded: 50, total: 100 });
  assert.equal(reportedPct, 50);
});

// ─── createCasesApi — getVolumeMetadata ──────────────────────────────────────

test('casesApi.getVolumeMetadata returns metadata on 200', async () => {
  const rawMeta = {
    case_id: 7,
    ndim: 3,
    shape_x: 256, shape_y: 256, shape_z: 128, shape_t: null,
    voxel_spacing_x: 0.5, voxel_spacing_y: 0.5, voxel_spacing_z: 1.0,
    affine: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    voxel_dtype: 'float32',
    nifti_version: 1,
    qform_code: 1, sform_code: 1, xyzt_units: 2,
    file_size_bytes: 1048576,
    uploaded_at: '2026-10-16T00:00:00Z',
  };
  const api = createCasesApi({
    get: async (path) => {
      assert.equal(path, '/cases/7/volume/metadata');
      return { data: rawMeta };
    },
  });
  const meta = await api.getVolumeMetadata(7);
  assert.deepEqual(meta, rawMeta);
});

test('casesApi.getVolumeMetadata returns null on 404', async () => {
  const api = createCasesApi({
    get: async () => { const e = new Error('No volume'); e.response = { status: 404 }; throw e; },
  });
  const meta = await api.getVolumeMetadata(404);
  assert.equal(meta, null);
});

test('casesApi.getVolumeMetadata propagates non-404 errors', async () => {
  const api = createCasesApi({
    get: async () => { const e = new Error('Server error'); e.response = { status: 500 }; throw e; },
  });
  await assert.rejects(api.getVolumeMetadata(7), /Server error/);
});

// ─── toPatient field mapping ───────────────────────────────────────────────────

test('toPatient maps backend snake_case to UI camelCase', () => {
  const raw = { id: 3, patient_code: 'PT-001', display_name: 'Patient A', notes: 'mild risk', created_at: '2026-10-01T00:00:00Z' };
  const p = toPatient(raw);
  assert.equal(p.id, 3);
  assert.equal(p.patientCode, 'PT-001');
  assert.equal(p.displayName, 'Patient A');
  assert.equal(p.notes, 'mild risk');
  assert.equal(p.createdAt, '2026-10-01T00:00:00Z');
});

test('toPatient preserves null notes', () => {
  const raw = { id: 1, patient_code: 'X', display_name: 'Y', notes: null, created_at: '' };
  assert.equal(toPatient(raw).notes, null);
});

// ─── fromPatientForm payload ───────────────────────────────────────────────────

test('fromPatientForm trims and maps correctly', () => {
  const payload = fromPatientForm({ patientCode: '  PT-001  ', displayName: ' Anon A ', notes: '' });
  assert.deepEqual(payload, { patient_code: 'PT-001', display_name: 'Anon A', notes: null });
});

test('fromPatientForm keeps non-empty notes', () => {
  const payload = fromPatientForm({ patientCode: 'X', displayName: 'Y', notes: 'Some notes' });
  assert.equal(payload.notes, 'Some notes');
});

// ─── createPatientsApi ────────────────────────────────────────────────────────

test('patientsApi.list maps all patients', async () => {
  const raw = [
    { id: 1, patient_code: 'A', display_name: 'X', notes: null, created_at: '' },
    { id: 2, patient_code: 'B', display_name: 'Y', notes: 'n', created_at: '' },
  ];
  const api = createPatientsApi({ get: async () => ({ data: raw }) });
  const list = await api.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].patientCode, 'A');
  assert.equal(list[1].notes, 'n');
});

test('patientsApi.create sends correct payload', async () => {
  const calls = [];
  const raw = { id: 5, patient_code: 'PT-NEW', display_name: 'Patient B', notes: null, created_at: '' };
  const api = createPatientsApi({
    post: async (path, body) => { calls.push({ path, body }); return { data: raw }; },
  });
  await api.create({ patientCode: 'PT-NEW', displayName: 'Patient B', notes: null });
  assert.equal(calls[0].path, '/patients');
  assert.deepEqual(calls[0].body, { patient_code: 'PT-NEW', display_name: 'Patient B', notes: null });
});

// ─── Error propagation ────────────────────────────────────────────────────────

test('casesApi.list propagates 403 from backend', async () => {
  const api = createCasesApi({
    get: async () => { const e = new Error('Forbidden'); e.response = { status: 403 }; throw e; },
  });
  await assert.rejects(api.list(), /Forbidden/);
});

test('casesApi.create propagates 409 conflict', async () => {
  const api = createCasesApi({
    post: async () => { const e = new Error('Case code already exists'); e.response = { status: 409 }; throw e; },
  });
  await assert.rejects(
    api.create({ patientId: '1', caseCode: 'DUP', studyType: 'S',
      modality: '', region: '', scanDate: '', age: '', gender: '', notes: '' }),
    /Case code already exists/,
  );
});

test('casesApi.upload propagates 415 unsupported media type', async () => {
  const api = createCasesApi({
    post: async () => { const e = new Error('Supported formats: PNG, JPEG, and TIFF'); e.response = { status: 415 }; throw e; },
  });
  const fd = new FormData();
  await assert.rejects(api.upload(1, fd), /PNG, JPEG/);
});

// ─── Volume Error Propagation ────────────────────────────────────────────────

test('casesApi.uploadVolume propagates 403 forbidden', async () => {
  const api = createCasesApi({
    post: async () => { const e = new Error('Forbidden'); e.response = { status: 403 }; throw e; },
  });
  const fd = new FormData();
  await assert.rejects(api.uploadVolume(1, fd), /Forbidden/);
});

test('casesApi.uploadVolume propagates 415 unsupported format', async () => {
  const api = createCasesApi({
    post: async () => { const e = new Error('Unsupported format'); e.response = { status: 415 }; throw e; },
  });
  const fd = new FormData();
  await assert.rejects(api.uploadVolume(1, fd), /Unsupported format/);
});

test('casesApi.uploadVolume propagates 413 payload too large', async () => {
  const api = createCasesApi({
    post: async () => { const e = new Error('File exceeds limit'); e.response = { status: 413 }; throw e; },
  });
  const fd = new FormData();
  await assert.rejects(api.uploadVolume(1, fd), /File exceeds limit/);
});

// ─── Imaging Format Guidance Contract ────────────────────────────────────────

test('IMAGING_GUIDANCE defines accurate 2D image constraints', () => {
  assert.equal(IMAGING_GUIDANCE.twoDimensional.maxSizeMb, 20);
  assert.equal(IMAGING_GUIDANCE.twoDimensional.maxDimensionPx, 8192);
  assert.ok(IMAGING_GUIDANCE.twoDimensional.formats.includes('PNG'));
  assert.ok(IMAGING_GUIDANCE.twoDimensional.formats.includes('JPG/JPEG'));
  assert.ok(IMAGING_GUIDANCE.twoDimensional.formats.includes('TIFF'));
  assert.match(IMAGING_GUIDANCE.twoDimensional.description, /20 MB/);
  assert.match(IMAGING_GUIDANCE.twoDimensional.description, /8,192 pixels/);
});

test('IMAGING_GUIDANCE defines accurate volumetric constraints and limits', () => {
  assert.equal(IMAGING_GUIDANCE.volumetric.rawLimitMb, 2000, 'raw .nii limit is 2,000 MB');
  assert.equal(IMAGING_GUIDANCE.volumetric.compressedLimitMb, 512, '.nii.gz limit is 512 MB');
  assert.equal(IMAGING_GUIDANCE.volumetric.decompressedLimitMb, 2000, 'stream decompression limit is 2,000 MB');
  assert.deepEqual(IMAGING_GUIDANCE.volumetric.formats, ['.nii', '.nii.gz']);
  assert.equal(
    IMAGING_GUIDANCE.volumetric.dropzoneText,
    '.nii (max 2,000 MB) or .nii.gz (max 512 MB) · 3D / 4D volumes',
  );
  assert.match(IMAGING_GUIDANCE.volumetric.metadataDisclaimer, /NIfTI header metadata extraction is supported/);
  assert.match(IMAGING_GUIDANCE.volumetric.metadataDisclaimer, /segmentation.*inference.*not yet implemented/i);
});

test('IMAGING_GUIDANCE clearly identifies DICOM as unsupported', () => {
  assert.match(IMAGING_GUIDANCE.unsupported.dicom.status, /Not yet supported/);
  assert.match(IMAGING_GUIDANCE.unsupported.dicom.action, /Convert DICOM to NIfTI/);
});
