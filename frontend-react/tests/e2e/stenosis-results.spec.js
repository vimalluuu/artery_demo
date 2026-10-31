import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { installApi } from './fixtures';
import { syntheticNifti } from './nifti-fixture';
import { capabilitiesFixture, historyFixture, jobFixture } from '../stenosis-jobs-fixtures';
import { geometryFixture, lesionIds, regionId, resultFixture } from '../stenosis-results-fixtures';

// All volumes, lesions and measurements in this file are synthetic test data.
async function setup(page, options = {}) {
  await installApi(page, { role:'Researcher' });
  const geometry = structuredClone(geometryFixture);
  if (options.permuted) geometry.affine = [[0,-2,0,24],[-1,0,0,-13],[0,0,3,42],[0,0,0,1]];
  const ct = gzipSync(syntheticNifti({affine:geometry.affine}));
  const mask = gzipSync(syntheticNifti({affine:geometry.affine,mask:true}));
  const root = await resultFixture({geometry,sourceHash:createHash('sha256').update(ct).digest('hex'),count:options.empty ? 0 : 3});
  const job = jobFixture('completed');
  job.provenance = structuredClone(root.result.provenance); job.result_reference = root.result_id;
  if (options.ambiguous) root.result.lesions[1].location = structuredClone(root.result.lesions[0].location);
  if (options.zero) root.result.lesions[0].measurements.reference_diameter = {value:0,unit:'mm',unavailable_reason:null,method_id:'synthetic-test-only',method_version:'v1'};
  if (options.unsupported) root.visualization = {status:'unsupported_geometry',reason:'Synthetic unsupported geometry; use protected downloads'};
  if (options.invalid) root.result.lesions[0].location.world_coordinates[0] += 100;
  if (options.noLocation) {root.result.lesions[0].location = null;root.result.lesions[0].localization_unavailable_reason = {code:'not_provided',message:'Synthetic fixture has no supplied position'};}
  if (options.region) root.result.lesions[0].candidate_region = {artifact_id:regionId,format:'nii.gz',sha256:createHash('sha256').update(mask).digest('hex'),source_sha256:root.segmentation.metadata.source_sha256,geometry,geometry_fingerprint:root.geometry_fingerprint};
  const calls = []; let resultReads=0;
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}/explanations`,route=>route.fulfill({json:{contract_version:'1.0',case_id:1,analysis_id:job.analysis_id,result_id:root.result_id,status:'not_generated',items:[],unavailable_reason:{code:'not_provided',message:'No explanation was generated for this synthetic completed result.'}}}));
  await page.route('**/api/v1/stenosis/capabilities', route=>route.fulfill({json:capabilitiesFixture()}));
  await page.route('**/api/v1/cases/1/stenosis/analyses?**', route=>route.fulfill({json:{...historyFixture(),items:[job],total:1}}));
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}`, route=>route.fulfill({json:job}));
  await page.route(`**/api/v1/cases/1/stenosis/analyses/${job.analysis_id}/result`, route=>{resultReads++;calls.push({path:new URL(route.request().url()).pathname,auth:route.request().headers().authorization});return route.fulfill({status:options.status || 200,json:options.status ? {detail:{contract_version:'1.0',code:'result_integrity_failure',message:'Completed result cannot be verified'}} : root});});
  await page.route('**/api/v1/cases/1/segmentations**', route=>{
    const path = new URL(route.request().url()).pathname;
    calls.push({path,auth:route.request().headers().authorization});
    return path.endsWith('/segmentations') ? route.fulfill({json:[root.segmentation]}) : route.fulfill({contentType:'application/gzip',body:path.endsWith('/source') ? ct : mask});
  });
  await page.route('**/api/v1/cases/1/stenosis/analyses/*/lesions/*/regions/*',route=>{
    calls.push({path:new URL(route.request().url()).pathname,auth:route.request().headers().authorization});
    return route.fulfill({contentType:'application/gzip',body:options.badRegion ? Buffer.from('not the supplied volume') : mask});
  });
  return {root,calls,reads:()=>resultReads,url:`/cases/1/stenosis?analysis=${job.analysis_id}`};
}

