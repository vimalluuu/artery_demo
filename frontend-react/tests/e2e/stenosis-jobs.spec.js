import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installApi } from "./fixtures";
import { capabilitiesFixture, historyFixture, jobFixture, parentId, sourceFixture } from "../stenosis-jobs-fixtures";

async function setup(page, { available = false, role = "Clinician" } = {}) {
  await installApi(page, { role });
  await page.route("**/api/v1/stenosis/capabilities", route => route.fulfill({ json: capabilitiesFixture(available) }));
  await page.route("**/api/v1/cases/1/segmentations", route => route.fulfill({ json: [{ id: parentId, case_id: 1, stale: false, metadata: { source_sha256: sourceFixture.source_sha256 } }] }));
}

test("empty history remains distinct from negative findings and unavailable execution", async ({ page }) => {
  await setup(page);
  await page.goto("/cases/1/stenosis");
  await expect(page.getByText("No analyses have been performed for this case.")).toBeVisible();
  await expect(page.getByText("An empty history is not a negative stenosis finding.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start stenosis analysis" })).toBeDisabled();
});

test("active history polls to terminal state, then stops", async ({ page }) => {
  await page.clock.install(); await setup(page);
  let status = "queued", reads = 0;
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => { reads++; return route.fulfill({ json: historyFixture([status]) }); });
  await page.goto("/cases/1/stenosis");
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  status = "running"; await page.clock.fastForward(6000);
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  status = "completed"; await page.clock.fastForward(6000);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  const terminalReads = reads; await page.clock.fastForward(30000);
  expect(reads).toBe(terminalReads);
  await expect(page.getByText(/Candidate results require a persisted completed result/)).toBeVisible();
});

test("failed records show safe failure and stop polling", async ({ page }) => {
  await page.clock.install(); await setup(page);
  let reads = 0;
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => { reads++; return route.fulfill({ json: historyFixture(["failed"]) }); });
  await page.goto("/cases/1/stenosis");
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/Failure \(provider_error\)/)).toBeVisible();
  await page.clock.fastForward(30000); expect(reads).toBe(1);
});

test("refresh errors preserve history and Retry recovers", async ({ page }) => {
  await setup(page); let fail = false;
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => fail ? route.fulfill({ status: 503, json: { detail: "History temporarily unavailable" } }) : route.fulfill({ json: historyFixture(["failed"]) }));
  await page.goto("/cases/1/stenosis"); await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  fail = true; await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("History temporarily unavailable");
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  fail = false; await page.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("selected status is case-scoped and recovers after reload", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => route.fulfill({ json: historyFixture(["failed"]) }));
  const job = jobFixture("failed");
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}`, route => route.fulfill({ json: job }));
  await page.goto("/cases/1/stenosis");
  await page.getByRole("link", { name: "Inspect analysis 00000001" }).click();
  await expect(page.getByRole("heading", { name: "Selected analysis" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Selected analysis" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(2);
});

test("provider-unavailable submission never inserts a queued or completed record", async ({ page }) => {
  await setup(page, { available: true });
  await page.route("**/api/v1/cases/1/stenosis/analyses", route => route.fulfill({ status: 409, json: { detail: { contract_version: "1.0", code: "capability_unavailable", capability_id: "stenosis_detection", message: "No verified provider is registered." } } }));
  await page.goto("/cases/1/stenosis");
  await page.getByLabel("Source segmentation").selectOption(parentId);
  await page.getByRole("button", { name: "Start stenosis analysis" }).click();
  await expect(page.getByRole("alert")).toContainText("No verified provider is registered.");
  await expect(page.getByText("No analyses have been performed for this case.")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
});

test("accepted request disables duplicates and reuses its key after navigation", async ({ page }) => {
  await setup(page, { available: true });
  let record = null, release; const keys = [];
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => route.fulfill({ json: record ? { ...historyFixture(), items: [record], total: 1 } : historyFixture() }));
  await page.route("**/api/v1/cases/1/stenosis/analyses", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    expect(route.request().headers().authorization).toBe("Bearer browser-test-token");
    expect(route.request().postDataJSON()).toEqual({ contract_version: "1.0", source: sourceFixture });
    await gate; record = jobFixture();
    await route.fulfill({ status: keys.length === 1 ? 202 : 200, json: record });
  });
  await page.goto("/cases/1/stenosis");
  await page.getByLabel("Source segmentation").selectOption(parentId);
  await page.getByRole("button", { name: "Start stenosis analysis" }).click();
  await expect(page.getByRole("button", { name: "Submitting request…" })).toBeDisabled();
  expect(keys).toHaveLength(1); release();
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  await page.goto("/cases/1"); await page.goto("/cases/1/stenosis");
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  await page.getByLabel("Source segmentation").selectOption(parentId);
  await page.getByRole("button", { name: "Start stenosis analysis" }).click();
  await expect.poll(() => keys.length).toBe(2); expect(keys[1]).toBe(keys[0]);
});

test("navigation stops active polling and history is recovered on return", async ({ page }) => {
  await page.clock.install(); await setup(page); let reads = 0;
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => { reads++; return route.fulfill({ json: historyFixture(["running"]) }); });
  await page.goto("/cases/1/stenosis"); await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.goto("/cases/1"); const oldReads = reads;
  await page.clock.fastForward(30000); expect(reads).toBe(oldReads);
  await page.goto("/cases/1/stenosis"); await expect(page.getByText("Running", { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(oldReads);
});

test("history authentication failure uses existing session expiry handling", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => route.fulfill({ status: 401, json: { detail: "Expired token" } }));
  await page.goto("/cases/1/stenosis"); await expect(page).toHaveURL(/\/login$/);
});

test("mobile job history remains accessible and excludes medical measurements", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page);
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => route.fulfill({ json: historyFixture(["failed"]) }));
  await page.goto("/cases/1/stenosis"); await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
  await expect(page.getByText(/\d+% narrowing|no stenosis detected|clinical confidence/i)).toHaveCount(0);
});

test("unavailable request storage fails before submission", async ({ page }) => {
  await setup(page, { available: true });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("vascuai_stenosis_request_")) throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  let posts = 0;
  await page.route("**/api/v1/cases/1/stenosis/analyses", route => { posts++; return route.abort(); });
  await page.goto("/cases/1/stenosis");
  await page.getByLabel("Source segmentation").selectOption(parentId);
  await page.getByRole("button", { name: "Start stenosis analysis" }).click();
  await expect(page.getByRole("alert")).toContainText("No analysis request was sent.");
  expect(posts).toBe(0);
});

test("a lost acceptance response recovers history and retains the original key", async ({ page }) => {
  await setup(page, { available: true });
  let record = null; const keys = [];
  await page.route("**/api/v1/cases/1/stenosis/analyses?**", route => route.fulfill({ json: record ? { ...historyFixture(), items: [record], total: 1 } : historyFixture() }));
  await page.route("**/api/v1/cases/1/stenosis/analyses", route => {
    keys.push(route.request().headers()["idempotency-key"]); record = jobFixture();
    return keys.length === 1 ? route.abort("failed") : route.fulfill({ status: 200, json: record });
  });
  await page.goto("/cases/1/stenosis");
  await page.getByLabel("Source segmentation").selectOption(parentId);
  await page.getByRole("button", { name: "Start stenosis analysis" }).click();
  await expect(page.getByRole("alert")).toContainText("no new acceptance is assumed");
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start stenosis analysis" }).click();
  await expect.poll(() => keys.length).toBe(2); expect(keys[1]).toBe(keys[0]);
  await expect(page.getByRole("status").filter({ hasText: /Server record/ })).toBeVisible();
});
