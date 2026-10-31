// Explicitly synthetic contract fixtures. Never seeded into application history.
import { geometryFingerprint } from '../src/lib/stenosis-results.js';
import { jobFixture, parentId, sourceFixture } from './stenosis-jobs-fixtures.js';

export const lesionIds = [1, 2, 3].map(i => `1000000${i}-1234-4567-890a-123456789abc`);
export const regionId = '20000001-1234-4567-890a-123456789abc';
export const reasonFixture = { code: 'not_provided', message: 'Synthetic fixture: not supplied by this method' };
export const geometryFixture = { shape: [12,10,8], array_axis_order: 'nifti_i_j_k', world_convention: 'RAS', world_unit: 'mm',
  affine: [[-1,0,0,24],[0,2,0,-13],[0,0,3,42],[0,0,0,1]] };

export function lesionFixture(id, ijk, geometry) {
  return { lesion_id: id, vessel_label: null, vessel_id: null, anatomical_location: null, anatomical_method: null, external_provider_id: null, candidate_region: null,
    location: { coordinate_convention: 'array_ijk_and_RAS_mm', voxel_indices: ijk,
      world_coordinates: geometry.affine.slice(0,3).map(row => row.slice(0,3).reduce((sum, n, i) => sum + n * ijk[i], row[3])), slice_axis: 2, slice_index: ijk[2] },
    localization_unavailable_reason: null, measurements: Object.fromEntries([['reference_diameter','mm'],['minimum_lumen_diameter','mm'],['percentage_narrowing','percent']].map(([field,unit]) => [field, {value:null, unit, unavailable_reason:reasonFixture, method_id:null, method_version:null}])),
    severity: { category:null, unavailable_reason:reasonFixture, method_id:null, method_version:null },
    explanation: { artifact_id:null, unavailable_reason:reasonFixture, method_id:null, method_version:null, explained_target:null, geometry:null, source_sha256:null } };
}

export async function resultFixture({ geometry = structuredClone(geometryFixture), sourceHash = sourceFixture.source_sha256, count = 3 } = {}) {
  const job = jobFixture('completed');
  const source = { ...sourceFixture, source_sha256: sourceHash };
  return { contract_version:'1.0', result_id:'30000001-1234-4567-890a-123456789abc', case_id:1,
    geometry_fingerprint:await geometryFingerprint(geometry, sourceHash), visualization:{status:'supported',reason:'Synthetic axis-aligned geometry; no clinical inference'},
    segmentation:{ id:parentId, case_id:1, stale:false, metadata:{source_sha256:sourceHash,shape:geometry.shape,affine:geometry.affine,xyzt_units:2} },
    result:{ contract_version:'1.0', analysis_id:job.analysis_id, state:'completed', unavailable_reason:null,
      provenance:{...job.provenance,source,geometry}, lesions:lesionIds.slice(0,count).map((id,i) => lesionFixture(id, [i*3+1,i*2+2,3], geometry)) } };
}
