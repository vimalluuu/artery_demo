import { sameAffine } from "./volume-geometry.js";

export const MAX_LESIONS = 200;
export const SOURCE_PREFIX = "vascuai-geometry-v1\0RAS\0mm\0nifti_i_j_k\0";
export const isUUID = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-4 + Math.abs(b) * 1e-6;

export function validateGeometry(geometry) {
  if (!geometry || geometry.array_axis_order !== "nifti_i_j_k" || geometry.world_convention !== "RAS" || geometry.world_unit !== "mm"
      || !Array.isArray(geometry.shape) || geometry.shape.length !== 3 || geometry.shape.some(n => !Number.isSafeInteger(n) || n < 1 || n > 0xffffffff)
      || !sameAffine(geometry.affine, geometry.affine) || geometry.affine[3].some((v, i) => v !== (i === 3 ? 1 : 0))) throw new Error("Invalid result source geometry.");
  const [a, b, c] = geometry.affine;
  const determinant = a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
  if (!Number.isFinite(determinant) || determinant === 0) throw new Error("Invalid result affine.");
  return geometry;
}

export async function geometryFingerprint(geometry, sourceHash) {
  validateGeometry(geometry);
  if (!isHash(sourceHash) || !globalThis.crypto?.subtle) throw new Error("Secure geometry verification is unavailable.");
  const prefix = new TextEncoder().encode(SOURCE_PREFIX);
  const bytes = new Uint8Array(prefix.length + 32 + 12 + 128);
  bytes.set(prefix); bytes.set(sourceHash.match(/../g).map(value => parseInt(value, 16)), prefix.length);
  const view = new DataView(bytes.buffer); let offset = prefix.length + 32;
  for (const dim of geometry.shape) { view.setUint32(offset, dim, true); offset += 4; }
  for (const row of geometry.affine) for (const value of row) { view.setFloat64(offset, value === 0 ? 0 : value, true); offset += 8; }
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2, "0")).join("");
}

export function validateLocation(location, geometry) {
  if (location == null) return;
  const indices = location.voxel_indices, world = location.world_coordinates;
  if (location.coordinate_convention !== "array_ijk_and_RAS_mm" || !Array.isArray(indices) || indices.length !== 3
      || indices.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n >= geometry.shape[i])
      || !Array.isArray(world) || world.length !== 3 || world.some(n => !Number.isFinite(n))) throw new Error("Invalid lesion localization.");
  const expected = geometry.affine.slice(0, 3).map(row => row.slice(0, 3).reduce((sum, n, i) => sum + n * indices[i], row[3]));
  if (expected.some((n, i) => !close(n, world[i]))) throw new Error("Lesion voxel/world coordinates disagree.");
  if ((location.slice_axis == null) !== (location.slice_index == null)
      || (location.slice_axis != null && (![0, 1, 2].includes(location.slice_axis) || location.slice_index !== indices[location.slice_axis]))) throw new Error("Invalid original-array slice reference.");
}

export function validateLocalizationBinding(response, geometry, caseId, parentId) {
  const source = response.result.provenance.source, expected = response.result.provenance.geometry;
  if (response.case_id !== Number(caseId) || source.case_id !== Number(caseId) || source.parent_segmentation_result_id !== parentId
      || geometry.shape.some((n, i) => n !== expected.shape[i]) || !sameAffine(geometry.affine, expected.affine)
      || source.source_sha256 !== response.segmentation.metadata.source_sha256) throw new Error("Lesion source or geometry does not match the displayed CT. Markers were not shown.");
  for (const lesion of response.result.lesions) validateLocation(lesion.location, expected);
}

export function matchingLesion(lesions, world, selectedId) {
  const matches = lesions.filter(lesion => lesion.location && lesion.location.world_coordinates.every((n, i) => close(n, world[i])));
  if (matches.some(item => item.lesion_id === selectedId)) return { id: selectedId, ambiguous: matches.length > 1 };
  return { id: matches.length === 1 ? matches[0].lesion_id : null, ambiguous: matches.length > 1 };
}
