import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthApi } from '../src/api/auth-contract.js';

test('registration maps existing UI names and logs in after creating the user', async () => {
  const calls = [];
  const user = { id: 1, full_name: 'Jane Smith', email: 'jane@example.org', role: 'Researcher' };
  const api = createAuthApi({
    post: async (path, body) => {
      calls.push({ path, body });
      return { data: path.endsWith('login') ? { access_token: 'test-token', token_type: 'bearer', user } : user };
    },
  });
  const result = await api.register({ name: 'Jane Smith', email: user.email, password: 'test-password', role: 'Researcher' });
  assert.deepEqual(calls, [
    { path: '/auth/register', body: { full_name: 'Jane Smith', email: user.email, password: 'test-password', role: 'Researcher', institution: '' } },
    { path: '/auth/login', body: { email: user.email, password: 'test-password' } },
  ]);
  assert.equal(result.user.name, 'Jane Smith');
  assert.equal(result.user.role, 'Researcher');
});

test('registration failure propagates without issuing a login', async () => {
  let calls = 0;
  const api = createAuthApi({ post: async () => { calls++; throw new Error('conflict'); } });
  await assert.rejects(api.register({ name: 'Test', email: 'a@example.org', password: 'test-password' }), /conflict/);
  assert.equal(calls, 1);
});

test('all four canonical roles survive identity mapping', async () => {
  for (const role of ['Clinician', 'Researcher', 'DataScientist', 'Admin']) {
    const api = createAuthApi({ get: async (path) => {
      assert.equal(path, '/auth/me');
      return { data: { full_name: 'User', role } };
    } });
    assert.deepEqual(await api.me(), { full_name: 'User', name: 'User', role });
  }
});

test('profile update excludes privilege and email changes', async () => {
  const api = createAuthApi({ patch: async (path, data) => {
    assert.equal(path, '/auth/me');
    assert.deepEqual(data, { full_name: 'Changed Name', institution: 'Lab', department: 'Imaging' });
    return { data };
  } });
  const user = await api.updateProfile({ name: 'Changed Name', institution: 'Lab', department: 'Imaging', role: 'Admin' });
  assert.equal(user.name, 'Changed Name');
});

test('password replacement returns a new session and logout uses the backend', async () => {
  const calls = [];
  const api = createAuthApi({ post: async (path, data) => {
    calls.push([path, data]);
    return { data: { access_token: 'new-test-token', user: { full_name: 'User' } } };
  } });
  assert.equal((await api.changePassword('old', 'new')).access_token, 'new-test-token');
  await api.logout();
  assert.deepEqual(calls, [
    ['/auth/password', { current_password: 'old', new_password: 'new' }],
    ['/auth/logout', undefined],
  ]);
});
