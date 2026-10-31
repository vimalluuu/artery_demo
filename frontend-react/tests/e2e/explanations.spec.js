import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {installApi} from './fixtures';
import {syntheticNifti} from './nifti-fixture';
import {capabilitiesFixture,historyFixture,jobFixture} from '../stenosis-jobs-fixtures';
import {resultFixture,lesionIds} from '../stenosis-results-fixtures';
import {explanationFixture,explanationList,explanationIds,syntheticAttribution} from '../explanation-fixtures';

async function setup(page,options={}) {
  await installApi(page,{role:'Researcher'});
  const root=await resultFixture();
  if(options.permuted){root.result.provenance.geometry.affine=[[0,0,3,24],[-1,0,0,-13],[0,-2,0,42],[0,0,0,1]];
    const {geometryFingerprint}=await import('../../src/lib/stenosis-results');
    root.segmentation.metadata.affine=root.result.provenance.geometry.affine;
    for(const lesion of root.result.lesions)lesion.location.world_coordinates=root.result.provenance.geometry.affine.slice(0,3).map(row=>row.slice(0,3).reduce((s,n,i)=>s+n*lesion.location.voxel_indices[i],row[3]));
    root.geometry_fingerprint=await geometryFingerprint(root.result.provenance.geometry,root.result.provenance.source.source_sha256);
  }
  const ct=gzipSync(syntheticNifti({affine:root.result.provenance.geometry.affine})),mask=gzipSync(syntheticNifti({affine:root.result.provenance.geometry.affine,mask:true}));
  root.result.provenance.source.source_sha256=createHash('sha256').update(ct).digest('hex');root.segmentation.metadata.source_sha256=root.result.provenance.source.source_sha256;
  const {geometryFingerprint}=await import('../../src/lib/stenosis-results');root.geometry_fingerprint=await geometryFingerprint(root.result.provenance.geometry,root.result.provenance.source.source_sha256);
  if(options.unsupported)root.visualization={status:'unsupported_geometry',reason:'Synthetic unsupported source geometry; protected artifacts remain available.'};
  const job=jobFixture('completed');job.provenance=structuredClone(root.result.provenance);job.result_reference=root.result_id;
  const items=options.empty?[]:[explanationFixture(root,{scope:options.slice?'slice':'volume'}),explanationFixture(root,{signed:false,index:1,scope:'lesion',lesionId:lesionIds[0]})];
  const bytes=items.map(item=>{
    const raw=syntheticAttribution(item);
    if(options.badGeometry&&item===items[0])raw.writeFloatLE(999,292);
    const buffer=gzipSync(raw);item.content_sha256=createHash('sha256').update(buffer).digest('hex');return buffer;
  });
  if(options.badSource&&items.length)items[0].source_sha256='f'.repeat(64);
  const calls=[];let release;const gate=options.slow?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  await page.route('**/api/v1/stenosis/capabilities',route=>route.fulfill({json:capabilitiesFixture()}));
  await page.route('**/api/v1/cases/1/stenosis/analyses?**',route=>route.fulfill({json:{...historyFixture(),items:[job],total:1}}));
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}`,route=>route.fulfill({json:job}));
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}/result`,route=>route.fulfill({json:root}));
  await page.route('**/api/v1/cases/1/segmentations**',route=>{const path=new URL(route.request().url()).pathname;calls.push({path,auth:route.request().headers().authorization});return path.endsWith('/segmentations')?route.fulfill({json:[root.segmentation]}):route.fulfill({contentType:'application/gzip',body:path.endsWith('/source')?ct:mask});});
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}/explanations`,route=>{
    calls.push({path:'metadata',auth:route.request().headers().authorization});
    return route.fulfill({status:options.metadataStatus||200,json:options.metadataStatus?{detail:{contract_version:'1.0',code:'explanation_provider_unavailable',message:'Explanation metadata is unavailable.'}}:explanationList(root,items)});
  });
  await page.route('**/api/v1/cases/1/stenosis/analyses/*/explanations/*/artifact',async route=>{
    const path=new URL(route.request().url()).pathname;calls.push({path,auth:route.request().headers().authorization});
    const index=items.findIndex(item=>path.includes(item.explanation_id));if(options.slow&&index===0)await gate;
    if(options.artifactStatus)return route.fulfill({status:options.artifactStatus,json:{detail:{contract_version:'1.0',code:'artifact_unavailable',message:'Attribution artifact is unavailable.'}}});
    return route.fulfill({contentType:'application/gzip',body:options.badHash?Buffer.from('changed bytes'):bytes[index]});
  });
  return {root,items,calls,url:`/cases/1/stenosis?analysis=${job.analysis_id}`,release:()=>release?.()};
}

async function open(page,fixture) {
  await page.goto(fixture.url);
  await expect(page.getByLabel('Explanation method and target')).toBeVisible();
  await page.getByLabel('Explanation method and target').selectOption(explanationIds[0]);
  await page.getByRole('button',{name:'View candidates on CT',exact:true}).click();
  await expect(page.getByText(/Voxel spacing \(original axes\)/)).toBeVisible({timeout:30000});
}
const canvas=page=>page.getByRole('img',{name:/CT slices/});
// Sticky application chrome can cover the canvas after scrolling to controls.
// Hide only that chrome during capture; retain exact CT/overlay pixel equality.
const canvasImage=(page,options={})=>canvas(page).screenshot({...options,style:'.topbar, .skip-link { visibility: hidden !important; }'});
const artifactCalls=fixture=>fixture.calls.filter(c=>c.path.endsWith('/artifact'));

test('no explanation generated is explicit and never a zero-valued map',async({page})=>{
  const fixture=await setup(page,{empty:true});await page.goto(fixture.url);
  await expect(page.getByText(/No explanation was generated for this completed result/)).toBeVisible();
  await expect(page.getByLabel('Show attribution overlay')).toHaveCount(0);expect(artifactCalls(fixture)).toHaveLength(0);
});

test('signed and non-negative continuous overlays use distinct legends and independent controls',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const fixture=await setup(page);await open(page,fixture);
  await expect(page.getByLabel('Show attribution overlay')).not.toBeChecked();
  const original=await canvasImage(page,{path:test.info().outputPath('attribution-before.png')});
  await page.getByLabel('Show attribution overlay').check();
  await expect.poll(async()=>!(await canvasImage(page)).equals(original)).toBe(true);
  await expect(page.getByRole('img',{name:/Signed attribution: blue negative/})).toBeVisible();
  await page.getByRole('slider',{name:'Attribution opacity',exact:true}).fill('0.7');
  await expect(page.getByText('70%',{exact:true})).toBeVisible();
  await page.getByLabel('Show attribution overlay').uncheck();
  await canvasImage(page,{path:test.info().outputPath('attribution-hidden.png')});
  await expect.poll(async()=>(await canvasImage(page)).equals(original)).toBe(true);
  await page.getByLabel('Show attribution overlay').check();expect(artifactCalls(fixture)).toHaveLength(1);
  await page.getByRole('button',{name:'Reset attribution visualization'}).click();
  await expect(page.getByLabel('Show attribution overlay')).not.toBeChecked();await expect(page.getByRole('slider',{name:'Attribution opacity',exact:true})).toHaveValue('0.35');
  await page.getByLabel('Explanation method and target').selectOption(explanationIds[1]);
  await expect(page.getByRole('img',{name:/Non-negative activation: transparent minimum/})).toBeVisible();
  await page.getByLabel('Show attribution overlay').check();await expect.poll(()=>artifactCalls(fixture).length).toBe(2);
  await expect(page.getByText(/Loading and verifying attribution/)).toHaveCount(0);
  await page.getByRole('slider',{name:/Axial slice/}).fill('4');
  await page.getByLabel('View',{exact:true}).selectOption('mask3d');
  await expect(page.getByText('Attribution is hidden in the artery-mask 3D view.')).toBeVisible();
  await page.getByLabel('View',{exact:true}).selectOption('slices');
  await page.getByRole('button',{name:`Select candidate ${lesionIds[1]}`,exact:true}).click();
  await expect(page.getByText(/No explanation was supplied for the selected candidate/)).toHaveCount(0); // Volume explanation remains available.
  await expect(page.getByLabel('Explanation method and target')).toHaveValue('');
  await expect(page.getByLabel('Show attribution overlay')).toHaveCount(0);
  await page.getByLabel('Explanation method and target').selectOption(explanationIds[0]);
  await page.getByRole('button',{name:'Clear explanation selection'}).click();
  await expect(page.getByLabel('Show attribution overlay')).toHaveCount(0);
  expect(fixture.calls.filter(c=>/\/(source|mask)$/.test(c.path))).toHaveLength(2);
  expect(fixture.calls.filter(c=>c.path==='metadata')).toHaveLength(1);expect(fixture.calls.every(c=>c.auth==='Bearer browser-test-token')).toBe(true);
  expect(errors).toEqual([]);
});

for(const permuted of [false,true])test(`slice-specific attribution stays on its declared plane (${permuted?'permuted':'flipped'})`,async({page})=>{
  const fixture=await setup(page,{slice:true,permuted});await open(page,fixture);await page.getByLabel('Show attribution overlay').check();
  await expect(page.getByText(/Slice attribution is visible only/)).toBeVisible();
  await page.getByRole('button',{name:'Navigate to explanation slice'}).click();
  await expect(page.getByLabel('View',{exact:true})).toHaveValue(permuted?'sagittal':'axial');
  await expect(page.getByText(/Slice attribution is visible only/)).toHaveCount(0);
  await page.getByLabel('View',{exact:true}).selectOption('coronal');
  await expect(page.getByText(/Slice attribution is visible only/)).toBeVisible();
  expect(fixture.calls.filter(c=>/\/(source|mask)$/.test(c.path))).toHaveLength(2);
});

for(const failure of ['checksum','geometry','retrieval'])test(`${failure} failure keeps the existing CT visible`,async({page})=>{
  const fixture=await setup(page,{badHash:failure==='checksum',badGeometry:failure==='geometry',artifactStatus:failure==='retrieval'?503:undefined});await open(page,fixture);
  await page.getByLabel('Show attribution overlay').check();
  await expect(page.getByRole('alert')).toContainText(failure==='checksum'?'Attribution checksum':failure==='geometry'?'geometry':'Attribution artifact is unavailable');
  await expect(canvas(page)).toBeVisible();await expect(page.getByText(/The original CT is retained/)).toBeVisible();
  await page.getByRole('slider',{name:/Axial slice/}).fill('2');await expect(page.getByRole('slider',{name:/Axial slice/})).toHaveValue('2');
});

test('source mismatch and unavailable metadata do not populate a heatmap',async({page})=>{
  const fixture=await setup(page,{badSource:true});await page.goto(fixture.url);await expect(page.getByRole('alert')).toContainText('could not be verified');
  await page.getByRole('button',{name:'View candidates on CT',exact:true}).click();await expect(canvas(page)).toBeVisible();
  await expect(page.getByLabel('Explanation method and target')).toHaveCount(0);expect(artifactCalls(fixture)).toHaveLength(0);
});
test('unsupported geometry is explicit and never bypasses CT guards',async({page})=>{
  const fixture=await setup(page,{unsupported:true});await page.goto(fixture.url);
  await page.getByLabel('Explanation method and target').selectOption(explanationIds[0]);
  await expect(page.getByRole('region',{name:'Selected explanation metadata'}).getByRole('alert')).toContainText('unsupported');
  await expect(page.getByRole('button',{name:'View candidates on CT',exact:true})).toHaveCount(0);expect(artifactCalls(fixture)).toHaveLength(0);
});
test('stale slow downloads cannot restore a previous explanation',async({page})=>{
  const fixture=await setup(page,{slow:true});await open(page,fixture);await page.getByLabel('Show attribution overlay').check();
  await expect.poll(()=>artifactCalls(fixture).length).toBe(1);
  await page.getByLabel('Explanation method and target').selectOption(explanationIds[1]);await page.getByLabel('Show attribution overlay').check();
  await expect.poll(()=>artifactCalls(fixture).length).toBe(2);fixture.release();
  await expect(page.getByText(/Loading and verifying attribution/)).toHaveCount(0);
  await expect(page.getByRole('img',{name:/Non-negative activation/})).toBeVisible();await expect(canvas(page)).toBeVisible();
  await page.getByRole('button',{name:'Close viewer',exact:true}).click();await expect(canvas(page)).toHaveCount(0);
});
test('metadata failures stay unavailable and session expiry follows existing authentication',async({page})=>{
  const fixture=await setup(page,{metadataStatus:503});await page.goto(fixture.url);await expect(page.getByRole('alert')).toContainText('Explanation metadata is unavailable.');
  await expect(page.getByLabel('Explanation method and target')).toHaveCount(0);
});
test('metadata 401 uses existing session expiry handling',async({page})=>{
  const fixture=await setup(page,{metadataStatus:401});await page.goto(fixture.url);await expect(page).toHaveURL(/\/login$/);
});
test('mobile attribution metadata, controls and legends are accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});const fixture=await setup(page);await open(page,fixture);await page.getByLabel('Show attribution overlay').check();
  await expect(page.getByText(/Loading and verifying attribution/)).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const audit=await new AxeBuilder({page}).include('#main-content').withTags(['wcag2a','wcag2aa']).analyze();expect(audit.violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath('attribution-mobile.png'),fullPage:true});
});
