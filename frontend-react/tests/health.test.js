import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

test("separate health URLs receive no bearer token and require the exact expected status", async () => {
  const previousAdapter = axios.defaults.adapter;
  const requests = [];
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (key === "vascuai_token" ? "test-bearer-token" : null),
  };
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    return { status: 200, data: { status: "healthy" }, config, headers: {} };
  };
  try {
    const { checkHealth } = await import("../src/api/health.js");
    const result = await checkHealth("https://monitor.example.test/health/");
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "https://monitor.example.test/health",
        "https://monitor.example.test/health/ready",
      ],
    );
    assert.ok(
      requests.every((request) => !request.headers.get("Authorization")),
    );
    assert.equal(result.checks[0].available, true);
    assert.equal(
      result.checks[1].available,
      false,
      "liveness is not database readiness",
    );
  } finally {
    axios.defaults.adapter = previousAdapter;
    globalThis.localStorage = previousStorage;
  }
});
