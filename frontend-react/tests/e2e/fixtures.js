// Browser-only fixtures. All API requests are intercepted; no local or remote
// patient records or accounts are created by these tests.
import {summaryFixture,indexFixture} from '../reporting-fixtures';
export async function installApi(
  page,
  { role = "Admin", authenticated = true } = {},
) {
  let cases = Array.from({ length: 14 }, (_, i) => ({
    id: i + 1,
    patient_id: 1,
    case_code: `CASE-${String(i + 1).padStart(3, "0")}`,
    study_type: "Coronary Artery Analysis",
    status: i === 1 ? "failed" : i === 2 ? "complete" : "pending",
    created_at: `2026-10-${String(16 - i).padStart(2, "0")}T10:00:00Z`,
    image_path: i === 0 ? "images/internal-path.png" : null,
    volume_path: i === 0 ? "volumes/internal-path.nii.gz" : null,
    modality: i % 2 ? "MRA" : "CTA",
    region: "Coronary",
    scan_date: "2026-10-01",
    age_years: 0,
    sex: "F",
    notes: "De-identified test fixture",
  }));
  let patients = [
    {
      id: 1,
      patient_code: "SUB-001",
      display_name: "Research subject 001",
      notes: "Test fixture",
      created_at: "2026-10-01T10:00:00Z",
    },
  ];
  const user = {
    id: 1,
    full_name: "Alex Morgan",
    email: "alex@example.test",
    role,
    is_active: true,
    institution: "Research Lab",
    department: "Imaging",
  };
  const requests = [];
  await page.addInitScript((auth) => {
    if (auth) localStorage.setItem("vascuai_token", "browser-test-token");
  }, authenticated);
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace("/api/v1", ""),
      method = req.method();
    requests.push({
      path,
      method,
      body: method === "POST" || method === "PATCH" ? req.postData() : null,
    });
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === "/auth/me" && method === "GET") return json(user);
    if (path === "/auth/login")
      return json({ access_token: "browser-test-token", user });
    if (path === "/auth/register") return json(user, 201);
    if (path === "/auth/logout") return json({ message: "Signed out" });
    if (path === "/auth/me" && method === "PATCH") {
      Object.assign(user, req.postDataJSON());
      return json(user);
    }
    if (path === "/auth/password")
      return json({ access_token: "new-browser-test-token", user });
    if (path === "/patients" && method === "GET") return json(patients);
    if (path === "/patients" && method === "POST") {
      const item = {
        ...req.postDataJSON(),
        id: patients.length + 1,
        created_at: "2026-10-16T10:00:00Z",
      };
      patients.push(item);
      return json(item, 201);
    }
    if (path === "/cases" && method === "GET") return json(cases);
    if (path === "/cases" && method === "POST") {
      const item = {
        ...req.postDataJSON(),
        id: cases.length + 1,
        status: "pending",
        created_at: "2026-10-16T10:00:00Z",
        image_path: null,
        volume_path: null,
      };
      cases.push(item);
      return json(item, 201);
    }
    const match = path.match(/^\/cases\/(\d+)$/);
    if (match) {
      const item = cases.find((c) => c.id === Number(match[1]));
      if (!item) return json({ detail: "Case not found" }, 404);
      if (method === "PATCH") Object.assign(item, req.postDataJSON());
      return json(item);
    }
    if (path.endsWith("/image/metadata"))
      return path.includes("/1/")
        ? json({
            format: "PNG",
            width: 512,
            height: 512,
            channels: 1,
            pixel_dtype: "uint8",
            file_size_bytes: 1024,
          })
        : json({ detail: "No image" }, 404);
    if (path.endsWith("/volume/metadata"))
      return path.includes("/1/")
        ? json({
            ndim: 3,
            shape_x: 256,
            shape_y: 256,
            shape_z: 128,
            shape_t: null,
            voxel_spacing_x: 0.5,
            voxel_spacing_y: 0.5,
            voxel_spacing_z: 1,
            xyzt_units: 2,
            qform_code: 1,
            sform_code: 1,
            voxel_dtype: "int16",
            nifti_version: 1,
            file_size_bytes: 2048,
            affine: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            uploaded_at: "2026-10-16T10:00:00Z",
          })
        : json({ detail: "No volume" }, 404);
    if (/^\/cases\/\d+\/segmentations$/.test(path) && method === "GET") return json([]);
    if (path === '/stenosis/analytics/summary' || /^\/cases\/\d+\/stenosis\/analytics$/.test(path)) return json(summaryFixture({patientAllowed:['Admin','Clinician'].includes(role),caseId:path.startsWith('/cases/')?Number(path.split('/')[2]):null}));
    if (path === '/stenosis/analytics/analyses') return json(indexFixture());
    if (/^\/cases\/\d+\/stenosis\/analyses$/.test(path) && method === "GET") return json({
      contract_version: "1.0", case_id: Number(path.split("/")[2]), items: [], total: 0,
      limit: 20, offset: 0, has_more: false,
    });
    if (path === "/admin/users") return json([user]);
    if (path === "/admin/audit")
      return json([
        {
          id: 1,
          actor_id: 1,
          action: "case.created",
          resource_id: 1,
          created_at: "2026-10-16T10:00:00Z",
        },
      ]);
    return json({ detail: "Endpoint not supported by browser fixture" }, 404);
  });
  await page.route(/\/health(?:\/ready)?(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        status: route.request().url().endsWith("/ready") ? "ready" : "healthy",
      },
    }),
  );
  return { requests };
}
