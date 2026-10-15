/**
 * cases-contract.test.js
 *
 * Tests for the cases and patients API adapters:
 *   - Field mapping (backend → UI shape)
 *   - Request payloads (UI form → backend JSON / FormData)
 *   - Upload FormData construction
 *   - Error handling (403, 404, 409, 415)
 *   - Unsupported fields are null/[] rather than invented
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toCase, fromCaseForm, createCasesApi,
} from '../src/api/cases-contract.js';
import {
  toPatient, fromPatientForm, createPatientsApi,
} from '../src/api/patients-contract.js';

// ─── toCase field mapping ─────────────────────────────────────────────────────

test('toCase maps backend integer id to UI id', () => {
  const raw = {
    id: 42, patient_id: 7, case_code: 'CASE-001', study_type: 'Coronary Artery Analysis',
    status: 'Pending', image_path: null, created_at: '2026-10-15T10:00:00Z',
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
    status: 'Complete', image_path: '/uploads/abc.png', created_at: '2026-01-01T00:00:00Z',
  };
  assert.equal(toCase(raw).hasImage, true);
});

test('toCase does NOT invent values for unsupported backend fields', () => {
  const raw = {
    id: 1, patient_id: 1, case_code: 'C', study_type: 'S',
    status: 'Pending', image_path: null, created_at: '2026-01-01T00:00:00Z',
  };
  const c = toCase(raw);
  // These fields have no backend column — must be null/[], not invented values
  assert.equal(c.modality,   null, 'modality must be null — not supported by backend');
  assert.equal(c.region,     null, 'region must be null — not supported by backend');
  assert.equal(c.scanDate,   null, 'scanDate must be null — not supported by backend');
  assert.equal(c.severity,   null, 'severity must be null — not supported by backend');
  assert.equal(c.confidence, null, 'confidence must be null — not supported by backend');
  assert.equal(c.createdBy,  null, 'createdBy must be null — not supported by backend');
  assert.equal(c.age,        null, 'age must be null — not supported by backend');
  assert.equal(c.gender,     null, 'gender must be null — not supported by backend');
  assert.equal(c.notes,      null, 'notes must be null — not supported by backend');
  assert.deepEqual(c.riskFactors, [], 'riskFactors must be [] — not supported by backend');
  assert.deepEqual(c.analyses,    [], 'analyses must be [] — no inference backend');
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
    const raw = { id: 1, patient_id: 1, case_code: 'C', study_type: 'S', status: backendStatus, image_path: null, created_at: '' };
    assert.equal(toCase(raw).status, expectedUI, `'${backendStatus}' should map to '${expectedUI}'`);
  }
});

// ─── fromCaseForm payload ─────────────────────────────────────────────────────

test('fromCaseForm sends patient_id, case_code, study_type only', () => {
  const form = {
    patientId: '5', caseCode: ' CASE-007 ', studyType: 'Renal Artery Analysis',
    // UI-only fields that must NOT be sent to backend
    modality: 'CT Angiography', region: 'Renal', scanDate: '2026-10-01',
    age: '58', gender: 'M', riskFactors: ['Hypertension'],
  };
  const payload = fromCaseForm(form);
  assert.deepEqual(payload, {
    patient_id: 5,
    case_code:  'CASE-007',    // trimmed
    study_type: 'Renal Artery Analysis',
  });
  assert.ok(!('modality'    in payload), 'modality must not be sent to backend');
  assert.ok(!('region'      in payload), 'region must not be sent to backend');
  assert.ok(!('scanDate'    in payload), 'scanDate must not be sent to backend');
  assert.ok(!('age'         in payload), 'age must not be sent to backend');
  assert.ok(!('riskFactors' in payload), 'riskFactors must not be sent to backend');
});

test('fromCaseForm parses patientId as integer', () => {
  const payload = fromCaseForm({ patientId: '12', caseCode: 'X', studyType: 'Y' });
  assert.equal(typeof payload.patient_id, 'number');
  assert.equal(payload.patient_id, 12);
});

// ─── createCasesApi — list / get / create ─────────────────────────────────────

test('casesApi.list maps all results through toCase', async () => {
  const raw = [
    { id: 1, patient_id: 1, case_code: 'A', study_type: 'S', status: 'Pending', image_path: null, created_at: '2026-01-01T00:00:00Z' },
    { id: 2, patient_id: 2, case_code: 'B', study_type: 'T', status: 'Complete', image_path: '/x.png', created_at: '2026-01-02T00:00:00Z' },
  ];
  const api = createCasesApi({ get: async () => ({ data: raw }) });
  const cases = await api.list();
  assert.equal(cases.length, 2);
  assert.equal(cases[0].id, 1);
  assert.equal(cases[1].hasImage, true);
  assert.equal(cases[0].analyses.length, 0, 'analyses always empty');
});

test('casesApi.get sends correct path with integer id', async () => {
  let calledPath;
  const raw = { id: 7, patient_id: 3, case_code: 'C', study_type: 'S', status: 'Pending', image_path: null, created_at: '' };
  const api = createCasesApi({ get: async (path) => { calledPath = path; return { data: raw }; } });
  const c = await api.get(7);
  assert.equal(calledPath, '/cases/7');
  assert.equal(c.id, 7);
});

test('casesApi.create sends correct payload and maps response', async () => {
  const calls = [];
  const raw = { id: 10, patient_id: 5, case_code: 'CASE-NEW', study_type: 'Coronary Artery Analysis', status: 'Pending', image_path: null, created_at: '' };
  const api = createCasesApi({
    post: async (path, body) => { calls.push({ path, body }); return { data: raw }; },
  });
  const form = { patientId: '5', caseCode: 'CASE-NEW', studyType: 'Coronary Artery Analysis' };
  const c = await api.create(form);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/cases');
  assert.deepEqual(calls[0].body, { patient_id: 5, case_code: 'CASE-NEW', study_type: 'Coronary Artery Analysis' });
  assert.equal(c.id, 10);
  assert.equal(c.caseCode, 'CASE-NEW');
});

// ─── createCasesApi — upload ───────────────────────────────────────────────────

test('casesApi.upload posts FormData to correct path with multipart header', async () => {
  const calls = [];
  const raw = { id: 3, patient_id: 1, case_code: 'C', study_type: 'S', status: 'Processing', image_path: '/x.png', created_at: '' };
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
  await assert.rejects(api.create({ patientId: '1', caseCode: 'DUP', studyType: 'S' }), /Case code already exists/);
});

test('casesApi.upload propagates 415 unsupported media type', async () => {
  const api = createCasesApi({
    post: async () => { const e = new Error('Supported formats: PNG, JPEG, and TIFF'); e.response = { status: 415 }; throw e; },
  });
  const fd = new FormData();
  await assert.rejects(api.upload(1, fd), /PNG, JPEG/);
});
