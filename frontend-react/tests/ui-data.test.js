import test from "node:test";
import assert from "node:assert/strict";
import { validateUpload } from "../src/lib/uploads.js";
import { caseRecord, csvCell, serializeCsv } from "../src/lib/exports.js";
import { createCasesApi } from "../src/api/cases-contract.js";

test("upload validation preserves volume-specific size limits and rejects unsupported inputs", () => {
  assert.equal(
    validateUpload({ name: "scan.nii", size: 700 * 1024 * 1024 }, "volume"),
    "",
  );
  assert.match(
    validateUpload({ name: "scan.nii.gz", size: 700 * 1024 * 1024 }, "volume"),
    /512/,
  );
  assert.match(
    validateUpload({ name: "scan.dcm", size: 100 }, "volume"),
    /DICOM/,
  );
  assert.match(
    validateUpload({ name: "scan.png", size: 21 * 1024 * 1024 }, "image"),
    /20 MB/,
  );
  assert.match(
    validateUpload({ name: "scan.nii", size: 0 }, "volume"),
    /empty/,
  );
});
test("exports allowlist persisted case metadata and preserve zero age", () => {
  const record = caseRecord({
    id: 1,
    caseCode: "CASE-1",
    age: 0,
    volumePath: "private/storage",
    severity: 70,
    confidence: 0.9,
  });
  assert.equal(record.age_years, 0);
  assert.equal(record.case_reference, "CASE-1");
  assert.ok(!("volumePath" in record));
  assert.ok(!("severity" in record));
  assert.ok(!("confidence" in record));
});
test("CSV exports escape quotes, preserve rows, and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell(" @SUM(1)"), '"\' @SUM(1)"');
  assert.equal(
    serializeCsv([{ id: 1, note: "line 1\nline 2" }]),
    '"id","note"\r\n"1","line 1\nline 2"',
  );
});

test("both upload paths preserve cancellation and report actual transfer progress", async () => {
  for (const method of ["upload", "uploadVolume"]) {
    const controller = new AbortController();
    let reported = null;
    const client = createCasesApi({
      post: async (path, body, config) => {
        assert.equal(config.signal, controller.signal);
        config.onUploadProgress({ loaded: 25, total: 100 });
        assert.equal(reported, 25);
        controller.abort();
        assert.equal(config.signal.aborted, true);
        return { data: { id: 1, status: "pending" } };
      },
    });
    await client[method](
      1,
      new FormData(),
      (percent) => {
        reported = percent;
      },
      controller.signal,
    );
  }
});
