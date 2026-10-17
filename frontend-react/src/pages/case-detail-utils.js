export const EDITABLE_CASE_ROLES = ["Clinician", "Administrator", "Admin"];

export function canEditCaseMetadata(role) {
  return EDITABLE_CASE_ROLES.includes(role);
}

export function createCaseMetadataForm(item) {
  return {
    studyType: item.studyType || "",
    modality: item.modality || "",
    region: item.region || "",
    scanDate: item.scanDate || "",
    age: item.age ?? "",
    gender: item.gender || "",
    notes: item.notes || "",
  };
}

export function validateCaseMetadata(form) {
  if (form.age !== "" && form.age != null) {
    const age = Number(form.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      return "Age must be a whole number between 0 and 120.";
    }
  }
  return "";
}
