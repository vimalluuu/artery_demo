// Opt-in real React/Axios/FastAPI/PostgreSQL test. No API interception or inference.
// Run through backend/tests/test_stenosis_acceptance.py for isolated setup/cleanup.
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test.skip(!process.env.VASCUAI_LIVE_FIXTURE,'Requires the disposable PostgreSQL acceptance harness');
async function login(page){
  const f=JSON.parse(await readFile(process.env.VASCUAI_LIVE_FIXTURE,'utf8'));
  expect(f.synthetic_only).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email address',{exact:true}).fill(f.email);
  // Existing conftest's disposable-account password, never an application account.
  await page.getByLabel('Password',{exact:true}).fill('a-long-test-password-123');
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return f;
}

test('live protected outputs join history, geometry, viewer, analytics and exports',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const f=await login(page);
  const analytics=page.getByRole('region',{name:'Stenosis analytics',exact:true});
  await expect(analytics.locator('.stat-card').filter({hasText:'Total analysis jobs'})).toContainText('2');
  await expect(analytics.locator('.stat-card').filter({hasText:'Stored lesion records'})).toContainText('2');
  const calls=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/v1/'))calls.push({path:new URL(r.url()).pathname,bearer:r.headers().authorization?.startsWith('Bearer ')===true});});
  await page.goto(`/cases/${f.case_id}/stenosis?analysis=${f.analysis_id}&lesion=${f.lesion_ids[0]}`);
  await expect(page.getByRole('button',{name:'Start stenosis analysis',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Explanation method and target')).toBeVisible();
  // Exercise the shared Axios client and real adapters, including endpoints that
  // the screen does not otherwise fetch separately (e.g. lesion detail).
  const result=await page.evaluate(async f=>{
    const {stenosisApi}=await import('/src/api/stenosis.js');
    const {default:api}=await import('/src/api/client.js');
    let rejection;
    try{await stenosisApi.start(f.case_id,f.source,crypto.randomUUID());}catch(e){rejection=e.response?.data?.detail?.code;}
    const detail=await api.get(`/cases/${f.case_id}/stenosis/analyses/${f.analysis_id}/lesions/${f.lesion_ids[0]}`);
    const index=await stenosisApi.analysisIndex({case_id:f.case_id});
    return {rejection,lesion:detail.data.lesion.lesion_id,index:index.total};
  },f);
  expect(result).toEqual({rejection:'capability_unavailable',lesion:f.lesion_ids[0],index:2});
  await page.getByLabel('Explanation method and target').selectOption(f.explanation_ids[1]);
  await page.getByRole('button',{name:'View candidates on CT',exact:true}).click();
  await expect(page.getByText(/Voxel spacing \(original axes\)/)).toBeVisible({timeout:30000});
  const image=()=>page.getByRole('img',{name:/CT slices/}).screenshot({style:'.topbar, .skip-link { visibility: hidden !important; }'});
  const original=await image();
  await page.getByLabel('Show supplied candidate region (green, 2D slices only)',{exact:true}).check();
  await expect.poll(async()=>!(await image()).equals(original)).toBe(true);
  await expect(page.getByText(/Loading and verifying supplied candidate region/)).toHaveCount(0);
  const withRegion=await image();
  const signedResponse=page.waitForResponse(r=>r.url().endsWith(`/explanations/${f.explanation_ids[1]}/artifact`));
  await page.getByLabel('Show attribution overlay',{exact:true}).check();
  expect((await signedResponse).status()).toBe(200);
  await expect.poll(async()=>!(await image()).equals(withRegion)).toBe(true);
  await expect(page.getByText(/Loading and verifying attribution/)).toHaveCount(0);
  await expect(page.getByRole('img',{name:/Signed attribution: blue negative/})).toBeVisible();
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('/artifact')).length).toBe(1);
  await page.getByRole('slider',{name:'Attribution opacity',exact:true}).fill('0.6');
  await expect(page.getByText('60%',{exact:true})).toBeVisible();
  await page.getByLabel('Explanation method and target').selectOption(f.explanation_ids[0]);
  await expect(page.getByRole('img',{name:/Non-negative activation: transparent minimum/})).toBeVisible();
  const nonNegativeResponse=page.waitForResponse(r=>r.url().endsWith(`/explanations/${f.explanation_ids[0]}/artifact`));
  await page.getByLabel('Show attribution overlay',{exact:true}).check();
  expect((await nonNegativeResponse).status()).toBe(200);
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('/artifact')).length).toBe(2);
  await expect(page.getByText(/Loading and verifying attribution/)).toHaveCount(0);
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await page.getByRole('button',{name:`Select candidate ${f.lesion_ids[1]}`,exact:true}).click();
  await expect(page.getByRole('button',{name:`Select candidate ${f.lesion_ids[1]}`,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>calls.filter(c=>/\/(source|mask)$/.test(c.path)).length).toBe(2);
  await expect.poll(()=>calls.some(c=>c.path.includes('/regions/'))).toBe(true);
  await page.goto(`/cases/${f.case_id}/stenosis/report/${f.analysis_id}`);
  await expect(page.locator('.report-lesion')).toHaveCount(2);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download report JSON'}).click();
  const body=JSON.parse(await readFile(await (await download).path(),'utf8'));
  expect(body.result.result_id).toBe(f.result_id);expect(body.explanations.items).toHaveLength(2);
  expect(JSON.stringify(body)).not.toMatch(/claim_token|volume_path|password_hash/);
  const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download findings CSV'}).click();
  const csv=await readFile(await (await csvDownload).path(),'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(3);
  expect(csv).toContain(f.result_id);
  await page.emulateMedia({media:'print'});
  await expect(page.locator('.stenosis-report')).toBeVisible();
  await expect(page.getByRole('button',{name:'Download findings CSV'})).toBeHidden();
  expect(calls.every(c=>c.bearer)).toBe(true);
  expect(errors).toEqual([]);
});

test('live zero findings and mobile report retain uncertainty and authorization',async({page})=>{
  const f=await login(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/cases/${f.case_id}/stenosis/report/${f.zero_analysis_id}`);
  await expect(page.getByText(/The completed analysis returned no candidate lesions/)).toBeVisible();
  expect((await new AxeBuilder({page}).include('.stenosis-report').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const status=await page.evaluate(async f=>{
    const {default:api}=await import('/src/api/client.js');
    const csv=await api.get(`/cases/${f.case_id}/stenosis/analyses/${f.zero_analysis_id}/report.csv`);
    const routes=[`/cases/${f.case_id+100}/stenosis/analyses/${f.analysis_id}/report`];
    const codes=[];
    for(const route of routes){try{await api.get(route);}catch(e){codes.push(e.response.status);}}
    const unauthenticated=await fetch(`/api/v1/cases/${f.case_id}/stenosis/analyses/${f.analysis_id}/explanations`,{credentials:'omit'});
    return {rows:csv.data.trim().split('\r\n').length,cache:csv.headers['cache-control'],nosniff:csv.headers['x-content-type-options'],codes,unauthenticated:unauthenticated.status};
  },f);
  expect(status).toEqual({rows:1,cache:'no-store',nosniff:'nosniff',codes:[404],unauthenticated:401});
});
