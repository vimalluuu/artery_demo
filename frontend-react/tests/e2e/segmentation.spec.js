import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installApi } from "./fixtures";
import { CLINICAL_WRITERS, CASE_READERS } from "../../src/constants/permissions.js";

const id = "12345678-1234-4567-890a-123456789abc";
const result = (stale = false) => ({
  id, case_id: 1, created_at: "2026-10-17T10:00:00Z", stale,
  metadata: { threshold: .7, architecture: "SmallUNet3D", checkpoint_step: 700, shape: [512, 512, 217], patch_size: [64, 64, 64], stride: 32, duration_seconds: 190.3, source_sha256: "a".repeat(64), checkpoint_sha256: "b".repeat(64) },
  mask_url: "https://untrusted.example.test/mask", probabilities_url: "https://untrusted.example.test/probabilities",
});

async function segmentationRoutes(page, { results = [], listStatus = 200, runStatus = 201, runDetail = "Run failed", gated = false, downloadStatus = 200 } = {}) {
  let records = results;
  let getCount = 0, postCount = 0;
  const calls = [];
  let release;
  const gate = gated ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  await page.route("**/api/v1/cases/*/segmentations**", async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), url: request.url(), auth: request.headers().authorization, body: request.postData() });
    if (request.method() === "POST") {
      postCount++;
      await gate;
      if (runStatus !== 201) return route.fulfill({ status: runStatus, json: { detail: runDetail } });
      records = [result(), ...records];
      // The POST response deliberately differs; the UI must fetch GET history.
      return route.fulfill({ status: 201, json: { ...result(), metadata: { threshold: .42 } } });
    }
    if (/\/(mask|probabilities)$/.test(new URL(request.url()).pathname)) {
      if (downloadStatus !== 200) return route.fulfill({ status: downloadStatus, json: { detail: "Artifact access failed" } });
      return route.fulfill({ status: 200, contentType: "application/gzip", body: Buffer.from([31, 139, 8, 0]) });
    }
    getCount++;
    return route.fulfill({ status: listStatus, json: listStatus === 200 ? records : { detail: "History unavailable for this account" } });
  });
  return { calls, release: () => release?.(), counts: () => ({ getCount, postCount }), replace: (items) => { records = items; } };
}

for (const role of CASE_READERS) {
  test(`${role} sees permitted segmentation actions`, async ({ page }) => {
    await installApi(page, { role });
    await segmentationRoutes(page, { results: [result()] });
    await page.goto("/cases/1/analysis");
    await expect(page.getByRole("heading", { name: "Segmentation history" })).toBeVisible();
    const button = page.getByRole("button", { name: "Run segmentation", exact: true });
    if (CLINICAL_WRITERS.includes(role)) await expect(button).toBeEnabled();
    else { await expect(button).toHaveCount(0); await expect(page.getByText(/Only Clinician and Admin accounts/)).toBeVisible(); }
    await expect(page.getByRole("button", { name: `Download mask for run ${id}` })).toBeEnabled();
  });
}

