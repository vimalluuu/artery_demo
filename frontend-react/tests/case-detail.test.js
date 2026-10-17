import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditCaseMetadata,
  createCaseMetadataForm,
  validateCaseMetadata,
} from "../src/pages/case-detail-utils.js";

test("only clinical writers can edit case metadata", () => {
  assert.equal(canEditCaseMetadata("Clinician"), true);
  assert.equal(canEditCaseMetadata("Administrator"), true);
  assert.equal(canEditCaseMetadata("Admin"), true);
  assert.equal(canEditCaseMetadata("Researcher"), false);
  assert.equal(canEditCaseMetadata("DataScientist"), false);
  assert.equal(canEditCaseMetadata(undefined), false);
});

test("edit form is prefilled and safely normalizes missing metadata", () => {
  assert.deepEqual(
    createCaseMetadataForm({
      studyType: null,
      modality: null,
      region: undefined,
      scanDate: null,
      age: null,
      gender: null,
      notes: null,
    }),
    {
      studyType: "",
      modality: "",
      region: "",
      scanDate: "",
      age: "",
      gender: "",
      notes: "",
    },
  );
});

test("metadata validation rejects negative and out-of-range ages", () => {
  assert.match(validateCaseMetadata({ age: "-1" }), /between 0 and 120/);
  assert.match(validateCaseMetadata({ age: "121" }), /between 0 and 120/);
  assert.equal(validateCaseMetadata({ age: "58" }), "");
  assert.equal(validateCaseMetadata({ age: "" }), "");
});
