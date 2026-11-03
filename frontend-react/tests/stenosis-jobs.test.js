import test from "node:test";
import assert from "node:assert/strict";
import { createStenosisJobsApi, validateHistory, validateJob } from "../src/api/stenosis-jobs-contract.js";
import { createAnalysisTracker, activeHistory, requestKey } from "../src/lib/analysis-tracker.js";
import { sourceFixture, jobFixture, historyFixture } from "./stenosis-jobs-fixtures.js";

test("history and single-job adapters use authenticated-client relative case paths", async () => {
  const calls = [], signal = new AbortController().signal;
  const api = createStenosisJobsApi({ get: async (...args) => { calls.push(args); return { status: 200, data: calls.length === 1 ? historyFixture() : jobFixture() }; } });
  assert.deepEqual((await api.history(1, { signal })).items, []);
  assert.equal((await api.job(1, jobFixture().analysis_id, { signal })).status, "queued");
  assert.deepEqual(calls[0], ["/cases/1/stenosis/analyses", { params: { limit: 20, offset: 0 }, signal }]);
  assert.equal(calls[1][0], `/cases/1/stenosis/analyses/${jobFixture().analysis_id}`);
});

for (const state of ["queued", "running", "completed", "failed"]) test(`job contract preserves ${state} without medical results`, () => {
  const job = validateJob(jobFixture(state), 1);
  assert.equal(job.status, state);
  for (const field of ["lesions", "severity", "narrowing", "confidence"]) assert.ok(!(field in job));
});

for (const [name, mutate] of [
  ["wrong case", job => { job.case_id = 2; }], ["wrong source case", job => { job.provenance.source.case_id = 2; }],
  ["invalid version", job => { job.contract_version = "2.0"; }], ["unknown state", job => { job.status = "negative"; }],
  ["no failure metadata", job => { job.status = "failed"; }], ["no persisted completion", job => { job.status = "completed"; }],
  ["unknown failure code", job => { job.failure = { code: "private/path", message: "bad" }; }],
  ["invalid timestamp", job => { job.updated_at = "unknown"; }], ["invalid hash", job => { job.provenance.source.source_sha256 = "bad"; }],
  ["queued with start timestamp", job => { job.started_at = job.created_at; }],
  ["private image path", job => { job.provenance.source.image_reference = "C:/private/ct.nii"; }],
]) test(`job response rejects ${name}`, () => {
  const job = jobFixture(); mutate(job); assert.throws(() => validateJob(job, 1));
});

for (const [name, mutate] of [
  ["cross-case", data => { data.case_id = 2; }], ["duplicate job", data => { data.items.push(data.items[0]); }],
  ["invalid pagination", data => { data.limit = 0; }], ["invalid has_more", data => { data.has_more = true; }],
]) test(`history rejects ${name}`, () => {
  const data = historyFixture(["queued"]); mutate(data); assert.throws(() => validateHistory(data, 1));
});

test("start sends an allowlisted source and idempotency header, coalescing duplicate clicks", async () => {
  const calls = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const api = createStenosisJobsApi({ post: async (...args) => { calls.push(args); await gate; return { status: 202, data: jobFixture() }; } });
  const key = "request-key-123456789";
  const a = api.start(1, sourceFixture, key), b = api.start(1, { ...sourceFixture }, key);
  assert.equal(a, b);
  await Promise.resolve(); assert.equal(calls.length, 1);
  assert.equal(calls[0][2].headers["Idempotency-Key"], key);
  assert.deepEqual(calls[0][1], { contract_version: "1.0", source: sourceFixture });
  release(); assert.equal((await a).created, true);
});

test("same active key cannot be reused for a different request", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const api = createStenosisJobsApi({ post: async () => { await gate; return { status: 202, data: jobFixture() }; } });
  const pending = api.start(1, sourceFixture, "request-key-123456789");
  await assert.rejects(api.start(1, { ...sourceFixture, source_sha256: "b".repeat(64) }, "request-key-123456789"), /bound to another/);
  release(); await pending;
});

test("replayed failed jobs remain failed and are not presented as a new acceptance", async () => {
  const api = createStenosisJobsApi({ post: async () => ({ status: 200, data: jobFixture("failed") }) });
  const result = await api.start(1, sourceFixture, "request-key-123456789");
  assert.equal(result.created, false); assert.equal(result.job.status, "failed");
});

