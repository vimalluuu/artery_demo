import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installApi } from "./fixtures";

const ids = ["stenosis_detection", "candidate_region_extraction", "stenosis_localization", "vessel_diameter_measurement", "percentage_narrowing", "severity_classification", "explainability", "stenosis_visualization", "stenosis_reporting"];
const payload = () => ({ contract_version: "1.0", capabilities: ids.map(id => ({
  contract_version: "1.0", id, display_name: id.replaceAll("_", " "), status: "unavailable",
  availability_reason: "No verified provider is integrated.", execution_permitted: false,
  method_id: null, method_version: null,
})) });

async function setup(page, role = "Clinician") {
  await installApi(page, { role });
  const calls = [];
  page.on("request", request => { if (request.url().includes("/api/v1/stenosis")) calls.push(request); });
  return calls;
}

for (const role of ["Clinician", "Admin", "Researcher", "DataScientist"]) {
  test(`${role} can inspect capabilities but cannot start analysis`, async ({ page }) => {
    const calls = await setup(page, role);
    await page.route("**/api/v1/stenosis/capabilities", route => route.fulfill({ json: payload() }));
    await page.goto("/cases/1");
    await page.getByRole("link", { name: "Stenosis", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Stenosis analysis", exact: true })).toBeVisible();
    await expect(page.getByText(/Capability information retrieved/)).toBeVisible();
    await expect(page.getByText("No verified provider is integrated.", { exact: true })).toHaveCount(9);
    await expect(page.getByRole("button", { name: "Start stenosis analysis" })).toBeDisabled();
    await expect(page.getByText(/no stenosis|no lesions|0 lesions|confidence score|narrowing: 0/i)).toHaveCount(0);
    expect(calls.every(request => request.method() === "GET" && request.headers().authorization === "Bearer browser-test-token")).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    if (role === "Clinician") await page.screenshot({ path: test.info().outputPath("stenosis-desktop.png") });
    await page.getByRole("link", { name: "Open segmentation workspace" }).click();
    await expect(page).toHaveURL(/\/cases\/1\/analysis$/);
  });
}

test("loading is distinct from a verified capability response", async ({ page }) => {
  await setup(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/v1/stenosis/capabilities", async route => { await gate; await route.fulfill({ json: payload() }); });
  await page.goto("/cases/1/stenosis");
  await expect(page.getByText("Loading stenosis capabilities…")).toBeVisible();
  await expect(page.getByText(/Capability information retrieved/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start stenosis analysis" })).toBeDisabled();
  release();
  await expect(page.getByText(/Capability information retrieved/)).toBeVisible();
});

for (const failure of ["network", "server", "malformed", "version", "forbidden"]) {
  test(`${failure} remains an error and Retry recovers`, async ({ page }) => {
    await setup(page);
    let failed = true;
    await page.route("**/api/v1/stenosis/capabilities", route => {
      if (!failed) return route.fulfill({ json: payload() });
      if (failure === "network") return route.abort("failed");
      if (failure === "server" || failure === "forbidden") return route.fulfill({ status: failure === "server" ? 503 : 403, json: { detail: "Unavailable" } });
      return route.fulfill({ json: failure === "version" ? { ...payload(), contract_version: "2.0" } : { contract_version: "1.0", capabilities: [] } });
    });
    await page.goto("/cases/1/stenosis");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/Capability information retrieved/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start stenosis analysis" })).toBeDisabled();
    failed = false;
    await page.getByRole("button", { name: /Retry/ }).click();
    await expect(page.getByText(/Capability information retrieved/)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("capability 401 uses existing session expiry handling", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/stenosis/capabilities", route => route.fulfill({ status: 401, json: { detail: "Expired token" } }));
  await page.goto("/cases/1/stenosis");
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("vascuai_token"))).toBeNull();
  await expect(page.getByText(/Capability information retrieved/)).toHaveCount(0);
});

test("capability page fits mobile and has accessible controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.route("**/api/v1/stenosis/capabilities", route => route.fulfill({ json: payload() }));
  await page.goto("/cases/1/stenosis");
  await expect(page.getByText(/Capability information retrieved/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("stenosis-mobile.png"), fullPage: true });
});

test("all capability states display without enabling an unimplemented execution route", async ({ page }) => {
  const calls = await setup(page);
  const data = payload();
  data.capabilities[0] = { ...data.capabilities[0], status: "available", execution_permitted: true, method_id: "test-provider", method_version: "v1" };
  data.capabilities[1].status = "not_integrated";
  data.capabilities[2].status = "disabled";
  await page.route("**/api/v1/stenosis/capabilities", route => route.fulfill({ json: data }));
  await page.goto("/cases/1/stenosis");
  await expect(page.getByText(/Capability information retrieved/)).toBeVisible();
  for (const status of ["Available", "Unavailable", "Not integrated", "Disabled"]) {
    await expect(page.locator(".badge").filter({ hasText: new RegExp(`^${status}$`) }).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Start stenosis analysis" })).toBeDisabled();
  expect(calls.every(request => request.method() === "GET")).toBe(true);
});
