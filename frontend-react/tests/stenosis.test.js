import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_IDS, createStenosisApi, validateCapabilities, capabilityError, StenosisContractError } from "../src/api/stenosis-contract.js";

export function capabilityFixture() {
  return { contract_version: "1.0", capabilities: CAPABILITY_IDS.map(id => ({
    contract_version: "1.0", id, display_name: id.replaceAll("_", " "),
    status: "unavailable", availability_reason: "No verified provider is integrated.",
    execution_permitted: false, method_id: null, method_version: null,
  })) };
}

test("stenosis capabilities use the shared client's relative route and AbortSignal", async () => {
  const calls = [];
  const data = capabilityFixture();
  const signal = new AbortController().signal;
  const api = createStenosisApi({ get: async (...args) => { calls.push(args); return { status: 200, data }; } });
  assert.equal(await api.capabilities({ signal }), data);
  assert.deepEqual(calls, [["/stenosis/capabilities", { signal }]]);
  assert.ok(data.capabilities.every(item => item.execution_permitted === false));
});

for (const status of [401, 403, 503]) test(`stenosis adapter preserves HTTP ${status} rather than assuming availability`, async () => {
  const failure = Object.assign(new Error("request failed"), { response: { status } });
  const api = createStenosisApi({ get: async () => { throw failure; } });
  await assert.rejects(api.capabilities(), error => error === failure);
  assert.match(capabilityError(failure), status === 401 ? /session expired/ : status === 403 ? /does not have access/ : /availability is unknown/);
});

test("network failure remains an error and a later retry retrieves the response", async () => {
  let calls = 0;
  const api = createStenosisApi({ get: async () => {
    if (++calls === 1) throw new Error("offline");
    return { status: 200, data: capabilityFixture() };
  } });
  await assert.rejects(api.capabilities(), /offline/);
  assert.equal((await api.capabilities()).capabilities.length, 9);
  assert.equal(calls, 2);
});

for (const [name, mutate] of [
  ["missing version", value => { delete value.contract_version; }],
  ["unsupported version", value => { value.contract_version = "2.0"; }],
  ["missing capability", value => value.capabilities.pop()],
  ["duplicate capability", value => { value.capabilities[1] = value.capabilities[0]; }],
  ["unknown capability", value => { value.capabilities[0].id = "segmentation"; }],
  ["unknown state", value => { value.capabilities[0].status = "processing"; }],
  ["missing reason", value => { delete value.capabilities[0].availability_reason; }],
  ["blank name", value => { value.capabilities[0].display_name = " "; }],
  ["string permission", value => { value.capabilities[0].execution_permitted = "false"; }],
  ["unavailable execution", value => { value.capabilities[0].execution_permitted = true; }],
  ["unversioned method", value => { value.capabilities[0].method_id = "provider"; }],
  ["unregistered available", value => { value.capabilities[0].status = "available"; }],
  ["inconsistent version", value => { value.capabilities[0].contract_version = "2.0"; }],
  ["null entry", value => { value.capabilities[0] = null; }],
]) test(`stenosis response rejects ${name}`, () => {
  const value = capabilityFixture(); mutate(value);
  assert.throws(() => validateCapabilities(value), StenosisContractError);
});

for (const value of [null, [], "html", {}, { contract_version: "1.0", capabilities: null }]) {
  test(`malformed envelope ${JSON.stringify(value)} is not an empty success`, () => {
    assert.throws(() => validateCapabilities(value), StenosisContractError);
  });
}

test("all four states are recognized without enabling nonavailable methods", () => {
  for (const status of ["available", "unavailable", "not_integrated", "disabled"]) {
    const data = capabilityFixture();
    Object.assign(data.capabilities[0], { status, method_id: "provider", method_version: "v1", execution_permitted: status === "available" });
    assert.equal(validateCapabilities(data).capabilities[0].status, status);
  }
});

test("unexpected successful HTTP status is not accepted as a capability response", async () => {
  const api = createStenosisApi({ get: async () => ({ status: 202, data: capabilityFixture() }) });
  await assert.rejects(api.capabilities(), /did not confirm/);
});