async function open(page, fixture, id) {
  await page.goto(fixture.url + (id ? `&lesion=${id}` : ''));
  await expect(page.getByRole('group',{name:'Candidate lesions',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View candidates on CT',exact:true}).click();
  await expect(page.getByText(/Voxel spacing \(original axes\):/)).toBeVisible({timeout:30_000});
}

for (const permuted of [false,true]) test(`real WebGL candidate selection, markers and reverse slice selection (${permuted ? 'permuted' : 'flipped'})`,async ({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const fixture = await setup(page,{permuted});await open(page,fixture);
  await expect(page.getByText(permuted ? 'Crosshair RAS: 20.00, -14.00, 51.00 mm' : 'Crosshair RAS: 23.00, -9.00, 51.00 mm',{exact:false})).toBeVisible();
  const marker = page.getByRole('button',{name:`Select Axial candidate ${lesionIds[1]}`,exact:true});
  await expect(marker).toBeVisible();await marker.click();
  await expect(page.getByRole('button',{name:`Select candidate ${lesionIds[1]}`,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText(permuted ? 'Crosshair RAS: 16.00, -17.00, 51.00 mm' : 'Crosshair RAS: 20.00, -5.00, 51.00 mm',{exact:false})).toBeVisible();
  await page.getByRole('slider',{name:/Sagittal slice/}).fill(permuted ? '7' : '10');
  await page.getByRole('slider',{name:/Coronal slice/}).fill(permuted ? '10' : '2');
  await expect(page.getByRole('button',{name:`Select candidate ${lesionIds[0]}`,exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('View',{exact:true}).selectOption('mask3d');
  await expect(page.locator('.lesion-marker')).toHaveCount(0);
  await page.getByRole('button',{name:`Select candidate ${lesionIds[2]}`,exact:true}).click();
  await expect(page.getByLabel('View',{exact:true})).toHaveValue('slices');
  await expect(page.getByRole('button',{name:`Select Axial candidate ${lesionIds[2]}`,exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('slider',{name:/Window width/}).fill('800');
  await page.getByLabel('Show segmentation').uncheck();
  await expect(page.getByRole('button',{name:`Select candidate ${lesionIds[2]}`,exact:true})).toHaveAttribute('aria-pressed','true');
  expect(fixture.calls.filter(c=>/\/(source|mask)$/.test(c.path))).toHaveLength(2);
  expect(fixture.reads()).toBe(1);
  expect(fixture.calls.every(c=>c.auth==='Bearer browser-test-token')).toBe(true);
  await page.screenshot({path:test.info().outputPath('candidate-viewer.png'),fullPage:true});
  await page.reload();
  await expect(page.getByRole('button',{name:`Select candidate ${lesionIds[2]}`,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'View candidates on CT',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('missing values, explicit zero, absent position and unknown URL identity are distinct',async ({page})=>{
  const fixture=await setup(page,{zero:true,noLocation:true});await page.goto(fixture.url);
  await expect(page.getByText('0 mm',{exact:true})).toBeVisible();
  await expect(page.getByText('Localization unavailable: Synthetic fixture has no supplied position')).toBeVisible();
  await expect(page.getByText(/Unavailable: Synthetic fixture: not supplied/)).not.toHaveCount(0);
  await page.goto(fixture.url+'&lesion=ffffffff-1234-4567-890a-123456789abc');
  await expect(page.getByRole('alert')).toContainText('does not belong to this result');
  await expect(page.getByRole('region',{name:/Candidate details/})).toHaveCount(0);
});

for (const kind of ['empty','invalid','unsupported','integrity']) test(`${kind} results never become fabricated clinical negatives`,async ({page})=>{
  const fixture=await setup(page,{empty:kind==='empty',invalid:kind==='invalid',unsupported:kind==='unsupported',status:kind==='integrity'?409:undefined});await page.goto(fixture.url);
  if(kind==='empty') await expect(page.getByText('The completed analysis returned no candidate lesions. This is not proof that stenosis is absent.')).toBeVisible();
  if(kind==='invalid') await expect(page.getByRole('alert')).toContainText('coordinates disagree');
  if(kind==='unsupported') await expect(page.getByRole('alert')).toContainText('unsupported geometry');
  if(kind==='integrity') await expect(page.getByRole('alert')).toContainText('cannot be verified');
  if(kind!=='empty') await expect(page.getByRole('button',{name:'View candidates on CT',exact:true})).toHaveCount(0);
  await expect(page.getByText(/no stenosis detected|clinical confidence/i)).toHaveCount(0);
});

test('same-position candidates preserve deliberate selection and report ambiguity',async ({page})=>{
  const fixture=await setup(page,{ambiguous:true});await open(page,fixture,lesionIds[1]);
  await expect(page.getByText(/Multiple candidates share this position/)).toBeVisible();
  await expect(page.getByRole('button',{name:`Select candidate ${lesionIds[1]}`,exact:true})).toHaveAttribute('aria-pressed','true');
});

for(const badRegion of [false,true]) test(`optional supplied region ${badRegion?'failure retains CT':'is distinct and removed on selection'}`,async({page})=>{
  const fixture=await setup(page,{region:true,badRegion});await open(page,fixture);
  const canvas=page.getByRole('img',{name:/CT slices/});const original=await canvas.screenshot();
  await page.getByLabel('Show supplied candidate region').check();
  if(badRegion) await expect(page.getByText(/Candidate-region checksum does not match/)).toBeVisible();
  else {
    await expect(page.getByText(/Loading supplied candidate region/)).toHaveCount(0);
    await expect.poll(async()=>!(await canvas.screenshot()).equals(original)).toBe(true);
    await page.getByLabel('View',{exact:true}).selectOption('axial');
    await page.getByLabel('View',{exact:true}).selectOption('slices');
  }
  await page.getByRole('button',{name:`Select candidate ${lesionIds[1]}`,exact:true}).click();
  await expect(page.getByText(/No candidate-region artifact was supplied/)).toBeVisible();
  await expect(canvas).toBeVisible();
  expect(fixture.calls.filter(c=>c.path.includes('/regions/'))).toHaveLength(1);
  expect(fixture.calls.filter(c=>/\/(source|mask)$/.test(c.path))).toHaveLength(2);
});

test('candidate list, detail and rendered viewer remain accessible on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});const fixture=await setup(page);await open(page,fixture);
  await expect(page.getByRole('button',{name:`Select Axial candidate ${lesionIds[0]}`,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const audit=await new AxeBuilder({page}).include('#main-content').withTags(['wcag2a','wcag2aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath('candidate-mobile.png'),fullPage:true});
});