test("structured unavailable response remains a rejection, never a fabricated job", async () => {
  const error = Object.assign(new Error("HTTP 409"), { response: { status: 409, data: { detail: { contract_version: "1.0", code: "capability_unavailable", message: "No provider is registered." } } } });
  const api = createStenosisJobsApi({ post: async () => { throw error; } });
  await assert.rejects(api.start(1, sourceFixture, "request-key-123456789"), value => value.code === "capability_unavailable" && value.message === "No provider is registered.");
});

test("invalid source and unexpected acceptance responses are rejected", async () => {
  const api = createStenosisJobsApi({ post: async () => ({ status: 201, data: jobFixture() }) });
  await assert.rejects(api.start(1, { ...sourceFixture, case_id: 2 }, "request-key-123456789"));
  await assert.rejects(api.start(1, sourceFixture, "short"));
  await assert.rejects(api.start(1, sourceFixture, "request-key-123456789"));
});

function scheduler() {
  const timers = new Map(); let id = 0;
  return { timers, setTimer(fn) { timers.set(++id, fn); return id; }, clearTimer(key) { timers.delete(key); },
    fire() { const [key, fn] = timers.entries().next().value; timers.delete(key); return fn(); } };
}

test("active history polls sequentially and stops on terminal states", async () => {
  const clock = scheduler(), states = []; let calls = 0;
  const tracker = createAnalysisTracker({ ...clock, load: async () => historyFixture([++calls === 1 ? "queued" : "completed"]), isActive: activeHistory, onState: state => states.push(state) });
  await tracker.refresh(); assert.equal(clock.timers.size, 1);
  await clock.fire(); assert.equal(calls, 2); assert.equal(clock.timers.size, 0);
  assert.equal(states.at(-1).data.items[0].status, "completed"); tracker.stop();
});

test("empty history does not poll", async () => {
  const clock = scheduler();
  const tracker = createAnalysisTracker({ ...clock, load: async () => historyFixture(), isActive: activeHistory, onState() {} });
  await tracker.refresh(); assert.equal(clock.timers.size, 0); tracker.stop();
});

test("network failures retain valid history and retry recovers", async () => {
  const clock = scheduler(), states = []; let calls = 0;
  const tracker = createAnalysisTracker({ ...clock, load: async () => { if (++calls === 2) throw new Error("offline"); return historyFixture([calls === 1 ? "running" : "failed"]); }, isActive: activeHistory, onState: state => states.push(state) });
  await tracker.refresh(); await clock.fire();
  assert.equal(states.at(-1).data.items[0].status, "running"); assert.match(states.at(-1).error.message, /offline/);
  await clock.fire(); assert.equal(states.at(-1).data.items[0].status, "failed"); assert.equal(clock.timers.size, 0); tracker.stop();
});

test("overlapping refreshes coalesce, mutation refresh waits for the current request", async () => {
  const clock = scheduler(); let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const tracker = createAnalysisTracker({ ...clock, load: async () => { if (++calls === 1) await gate; return historyFixture(); }, isActive: activeHistory, onState() {} });
  const a = tracker.refresh(), b = tracker.refresh(); assert.equal(a, b);
  tracker.refresh({ afterCurrent: true }); release(); await a; await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); tracker.stop();
});

test("unmount aborts requests, clears timers and ignores late responses", async () => {
  const clock = scheduler(), states = []; let release, signal;
  const gate = new Promise(resolve => { release = resolve; });
  const tracker = createAnalysisTracker({ ...clock, load: async value => { signal = value; await gate; return historyFixture(["running"]); }, isActive: activeHistory, onState: state => states.push(state) });
  const pending = tracker.refresh(); await Promise.resolve(); tracker.stop(); const count = states.length;
  assert.equal(signal.aborted, true); release(); await pending;
  assert.equal(states.length, count); assert.equal(clock.timers.size, 0);
});

test("request identity survives navigation while separating users and sources", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(requestKey(storage, 1, sourceFixture, () => "original-request"), "original-request");
  assert.equal(requestKey(storage, 1, { ...sourceFixture }, () => "must-not-replace"), "original-request");
  assert.equal(requestKey(storage, 2, sourceFixture, () => "different-user"), "different-user");
  assert.equal(requestKey(storage, 1, { ...sourceFixture, source_sha256: "b".repeat(64) }, () => "different-input"), "different-input");
});
