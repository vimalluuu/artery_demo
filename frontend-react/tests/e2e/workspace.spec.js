import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installApi } from "./fixtures";
import {
  CASE_READERS,
  CLINICAL_WRITERS,
  RESEARCH_READERS,
  ADMINISTRATORS,
} from "../../src/constants/permissions.js";

test("public pages, sign-in, and registration are accessible", async ({
  page,
}) => {
  await installApi(page, { authenticated: false });
  for (const path of [
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/help",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1,h2").first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ),
    ).toEqual([]);
  }
});
test("sign-in restores the requested protected page", async ({ page }) => {
  await installApi(page, { authenticated: false });
  await page.goto("/cases");
  await expect(page).toHaveURL(/login/);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("alex@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long-test-password");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByText("CASE-001", { exact: true })).toBeVisible();
});
test("all supported workspace screens render without browser errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installApi(page);
  for (const path of [
    "/dashboard",
    "/patients",
    "/patients/new",
    "/patients/1",
    "/cases",
    "/cases/new",
    "/cases/1",
    "/cases/1/imaging",
    "/cases/1/analysis",
    "/cases/1/history",
    "/uploads",
    "/reports",
    "/reports/1",
    "/notifications",
    "/datasets",
    "/models",
    "/models/compare",
    "/evaluation",
    "/experiments",
    "/profile",
    "/settings",
    "/settings/security",
    "/admin/users",
    "/admin/audit-logs",
    "/admin/system-health",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      path,
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});
test("dashboard and case workspace meet automated accessibility checks", async ({
  page,
}) => {
  await installApi(page);
  for (const path of [
    "/dashboard",
    "/patients",
    "/patients/new",
    "/patients/1",
    "/cases",
    "/cases/new",
    "/cases/1",
    "/cases/1/imaging",
    "/cases/1/analysis",
    "/cases/1/history",
    "/uploads",
    "/reports",
    "/reports/1",
    "/notifications",
    "/datasets",
    "/models",
    "/models/compare",
    "/evaluation",
    "/experiments",
    "/profile",
    "/settings",
    "/settings/security",
    "/admin/users",
    "/admin/audit-logs",
    "/admin/system-health",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ),
    ).toEqual([]);
  }
});
test("case search, filters, sorting, and pagination use actual records", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/cases");
  await expect(page.getByText("CASE-001", { exact: true })).toBeVisible();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search cases", exact: true })
    .last()
    .fill("CASE-002");
  await expect(page.getByText("CASE-002", { exact: true })).toBeVisible();
  await expect(page.getByText("CASE-001", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/q=CASE-002/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /^Failed/ }).click();
  await expect(page.getByText("CASE-002", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 0")).toHaveCount(0);
});
test("patient registration and case creation submit validated schema values", async ({
  page,
}) => {
  const { requests } = await installApi(page);
  await page.goto("/patients/new");
  await page.getByLabel("Patient / subject reference").fill("SUB-002");
  await page.getByLabel("Research label").fill("Research subject 002");
  await page.getByRole("button", { name: "Register subject" }).click();
  await expect(page).toHaveURL(/patients\/2$/);
  await page.getByRole("link", { name: "Create case", exact: true }).click();
  await page.getByLabel("Case reference").fill("CASE-015");
  await page.getByLabel("Imaging modality").selectOption("CTA");
  await page.getByLabel("Anatomical region").selectOption("Coronary");
  await page.getByLabel("Age in years").fill("0");
  await page.getByRole("button", { name: "Create case & continue" }).click();
  await expect(page).toHaveURL(/cases\/15$/);
  const created = JSON.parse(
    requests.find((r) => r.path === "/cases" && r.method === "POST").body,
  );
  expect(created.patient_id).toBe(2);
  expect(created.modality).toBe("CTA");
  expect(created.region).toBe("Coronary");
  expect(created.age_years).toBe(0);
});
test("upload validation rejects unsupported files and metadata displays physical units", async ({
  page,
}) => {
  const { requests } = await installApi(page);
  await page.goto("/cases/1");
  await expect(page.getByText("0.5 × 0.5 × 1 mm")).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "scan.dcm",
    mimeType: "application/dicom",
    buffer: Buffer.from("not dicom"),
  });
  await expect(page.getByRole("alert")).toContainText("DICOM is not supported");
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
});
test("case metadata edits are persisted without inventing inference output", async ({
  page,
}) => {
  const { requests } = await installApi(page);
  await page.goto("/cases/1");
  await page.getByRole("button", { name: "Edit case metadata" }).click();
  await page
    .getByLabel("Study notes", { exact: true })
    .fill("Updated research note");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Updated research note", { exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse(requests.find((r) => r.method === "PATCH").body).notes,
  ).toBe("Updated research note");
  await page
    .getByRole("link", { name: "Segmentation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No segmentation runs recorded" }),
  ).toBeVisible();
});
test("JSON exports exclude storage paths and clinical claims", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/reports/1");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "JSON", exact: true }).click(),
  ]);
  const fs = await import("node:fs/promises");
  const content = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  expect(content.analysis_available).toBe(false);
  expect(content.cases[0].case_reference).toBe("CASE-001");
  expect(JSON.stringify(content)).not.toContain("internal-path");
  expect(content.cases[0]).not.toHaveProperty("severity");
});
test("research roles cannot access writer or admin routes", async ({
  page,
}) => {
  await installApi(page, { role: "Researcher" });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "New case", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Patients", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Model evaluation", exact: true }),
  ).toBeVisible();
  for (const path of ["/patients", "/cases/new", "/admin/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/403$/);
  }
  await page.goto("/cases/1");
  await expect(
    page.getByText("Your role can inspect study metadata."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload & validate" }),
  ).toHaveCount(0);
});
test("mobile screens fit and navigation opens and closes", async ({ page }) => {
  await installApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/",
    "/dashboard",
    "/cases",
    "/cases/new",
    "/cases/1",
    "/patients",
    "/reports/1",
    "/profile",
    "/admin/users",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      path,
    ).toBeTruthy();
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/menu-open/);
  await page.getByRole("link", { name: "Cases", exact: true }).click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/menu-open/);
});

