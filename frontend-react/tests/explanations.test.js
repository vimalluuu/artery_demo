import test from 'node:test';
import assert from 'node:assert/strict';
import { createStenosisExplanationsApi, validateExplanations } from '../src/api/stenosis-explanations-contract.js';
import { attributionLegend, attributionBudget, attributionPresentation, attributionPlane, inspectAttribution, validateAttributionBinding, navigateToAttributionSlice } from '../src/lib/attribution.js';
import { prepareAttribution } from '../src/lib/volume-loader.js';
import { resultFixture } from './stenosis-results-fixtures.js';
import { explanationFixture, explanationList, syntheticAttribution } from './explanation-fixtures.js';

const raw=buffer=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
test('valid signed, non-negative and completed-without-explanations metadata',async()=>{
  const root=await resultFixture();
  for(const items of [[],[explanationFixture(root)],[explanationFixture(root),explanationFixture(root,{signed:false,index:1,scope:'lesion',lesionId:root.result.lesions[0].lesion_id})]]) {
    const list=explanationList(root,items);assert.equal(await validateExplanations(list,root),list);
  }
});
for(const kind of ['version','case','result','source','geometry','target','method','model','checkpoint','range','signed','normalization','dtype','lesion','slice','duplicate','missing_reason','baseline'])test(`invalid explanation ${kind} fails closed`,async()=>{
  const root=await resultFixture(),item=explanationFixture(root),list=explanationList(root,[item]);
  if(kind==='version')list.contract_version='2.0';if(kind==='case')list.case_id=2;if(kind==='result')item.result_id=item.artifact_id;
  if(kind==='source')item.source_sha256='f'.repeat(64);if(kind==='geometry')item.geometry.affine[0][3]++;
  if(kind==='target')item.target.prediction_sha256=null;if(kind==='method')item.method_id='fake';if(kind==='model')item.model_version='';
  if(kind==='checkpoint')item.checkpoint_sha256='f'.repeat(64);if(kind==='range')item.values.expected_range=[1,0];if(kind==='signed')item.values.value_type='non_negative';
  if(kind==='normalization')item.values.normalized_for_visualization=true;if(kind==='dtype')item.dtype='uint8';if(kind==='lesion')item.lesion_id=item.artifact_id;
  if(kind==='slice')item.scope='slice';if(kind==='duplicate')list.items.push(item);
  if(kind==='missing_reason'){list.items=[];list.status='not_generated';list.unavailable_reason=null;}
  if(kind==='baseline')item.method_id='integrated_gradients';
  await assert.rejects(validateExplanations(list,root));
});
test('continuous values remain unchanged and are not binary masks',async()=>{
  const root=await resultFixture();
  for(const signed of [false,true]) {
    const item=explanationFixture(root,{signed}),buffer=syntheticAttribution(item),original=Buffer.from(buffer);
    const geometry=inspectAttribution(raw(buffer),item,root.segmentation.metadata);
    assert.deepEqual(geometry.shape,item.shape);assert.deepEqual(buffer,original);
  }
});
for(const kind of ['nan','inf','range','negative','scaling','dtype','slice_leak','affine','truncated'])test(`continuous validation rejects ${kind}`,async()=>{
  const root=await resultFixture(),item=explanationFixture(root,{signed:false,scope:kind==='slice_leak'?'slice':'volume'}),buffer=syntheticAttribution(item);
  if(kind==='nan')buffer.writeFloatLE(NaN,352);if(kind==='inf')buffer.writeFloatLE(Infinity,352);if(kind==='range')buffer.writeFloatLE(2,352);if(kind==='negative')buffer.writeFloatLE(-.1,352);
  if(kind==='scaling')buffer.writeFloatLE(2,112);if(kind==='dtype')buffer.writeInt16LE(2,70);if(kind==='slice_leak')buffer.writeFloatLE(.5,352);if(kind==='affine')buffer.writeFloatLE(99,292);
  assert.throws(()=>inspectAttribution(raw(kind==='truncated'?buffer.subarray(0,360):buffer),item,root.segmentation.metadata));
});
test('slice overlays restrict planes and navigate through verified world geometry',async()=>{
  const root=await resultFixture(),item=explanationFixture(root,{scope:'slice'});
  assert.deepEqual(attributionPlane(item),{axis:2,view:'axial'});
  for(const view of ['slices','coronal','sagittal','mask3d'])assert.equal(attributionPresentation(item,view).allowed,false);
  assert.equal(attributionPresentation(item,'axial').allowed,true);
  const calls=[],viewer={scene:{crosshairPos:[.5,.5,.5]},frac2mm:()=>[23,-9,48,1],mm2frac:(world,idx,force)=>{calls.push([world,idx,force]);return[.2,.3,.4];},drawScene:()=>{},onLocationChange:()=>{}};
  navigateToAttributionSlice(viewer,item,view=>calls.push(view));assert.deepEqual(calls,['axial',[[23,-9,51],0,true]]);
});
test('large additional maps fail before download instead of silent downsampling',()=>{
  assert.throws(()=>attributionBudget([512,512,217]),/memory budget/);
  assert.ok(attributionBudget([12,10,8]));
});
test('asymmetric signed legends place zero at its numeric position, not the midpoint',()=>{
  const legend=attributionLegend({value_type:'signed',expected_range:[-3,1]});
  assert.ok(legend.includes('transparent 75%'));
  assert.ok(attributionLegend({value_type:'non_negative',expected_range:[0,8]}).includes('transparent 0%'));
});
test('binding rejects another result and accepts the exact source',async()=>{
  const root=await resultFixture(),item=explanationFixture(root);
  validateAttributionBinding(item,root,item.geometry,1,root.segmentation.id);
  item.result_id=item.artifact_id;assert.throws(()=>validateAttributionBinding(item,root,item.geometry,1,root.segmentation.id));
});
test('shared authenticated relative routes and protected binary errors',async()=>{
  const root=await resultFixture(),item=explanationFixture(root),list=explanationList(root,[item]),calls=[];
  const signal=new AbortController().signal;
  const api=createStenosisExplanationsApi({get:async(path,config)=>{calls.push({path,config});return{status:200,data:list};}});
  await api.explanations(1,root.result.analysis_id,root,{signal});assert.equal(calls[0].path,`/cases/1/stenosis/analyses/${root.result.analysis_id}/explanations`);assert.equal(calls[0].config.signal,signal);
  const binary=createStenosisExplanationsApi({get:async()=>({status:200,data:new ArrayBuffer(4),headers:{'content-type':'text/html'}})});
  await assert.rejects(binary.explanationArtifact(1,item.analysis_id,item.explanation_id),/bounded attribution/);
  const failure=Object.assign(new Error('HTTP error'),{response:{data:new TextEncoder().encode(JSON.stringify({detail:{contract_version:'1.0',code:'source_changed',message:'Stale source'}})).buffer}});
  await assert.rejects(createStenosisExplanationsApi({get:async()=>{throw failure;}}).explanationArtifact(1,item.analysis_id,item.explanation_id),{code:'source_changed',message:'Stale source'});
});
test('worker cancellation and unmount terminate the attribution decoder',async()=>{
  const original=globalThis.Worker,context=globalThis.isSecureContext;
  const workers=[];globalThis.isSecureContext=true;
  globalThis.Worker=class {constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}};
  try{
    const controller=new AbortController(),promise=prepareAttribution(new ArrayBuffer(4),{}, {},controller.signal);
    controller.abort();await assert.rejects(promise,{name:'AbortError'});assert.equal(workers[0].terminated,true);
    await assert.rejects(prepareAttribution(new ArrayBuffer(4),{},{},controller.signal),{name:'AbortError'});
    await assert.rejects(prepareAttribution(new ArrayBuffer(4),{},{}),/AbortSignal/);
  }finally{globalThis.Worker=original;globalThis.isSecureContext=context;}
});
