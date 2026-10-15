import assert from 'node:assert/strict';
import test from 'node:test';
import api from '../src/api/client.js';

function browser() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  globalThis.window = new EventTarget();
}
function denied(config, status = 401, detail = 'Denied') {
  const error = new Error('Request failed');
  error.config = config;
  error.response = { status, data: { detail } };
  return Promise.reject(error);
}

test('client preserves the /api/v1 prefix and sends bearer authentication', async () => {
  browser();
  localStorage.setItem('vascuai_token', 'current-test-token');
  await api.get('/auth/me', { adapter: async (config) => {
    assert.equal(config.baseURL, '/api/v1');
    assert.equal(config.headers.Authorization, 'Bearer current-test-token');
    return { data: {}, status: 200, config };
  } });
});

test('current-session 401 clears identity and notifies React', async () => {
  browser();
  localStorage.setItem('vascuai_token', 'old-test-token');
  localStorage.setItem('vascuai_user', 'untrusted-cache');
  let events = 0;
  window.addEventListener('vascuai:unauthorized', () => events++);
  await assert.rejects(api.get('/auth/me', { adapter: denied }), /Denied/);
  assert.equal(localStorage.getItem('vascuai_token'), null);
  assert.equal(localStorage.getItem('vascuai_user'), null);
  assert.equal(events, 1);
});

test('a stale request cannot clear a newer session', async () => {
  browser();
  localStorage.setItem('vascuai_token', 'old-test-token');
  await assert.rejects(api.get('/auth/me', { adapter: async (config) => {
    localStorage.setItem('vascuai_token', 'new-test-token');
    return denied(config);
  } }), /Denied/);
  assert.equal(localStorage.getItem('vascuai_token'), 'new-test-token');
});

test('login failures and validation errors stay on the form', async () => {
  browser();
  localStorage.setItem('vascuai_token', 'current-test-token');
  await assert.rejects(api.post('/auth/login', {}, { adapter: denied }), /Denied/);
  assert.equal(localStorage.getItem('vascuai_token'), 'current-test-token');
  await assert.rejects(api.post('/auth/register', {}, {
    adapter: (config) => denied(config, 422, [{ msg: 'Password too short' }]),
  }), /Password too short/);
});
