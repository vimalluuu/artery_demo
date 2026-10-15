import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createAuthApi } from '../src/api/auth-contract.js';

const baseURL = process.env.VASCUAI_API_URL;
if (!baseURL) throw new Error('Run backend/scripts/test_frontend_contract.py to start an isolated server.');
const password = 'contract-test-password-123';
const http = axios.create({ baseURL, proxy: false });
const auth = createAuthApi(http);
const bearer = (session) => { http.defaults.headers.common.Authorization = 'Bearer ' + session.access_token; };
const status = (code) => (err) => err.response?.status === code;

test('real Axios registration/login/profile/password/logout contract', async () => {
  const payload = { name: 'HTTP Test User', email: 'http-user@example.org', password, role: 'Clinician', institution: 'Test Lab' };
  const session = await auth.register(payload);
  assert.equal(session.user.name, payload.name);
  assert.equal(session.user.role, 'Clinician');
  assert.equal(session.token_type, 'bearer');
  bearer(session);
  assert.equal((await auth.me()).email, payload.email);
  assert.equal((await auth.updateProfile({ name: 'Updated User', institution: 'Lab', department: 'Imaging' })).name, 'Updated User');
  await assert.rejects(auth.register(payload), status(409));
  const changed = await auth.changePassword(password, password + '-changed');
  await assert.rejects(auth.me(), status(401));
  bearer(changed);
  assert.equal((await auth.me()).name, 'Updated User');
  await auth.logout();
  await assert.rejects(auth.me(), status(401));
});

test('real Axios non-admin signup and server RBAC', async () => {
  for (const role of ['Researcher', 'DataScientist']) {
    const session = await auth.register({ name: role, email: role.toLowerCase() + '@example.org', password, role });
    bearer(session);
    assert.equal((await auth.me()).role, role);
    assert.equal((await http.get('/cases')).status, 200);
    await assert.rejects(http.get('/patients'), status(403));
    await assert.rejects(http.get('/admin/users'), status(403));
  }
  await assert.rejects(auth.register({ name: 'Forbidden Admin', email: 'forbidden@example.org', password, role: 'Admin' }), status(422));
  await assert.rejects(auth.login('researcher@example.org', 'wrong-password'), status(401));
});

test('real Axios administrator access and account revocation', async () => {
  bearer(await auth.login('contract-admin@example.org', password));
  const { data: users } = await http.get('/admin/users');
  const researcher = users.find((user) => user.role === 'Researcher');
  assert.ok(researcher);
  assert.equal((await http.patch('/admin/users/' + researcher.id, { role: 'DataScientist', is_active: false })).status, 200);
  await assert.rejects(auth.login(researcher.email, password), status(401));
  assert.ok((await http.get('/admin/audit')).data.length > 0);
});