for (const role of CASE_READERS) {
  test(`${role} navigation and route permissions match the verified policy`, async ({
    page,
  }) => {
    await installApi(page, { role });
    await page.goto("/cases");
    await expect(
      page.getByRole("link", { name: "New case", exact: true }),
    ).toHaveCount(CLINICAL_WRITERS.includes(role) ? 1 : 0);
    await page.goto("/patients");
    if (CLINICAL_WRITERS.includes(role))
      await expect(page.locator("h1")).toHaveText("People behind the studies.");
    else await expect(page).toHaveURL(/403$/);
    await page.goto("/datasets");
    if (RESEARCH_READERS.includes(role))
      await expect(page.locator("h1")).toHaveText("A source for every study.");
    else await expect(page).toHaveURL(/403$/);
    await page.goto("/admin/users");
    if (ADMINISTRATORS.includes(role))
      await expect(page.locator("h1")).toHaveText("User Management");
    else await expect(page).toHaveURL(/403$/);
  });
}

test("health checks never forward the authenticated session token", async ({
  page,
}) => {
  await installApi(page);
  const probes = [];
  await page.route(/\/health(?:\/ready)?(?:\?.*)?$/, (route) => {
    probes.push(route.request().headers());
    return route.fulfill({
      json: {
        status: route.request().url().endsWith("/ready") ? "ready" : "healthy",
      },
    });
  });
  await page.goto("/admin/system-health");
  await expect(page.getByText("Available", { exact: true })).toHaveCount(2);
  expect(probes.length).toBeGreaterThanOrEqual(2);
  expect(probes.every((headers) => !headers.authorization)).toBe(true);
});
