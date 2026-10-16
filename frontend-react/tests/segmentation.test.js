import assert from "node:assert/strict";
import test from "node:test";
import api from "../src/api/client.js";
import { createSegmentationApi, parseThreshold } from "../src/api/segmentation-contract.js";
import { segmentationEligibility, segmentationError, saveArtifact } from "../src/lib/segmentation.js";

const resultId = "12345678-1234-4567-890a-123456789abc";

test("threshold accepts both boundaries and rejects empty, nonnumeric and out-of-range values", () => {
  for (const value of [0, "0", "0.70", 1, "1"]) assert.equal(parseThreshold(value), Number(value));
  for (const value of ["", " ", NaN, Infinity, "wrong", -0.1, 1.1, null, undefined, false]) assert.throws(() => parseThreshold(value), /between 0 and 1/);
});

test("input eligibility requires a stored 3D CT volume", () => {
  const item = { hasVolume: true, modality: "CTA" };
  assert.equal(segmentationEligibility(item, { ndim: 3 }), "");
  assert.equal(segmentationEligibility({ ...item, modality: "CT Angiography" }, { ndim: 3 }), "");
  assert.match(segmentationEligibility({ ...item, hasVolume: false }, null), /Upload/);
  assert.match(segmentationEligibility({ ...item, modality: "MRA" }, { ndim: 3 }), /CT only/);
  assert.match(segmentationEligibility(item, null), /metadata is unavailable/);
  assert.match(segmentationEligibility(item, { ndim: 4 }), /4D/);
});

test("run posts the validated threshold and requires confirmation of persistence", async () => {
  const calls = [];
  const service = createSegmentationApi({ post: async (...args) => { calls.push(args); return { status: 201, data: { id: resultId } }; } });
  assert.deepEqual(await service.run(7, "0.70"), { id: resultId });
  await service.run(7);
  assert.deepEqual(calls[0], ["/cases/7/segmentations", { threshold: .7 }, { timeout: 0 }]);
  assert.deepEqual(calls[1][1], {});
  await assert.rejects(service.run(7, ""), /threshold/);
  assert.equal(calls.length, 2);
  await assert.rejects(createSegmentationApi({ post: async () => ({ status: 200 }) }).run(7), /Refresh history/);
});

test("history uses the actual list contract and propagates server failures", async () => {
  const results = [{ id: resultId, stale: true, metadata: { threshold: 0 } }];
  const service = createSegmentationApi({ get: async (url) => { assert.equal(url, "/cases/7/segmentations"); return { data: results }; } });
  assert.equal(await service.list(7), results);
  await assert.rejects(service.list("https://wrong.test"), /case ID/);
  await assert.rejects(createSegmentationApi({ get: async () => ({ data: {} }) }).list(7), /Unexpected/);
});

test("the shared adapter blocks duplicate runs even after a page remount", async () => {
  let resolve, calls = 0;
  const gate = new Promise((done) => { resolve = done; });
  const service = createSegmentationApi({ post: async () => { calls++; await gate; return { status: 201, data: {} }; } });
  const pending = service.run(7, .7);
  await assert.rejects(service.run(7, .8), /already active/);
  assert.equal(calls, 1);
  resolve();
  await pending;
  await service.run(7, .8);
  assert.equal(calls, 2);
});

test("protected downloads use the shared bearer client and known relative routes", async () => {
  globalThis.localStorage = { getItem: () => "segmentation-test-token" };
  const blob = new Blob([new Uint8Array([31, 139, 8])], { type: "application/gzip" });
  const adapter = async (config) => {
    assert.equal(config.baseURL, "/api/v1");
    assert.equal(config.headers.Authorization, "Bearer segmentation-test-token");
    assert.equal(config.responseType, "blob");
    assert.match(config.url, new RegExp(`^/cases/7/segmentations/${resultId}/(mask|probabilities)$`));
    return { config, status: 200, data: blob, headers: { "content-type": "application/gzip" } };
  };
  const previous = api.defaults.adapter;
  api.defaults.adapter = adapter;
  try {
    for (const artifact of ["mask", "probabilities"]) {
      const downloaded = await createSegmentationApi(api).download(7, resultId, artifact);
      assert.equal(downloaded.blob, blob);
      assert.equal(downloaded.filename, `case-7-segmentation-${resultId}-${artifact}.nii.gz`);
    }
  } finally { api.defaults.adapter = previous; }
});

test("Blob error bodies are decoded and never returned as artifacts", async () => {
  for (const status of [403, 409, 503]) {
    const error = new Error("Request failed");
    error.response = { status, data: new Blob([JSON.stringify({ detail: "Actual backend error" })], { type: "application/json" }) };
    const service = createSegmentationApi({ get: async () => { throw error; } });
    await assert.rejects(service.download(7, resultId, "mask"), (value) => value === error && value.message === "Actual backend error" && value.response.status === status);
  }
  for (const data of [new Blob([]), new Blob(["{}"], { type: "application/json" }), new Blob(["<html>error</html>"], { type: "text/html" }), {}]) {
    await assert.rejects(createSegmentationApi({ get: async () => ({ status: 200, data }) }).download(7, resultId, "mask"), /No file was saved/);
  }
  await assert.rejects(createSegmentationApi({}).download(7, "../../secret", "mask"), /Invalid/);
});

test("errors distinguish conflicts, busy configuration, permissions and uncertain requests", () => {
  assert.match(segmentationError({ message: "Changed", response: { status: 409 } }), /Refresh case inputs/);
  assert.match(segmentationError({ message: "Busy", response: { status: 503 } }), /retry after the active run/);
  assert.match(segmentationError({ message: "Denied", response: { status: 403 } }), /does not have access/);
  assert.match(segmentationError({ message: "Network error" }), /may still finish/);
  assert.doesNotMatch(segmentationError({ message: "Network error" }, "download"), /may still finish/);
});

test("saving an authenticated Blob uses a temporary object URL and cleans it up", () => {
  const events = [];
  const previousDocument = globalThis.document;
  const previousTimeout = globalThis.setTimeout;
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const link = { click() { events.push(["click", this.download, this.href]); }, remove() { events.push(["remove"]); } };
  globalThis.document = { createElement: () => link, body: { appendChild: () => events.push(["append"]) } };
  globalThis.setTimeout = (callback) => callback();
  URL.createObjectURL = () => "blob:test-artifact";
  URL.revokeObjectURL = (url) => events.push(["revoke", url]);
  try {
    saveArtifact({ blob: new Blob(["test"]), filename: "safe.nii.gz" });
    assert.deepEqual(events, [["append"], ["click", "safe.nii.gz", "blob:test-artifact"], ["remove"], ["revoke", "blob:test-artifact"]]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.setTimeout = previousTimeout;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
