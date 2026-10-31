import {test,expect} from '@playwright/test';
import {installApi} from './fixtures';
import {syntheticNifti} from './nifti-fixture';
import {reportFixture} from '../reporting-fixtures';

test('candidate-region insertion failure removes only its partially added volume',async({page})=>{
  await installApi(page);await page.goto('/dashboard');
  const outcome=await page.evaluate(async bytes=>{
    const {addCandidateRegion}=await import('/src/lib/niivue-adapter.js');
    const ct={name:'retained-ct'},original=new Error('Synthetic GPU insertion failure');
    const viewer={volumes:[ct],addVolume(image){this.volumes.push(image);throw original;},
      removeVolume(image){this.volumes=this.volumes.filter(value=>value!==image);}};
    let sameError=false;
    try{await addCandidateRegion(viewer,new Uint8Array(bytes).buffer,[[-.7,0,0,24],[0,1.2,0,-13],[0,0,2.5,42],[0,0,0,1]],new AbortController().signal);}
    catch(error){sameError=error===original;}
    return {sameError,volumes:viewer.volumes.length,ctRetained:viewer.volumes[0]===ct};
  },Array.from(syntheticNifti({mask:true})));
  expect(outcome).toEqual({sameError:true,volumes:1,ctRetained:true});
});

test('uppercase report URL loads the same canonical authorized analysis',async({page})=>{
  await installApi(page);
  const report=await reportFixture({count:0}),canonical=report.analysis.analysis_id,requests=[];
  await page.route('**/api/v1/cases/1/stenosis/analyses/*/report',route=>{
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({json:report});
  });
  await page.goto(`/cases/1/stenosis/report/${canonical.toUpperCase()}`);
  await expect(page.getByText(/The completed analysis returned no candidate lesions/)).toBeVisible();
  expect(requests).toEqual([`/api/v1/cases/1/stenosis/analyses/${canonical}/report`]);
});

test('unavailable measurements display supplied method halves without invented provenance',async({page})=>{
  await installApi(page);
  const report=await reportFixture({count:1});
  report.result.result.lesions[0].measurements.reference_diameter.method_id='supplied-method';
  report.result.result.lesions[0].measurements.minimum_lumen_diameter.method_version='supplied-version';
  await page.route('**/api/v1/cases/1/stenosis/analyses/*/report',route=>route.fulfill({json:report}));
  await page.goto(`/cases/1/stenosis/report/${report.analysis.analysis_id}`);
  await expect(page.locator('.report-lesion')).toHaveCount(1);
  await expect(page.getByRole('row').filter({hasText:'reference diameter'})).toContainText('supplied-method / Version not supplied');
  await expect(page.getByRole('row').filter({hasText:'minimum lumen diameter'})).toContainText('Method not supplied / supplied-version');
  await expect(page.getByRole('row').filter({hasText:'reference diameter'})).toContainText('Unavailable:');
});
