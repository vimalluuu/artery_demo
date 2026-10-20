import { isNIFTI, readHeader } from 'nifti-reader-js';

export const MAX_VIEWER_VOXELS = 67_108_864;
export const MAX_TRANSFER_BYTES = 512 * 1024 * 1024;
const BYTES = { 2: 1, 4: 2, 8: 4, 16: 4, 64: 8, 256: 1, 512: 2, 768: 4 };
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-4 + Math.abs(b) * 1e-6;

export function volumeBudget(shape, deviceMemory = 8) {
  if (!Array.isArray(shape) || shape.length !== 3 || shape.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('A recorded three-dimensional volume is required.');
  const voxels = shape.reduce((a, b) => a * b, 1);
  // Conservative CPU + GPU working-set estimate, not a memory availability API.
  const estimatedBytes = voxels * 26;
  const budgetBytes = (deviceMemory <= 4 ? 768 : 1536) * 1024 ** 2;
  if (voxels > MAX_VIEWER_VOXELS || estimatedBytes > budgetBytes) throw new Error('This volume exceeds the browser viewer memory budget. Use authenticated downloads in a desktop imaging application.');
  return { voxels, estimatedBytes, budgetBytes };
}

export function sameAffine(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4 &&
    a.every((row, i) => Array.isArray(row) && row.length === 4 && Array.isArray(b[i]) && b[i].length === 4 && row.every((v, j) => close(v, b[i][j])));
}

export function inspectVolume(buffer, { mask = false } = {}) {
  if (!(buffer instanceof ArrayBuffer) || !isNIFTI(buffer)) throw new Error('The server did not return a supported single-file NIfTI volume.');
  const header = readHeader(buffer);
  const shape = header.dims.slice(1, 4);
  if (header.dims[0] !== 3) throw new Error('Only three-dimensional volumes can be viewed.');
  const { voxels } = volumeBudget(shape);
  const bytes = BYTES[header.datatypeCode];
  if (!bytes || header.numBitsPerVoxel !== bytes * 8) throw new Error('Unsupported NIfTI voxel type.');
  const offset = header.vox_offset;
  if (!Number.isSafeInteger(offset) || offset < 352 || offset + voxels * bytes > buffer.byteLength) throw new Error('The NIfTI voxel payload is incomplete.');
  const units = header.xyzt_units & 7;
  if (units !== 2) throw new Error(`Spatial units are ${units === 0 ? 'unknown' : 'not millimetres'}. This viewer currently requires explicit millimetre geometry; use the original downloads instead.`);
  if (!(header.sform_code > 0 || header.qform_code > 0)) throw new Error('No coded spatial transform is available. Refusing to guess image orientation.');
  // Match nibabel get_best_affine(): sform takes precedence regardless of code magnitude.
  // nifti-reader-js also replaces hdr.affine when qform_code is larger. Read
  // the original srow fields directly so that code magnitude cannot change it.
  const rawHeader = new DataView(buffer);
  const version2 = rawHeader.getInt32(0, header.littleEndian) === 540;
  const affine = header.sform_code > 0 ? [0, 1, 2].map(row => [0, 1, 2, 3].map(column =>
    version2 ? rawHeader.getFloat64(400 + row * 32 + column * 8, header.littleEndian) : rawHeader.getFloat32(280 + row * 16 + column * 4, header.littleEndian)
  )).concat([[0, 0, 0, 1]]) : header.getQformMat();
  if (!sameAffine(affine, affine) || !affine[3].every((v, i) => close(v, i === 3 ? 1 : 0))) throw new Error('Invalid spatial transform.');
  const used = new Set();
  const spacing = [];
  for (let column = 0; column < 3; column++) {
    const components = affine.slice(0, 3).map(row => row[column]);
    const length = Math.hypot(...components);
    const axis = components.findIndex(value => Math.abs(value) > length * .99999);
    // Deliberately bounded first version: flipped/permuted orthogonal axes.
    if (!(length > 0) || axis < 0 || used.has(axis) || components.some((v, i) => i !== axis && Math.abs(v) > 1e-5)) throw new Error('Oblique or sheared geometry is not supported by this viewer version. Use a desktop imaging application.');
    used.add(axis);
    spacing.push(length);
    if (!close(Math.abs(header.pixDims[column + 1]), length)) throw new Error('NIfTI spacing conflicts with its affine transform.');
  }
  const slope = !Number.isFinite(header.scl_slope) || header.scl_slope === 0 ? 1 : header.scl_slope;
  const intercept = !Number.isFinite(header.scl_slope) || header.scl_slope === 0 ? 0 : header.scl_inter;
  if (!Number.isFinite(intercept)) throw new Error('Invalid NIfTI intensity scaling.');
  const data = new DataView(buffer, offset, voxels * bytes);
  if (mask) {
    if (header.datatypeCode !== 2 || slope !== 1 || intercept !== 0) throw new Error('The segmentation must be an unscaled binary uint8 mask.');
    const values = new Uint8Array(buffer, offset, voxels);
    if (values.some(v => v !== 0 && v !== 1)) throw new Error('The segmentation contains values other than binary 0 and 1.');
  } else if ([16, 64].includes(header.datatypeCode)) {
    for (let i = 0; i < voxels; i++) {
      const value = bytes === 4 ? data.getFloat32(i * bytes, header.littleEndian) : data.getFloat64(i * bytes, header.littleEndian);
      if (!Number.isFinite(value) || !Number.isFinite(value * slope + intercept)) throw new Error('The CT contains non-finite intensities.');
    }
  }
  return { shape, affine, spacing, units: 'mm', voxels, bytes, sformCode: header.sform_code, qformCode: header.qform_code };
}

export function validatePair(ct, mask, metadata) {
  if (ct.shape.some((n, i) => n !== mask.shape[i]) || !sameAffine(ct.affine, mask.affine)) throw new Error('CT and mask geometry do not match. The overlay was not displayed.');
  if (!metadata || ct.shape.some((n, i) => n !== metadata.shape?.[i]) || !sameAffine(ct.affine, metadata.affine) || (metadata.xyzt_units & 7) !== 2) throw new Error('The downloaded CT geometry does not match the selected segmentation provenance.');
  return ct;
}
