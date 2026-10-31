import { readHeader } from 'nifti-reader-js';
import { inspectVolume, validatePair, volumeBudget } from './volume-geometry.js';
import { validateLocalizationBinding } from './stenosis-results.js';

export const MAX_ATTRIBUTION_BYTES = 256 * 1024 ** 2;
export const MAX_ATTRIBUTION_EXPANDED = 384 * 1024 ** 2;
export const attributionMethods = ['grad_cam','integrated_gradients','saliency','feature_attribution','reviewed_other'];

export function attributionBudget(shape, deviceMemory = 8) {
  const budget=volumeBudget(shape,deviceMemory);
  // CT/mask + candidate region + float map, decode and GPU working space.
  if(budget.voxels*48>budget.budgetBytes) throw new Error('This additional attribution overlay exceeds the browser memory budget. Use the protected original artifact in a desktop imaging application.');
  return budget;
}

export function inspectAttribution(buffer, item, metadata) {
  if(buffer.byteLength>MAX_ATTRIBUTION_EXPANDED) throw new Error('Attribution exceeds the uncompressed size limit.');
  const geometry=inspectVolume(buffer);validatePair(geometry,geometry,metadata);
  const header=readHeader(buffer);
  const slope=Number.isFinite(header.scl_slope)&&header.scl_slope!==0 ? header.scl_slope : 1;
  const intercept=Number.isFinite(header.scl_slope)&&header.scl_slope!==0 ? header.scl_inter : 0;
  if(header.datatypeCode!==16 || slope!==1 || intercept!==0) throw new Error('Attribution requires unscaled float32 values, not binary labels or rescaled probabilities.');
  if(geometry.shape.some((n,i)=>n!==item.shape[i])) throw new Error('Attribution dimensions do not match the declared map.');
  const [lo,hi]=item.values.expected_range,tolerance=Math.max(1,Math.abs(lo),Math.abs(hi))*1e-6;
  const voxels=new DataView(buffer,header.vox_offset,geometry.voxels*4);
  const stride=item.scope==='slice' ? geometry.shape.slice(0,item.slice_axis).reduce((a,b)=>a*b,1) : 0;
  for(let index=0;index<geometry.voxels;index++) {
    const value=voxels.getFloat32(index*4,header.littleEndian);
    if(!Number.isFinite(value)||value<lo-tolerance||value>hi+tolerance||(item.values.value_type==='non_negative'&&value<0)) throw new Error('Attribution contains invalid values or values outside its declared range.');
    if(item.scope==='slice'&&Math.floor(index/stride)%geometry.shape[item.slice_axis]!==item.slice_index&&value!==0) throw new Error('Slice attribution contains values outside its declared plane.');
  }
  return geometry;
}

export function validateAttributionBinding(item, root, geometry, caseId, parentId) {
  validateLocalizationBinding(root,geometry,caseId,parentId);
  if(item.result_id!==root.result_id || item.analysis_id!==root.result.analysis_id || item.source_sha256!==root.result.provenance.source.source_sha256
    ||item.geometry_fingerprint!==root.geometry_fingerprint || (item.lesion_id&&!root.result.lesions.some(l=>l.lesion_id===item.lesion_id))) throw new Error('The attribution does not belong to this case, result or source. The CT is retained.');
}

export function attributionPlane(item) {
  const column=item.geometry.affine.slice(0,3).map(row=>row[item.slice_axis]);
  const axis=column.findIndex(v=>Math.abs(v)>.99999*Math.hypot(...column));
  if(axis<0) throw new Error('Unsupported attribution slice geometry.');
  return {axis,view:['sagittal','coronal','axial'][axis]};
}

export function attributionPresentation(item, view) {
  if(view==='mask3d') return {allowed:false,reason:'Attribution is hidden in the artery-mask 3D view.'};
  if(item.scope==='slice'&&view!==attributionPlane(item).view) return {allowed:false,reason:'Slice attribution is visible only in its declared anatomical plane. Use Navigate to explanation slice.'};
  return {allowed:true,reason:''};
}

export function navigateToAttributionSlice(viewer,item,onView) {
  const {axis,view}=attributionPlane(item);
  const world=Array.from(viewer.frac2mm(viewer.scene.crosshairPos)).slice(0,3);
  world[axis]=item.geometry.affine[axis][item.slice_axis]*item.slice_index+item.geometry.affine[axis][3];
  onView(view);viewer.scene.crosshairPos=viewer.mm2frac(world,0,true);viewer.drawScene();viewer.onLocationChange();
}

export function interpretationNote(method) {
  return ({grad_cam:'Grad-CAM is a feature-layer attribution for a specified model target; it is not a lesion boundary.',integrated_gradients:'Integrated Gradients attributes the target relative to the declared baseline; the choice of baseline matters.',saliency:'Saliency describes target-related input gradients and can be sensitive to noise and model behavior.',feature_attribution:'Feature attribution is method-specific; inspect the supplied target and limitations.',reviewed_other:'Interpret this reviewed method using its supplied target, value semantics and limitations.'})[method];
}

export function attributionLegend(values) {
  if(values.value_type==='non_negative')return 'linear-gradient(to right, transparent 0%, rgb(100,35,0) 0.392157%, rgb(255,112,0) 100%)';
  const [lo,hi]=values.expected_range,zero=-lo/(hi-lo)*100;
  return `linear-gradient(to right, rgb(80,100,255) 0%, rgb(25,50,150) ${zero*(254/255)}%, transparent ${zero}%, rgb(100,35,0) ${zero+(100-zero)/255}%, rgb(255,112,0) 100%)`;
}