test("submits once, shows honest loading, and reloads authoritative history", async ({ page }) => {
  await installApi(page, { role: "Clinician" });
  const fixture = await segmentationRoutes(page, { gated: true });
  await page.goto("/cases/1/analysis");
  await expect(page.getByRole("heading", { name: "No segmentation runs recorded" })).toBeVisible();
  await expect(page.getByLabel("Segmentation threshold")).toHaveValue("0.70");
  await page.getByRole("button", { name: "Run segmentation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Segmentation running…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "synchronous request" })).toBeVisible();
  await expect(page.getByLabel("Segmentation threshold")).toBeDisabled();
  expect(fixture.counts().postCount).toBe(1);
  expect(JSON.parse(fixture.calls.find((call) => call.method === "POST").body)).toEqual({ threshold: .7 });
  fixture.release();
  await expect(page.getByText("Segmentation completed and saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: `Segmentation ${id}` })).toBeVisible();
  await expect(page.getByText("0.7", { exact: true })).toBeVisible();
  await expect(page.getByText("0.42", { exact: true })).toHaveCount(0);
  expect(fixture.counts().getCount).toBeGreaterThanOrEqual(2);
});

test("validates threshold boundaries without submitting invalid values", async ({ page }) => {
  await installApi(page);
  const fixture = await segmentationRoutes(page, { runStatus: 503, runDetail: "Busy worker" });
  await page.goto("/cases/1/analysis");
  const input = page.getByLabel("Segmentation threshold");
  const run = page.getByRole("button", { name: "Run segmentation", exact: true });
  await expect(run).toBeEnabled();
  for (const value of ["", "-0.1", "1.01"]) {
    await input.fill(value);
    await run.click();
    await expect(page.getByRole("alert")).toHaveText("Enter a threshold between 0 and 1.");
  }
  expect(fixture.counts().postCount).toBe(0);
  for (const value of ["0", "1"]) {
    await input.fill(value);
    const response = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/segmentations"));
    await run.click();
    await response;
    await expect(page.getByRole("alert")).toContainText("Busy worker");
  }
  expect(fixture.calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body).threshold)).toEqual([0, 1]);
});

for (const [status, detail, explanation] of [[409, "Volume changed", "Refresh case inputs"], [503, "Worker is busy", "retry after the active run"], [500, "Inference failed", "may still finish"]]) {
  test(`run failure ${status} shows server detail and retry guidance`, async ({ page }) => {
    await installApi(page);
    await segmentationRoutes(page, { runStatus: status, runDetail: detail });
    await page.goto("/cases/1/analysis");
    await page.getByRole("button", { name: "Run segmentation", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(detail);
    await expect(page.getByRole("alert")).toContainText(explanation);
    await expect(page.getByRole("button", { name: "Run segmentation", exact: true })).toBeEnabled();
    await expect(page.getByText("Segmentation completed and saved.", { exact: true })).toHaveCount(0);
  });
}

test("history refresh renders stale status and disables both downloads", async ({ page }) => {
  await installApi(page);
  const fixture = await segmentationRoutes(page, { results: [result()] });
  await page.goto("/cases/1/analysis");
  await expect(page.getByText("Current input", { exact: true })).toBeVisible();
  fixture.replace([result(true)]);
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(page.getByText("Stale input", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Download mask for run ${id}` })).toBeDisabled();
  await expect(page.getByRole("button", { name: `Download probabilities for run ${id}` })).toBeDisabled();
});

test("both downloads carry bearer authentication and save sensible filenames", async ({ page }) => {
  await installApi(page, { role: "Researcher" });
  const fixture = await segmentationRoutes(page, { results: [result()] });
  await page.goto("/cases/1/analysis");
  for (const artifact of ["mask", "probabilities"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${artifact} for run ${id}` }).click();
    const downloaded = await pending;
    expect(downloaded.suggestedFilename()).toBe(`case-1-segmentation-${id}-${artifact}.nii.gz`);
    expect(fixture.calls.find((call) => call.url.endsWith(`/${artifact}`)).auth).toBe("Bearer browser-test-token");
  }
  expect(fixture.calls.every((call) => call.url.startsWith("http://127.0.0.1:5173/api/v1/"))).toBe(true);
});

for (const status of [403, 409, 503]) {
  test(`download error ${status} saves no error file`, async ({ page }) => {
    await installApi(page);
    await segmentationRoutes(page, { results: [result()], downloadStatus: status });
    const downloads = [];
    page.on("download", (value) => downloads.push(value));
    await page.goto("/cases/1/analysis");
    await page.getByRole("button", { name: `Download mask for run ${id}` }).click();
    await expect(page.getByRole("alert")).toContainText("Artifact access failed");
    expect(downloads).toHaveLength(0);
  });
}

test("history inaccessible and failed states offer a retry", async ({ page }) => {
  await installApi(page);
  await segmentationRoutes(page, { listStatus: 403 });
  await page.goto("/cases/1/analysis");
  await expect(page.getByRole("alert")).toContainText("History unavailable for this account");
  await expect(page.getByRole("button", { name: "Run segmentation", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
});

for (const [kind, caseId, message] of [["missing", 3, "Upload a three-dimensional"], ["modality", 1, "This model supports CT only"], ["4D", 1, "4D inference is not supported"]]) {
  test(`ineligible ${kind} input cannot start a run`, async ({ page }) => {
    await installApi(page);
    await segmentationRoutes(page);
    if (kind === "modality") await page.route("**/api/v1/cases/1", (route) => route.fulfill({ json: { id: 1, case_code: "MRA-001", volume_path: "internal.nii.gz", modality: "MRA", patient_id: 1 } }));
    if (kind === "4D") await page.route("**/api/v1/cases/1/volume/metadata", (route) => route.fulfill({ json: { ndim: 4, shape_t: 2 } }));
    await page.goto(`/cases/${caseId}/analysis`);
    await expect(page.getByText(new RegExp(message)).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run segmentation", exact: true })).toBeDisabled();
  });
}

test("segmentation results are accessible and fit desktop and mobile", async ({ page }) => {
  await installApi(page);
  await segmentationRoutes(page, { results: [result(), { ...result(true), id: "87654321-1234-4567-890a-123456789abc" }] });
  await page.goto("/cases/1/analysis");
  await expect(page.getByText("Stale input", { exact: true })).toBeVisible();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations;
    expect(violations, JSON.stringify(violations.map((entry) => ({ id: entry.id, targets: entry.nodes.map((node) => node.target) })))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`segmentation-${viewport.width}.png`), fullPage: true });
  }
});

test("history loading and failure can recover through Retry", async ({ page }) => {
  await installApi(page);
  let release, failed = true;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/v1/cases/1/segmentations", async (route) => {
    await gate;
    return route.fulfill({ status: failed ? 500 : 200, json: failed ? { detail: "History read failed" } : [] });
  });
  await page.goto("/cases/1/analysis");
  await expect(page.getByRole("status").filter({ hasText: "Loading segmentation history" })).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText("History read failed");
  failed = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No segmentation runs recorded" })).toBeVisible();
});

test("a lost run response explains uncertainty and does not invent a saved result", async ({ page }) => {
  await installApi(page);
  await segmentationRoutes(page);
  await page.route("**/api/v1/cases/1/segmentations", (route) => route.request().method() === "POST" ? route.abort("failed") : route.fallback());
  await page.goto("/cases/1/analysis");
  await page.getByRole("button", { name: "Run segmentation", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The server may still finish");
  await expect(page.getByRole("heading", { name: "No segmentation runs recorded" })).toBeVisible();
  await expect(page.getByText("Segmentation completed and saved.", { exact: true })).toHaveCount(0);
});

test("a download 401 clears the expired session without saving a file", async ({ page }) => {
  await installApi(page);
  await segmentationRoutes(page, { results: [result()], downloadStatus: 401 });
  const downloads = [];
  page.on("download", (event) => downloads.push(event));
  await page.goto("/cases/1/analysis");
  await page.getByRole("button", { name: `Download mask for run ${id}` }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("vascuai_token"))).toBe(null);
  expect(downloads).toHaveLength(0);
});
