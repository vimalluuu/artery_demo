// Automated fixtures only. Never registered in development/application history.
import { syntheticNifti } from './e2e/nifti-fixture.js';
export const explanationIds=['40000001-1234-4567-890a-123456789abc','40000002-1234-4567-890a-123456789abc'];
export function explanationFixture(root,{signed=true,index=0,scope='volume',lesionId=null}={}) {
  return {contract_version:'1.0',explanation_id:explanationIds[index],artifact_id:`5000000${index+1}-1234-4567-890a-123456789abc`,result_id:root.result_id,analysis_id:root.result.analysis_id,lesion_id:lesionId,
    method_id:signed?'saliency':'grad_cam',method_name:signed?'Synthetic signed gradients':'Synthetic non-negative activation',method_version:'test-v1',explanation_type:'attribution',
    target:{identifier:`synthetic-target-${index+1}`,description:'Synthetic target, not a patient prediction',prediction_sha256:'c'.repeat(64)},model_id:'test-model',model_version:'test-v1',checkpoint_sha256:null,
    scope,slice_axis:scope==='slice'?2:null,slice_index:scope==='slice'?3:null,values:{value_type:signed?'signed':'non_negative',expected_range:signed?[-1,1]:[0,1],normalization:'none',normalized_for_visualization:false,normalization_description:null,baseline:null},
    source_sha256:root.result.provenance.source.source_sha256,geometry_fingerprint:root.geometry_fingerprint,geometry:structuredClone(root.result.provenance.geometry),visualization:root.visualization,
    format:'nii.gz',content_sha256:'d'.repeat(64),shape:root.result.provenance.geometry.shape,dtype:'float32',created_at:'2026-10-31T00:00:00Z',limitations:'Synthetic test fixture. No clinical conclusions.'};
}
export function explanationList(root,items=[]) {
  return {contract_version:'1.0',case_id:root.case_id,result_id:root.result_id,analysis_id:root.result.analysis_id,status:items.length?(root.visualization.status==='supported'?'available':'unsupported_geometry'):'not_generated',
    unavailable_reason:items.length?null:{code:'not_provided',message:'No explanation was generated for this completed result. This says nothing about feature importance.'},items};
}
export function syntheticAttribution(item) {
  const [nx,ny,nz]=item.shape;
  const buffer=Buffer.alloc(352+nx*ny*nz*4);
  syntheticNifti({affine:item.geometry.affine,shape:item.shape}).copy(buffer,0,0,352);
  buffer.writeInt16LE(16,70);buffer.writeInt16LE(32,72);
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const value=item.scope==='slice'&&[i,j,k][item.slice_axis]!==item.slice_index?0:item.values.value_type==='signed'?(i<nx/2?-.8:.8):.2+.7*i/(nx-1);
    buffer.writeFloatLE(value,352+4*(i+nx*(j+ny*k)));
  }
  return buffer;
}
