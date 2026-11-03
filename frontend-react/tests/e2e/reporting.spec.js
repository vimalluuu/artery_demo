import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {installApi} from './fixtures';
import {summaryFixture,indexFixture,reportFixture} from '../reporting-fixtures';
import {historyFixture,jobFixture,capabilitiesFixture} from '../stenosis-jobs-fixtures';

async function analyticsSetup(page,options={}){
  await installApi(page,{role:options.role||'Admin'});let fail=Boolean(options.fail);const calls=[];
  await page.route(/\/api\/v1\/(?:stenosis\/analytics\/summary|cases\/\d+\/stenosis\/analytics)(?:\?.*)?$/,route=>{
    calls.push({url:route.request().url(),auth:route.request().headers().authorization});
    const data=summaryFixture({populated:options.populated,patientAllowed:options.role!=='Researcher'});
    if(options.stale){data.current.analyses=1;data.current.analyses_with_lesions=0;data.current.cases_with_lesions=0;data.current.lesions=0;data.quality.stale=1;data.measurements.forEach(m=>m.unavailable=0);}
    return route.fulfill({status:fail?503:200,json:fail?{detail:'Analytics temporarily unavailable'}:data});
  });
  await page.route('**/api/v1/stenosis/analytics/analyses?**',route=>route.fulfill({json:indexFixture({populated:options.populated})}));
  return{calls,recover:()=>{fail=false;}};
}
async function reportSetup(page,options={}){
  await installApi(page,{role:'Researcher'});const record=await reportFixture(options),calls=[];
  await page.route('**/api/v1/cases/1/stenosis/analyses/*/report',route=>{calls.push(route.request().headers().authorization);return route.fulfill({json:record});});
  await page.route('**/api/v1/cases/1/stenosis/analyses/*/report.csv',route=>{
    calls.push(route.request().headers().authorization);
    return route.fulfill({contentType:'text/csv;charset=utf-8',body:record.report_state==='completed'&&record.result.result.lesions.length?'"schema_version","lesion_id","vessel_label"\r\n"1.0","'+record.result.result.lesions[0].lesion_id+'","\'=SUM(1,2)"\r\n':'"schema_version","lesion_id","vessel_label"\r\n'});
  });
  return{record,calls,url:`/cases/1/stenosis/report/${record.analysis.analysis_id}`};
}
test('dashboard keeps generic case completion separate from zero stenosis records',async({page})=>{
  await analyticsSetup(page);await page.goto('/dashboard');
  await expect(page.getByText('No stenosis analyses are recorded in this filter window. This is not a negative medical finding.')).toBeVisible();
  await expect(page.getByText(/Severity analytics unavailable:/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Cases complete',exact:true})).toHaveCount(0); // Existing card remains a labelled workflow value, not a stenosis heading.
  await expect(page.getByText('Reported case status',{exact:true})).toBeVisible();
});
test('dashboard uses returned counts, unavailable severity, UTC filters and authorized links',async({page})=>{
  const fixture=await analyticsSetup(page,{populated:true});await page.goto('/dashboard');
  const section=page.getByRole('region',{name:'Stenosis analytics',exact:true});
  await expect(section.getByText('Stored lesion records',{exact:true})).toBeVisible();
  await expect(section.getByRole('table',{name:'Analysis creation cohorts by UTC day'})).toBeVisible();
  await page.getByLabel('Start date (UTC)',{exact:true}).fill('2026-10-01');await page.getByLabel('End date (UTC)',{exact:true}).fill('2026-10-31');await page.getByLabel('Case ID',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Apply stenosis filters'}).click();await expect.poll(()=>fixture.calls.length).toBe(2);
  expect(fixture.calls[1].url).toContain('case_id=1');expect(fixture.calls.every(c=>c.auth==='Bearer browser-test-token')).toBe(true);
  await expect(section.getByRole('link',{name:'Open findings report'})).toHaveAttribute('href',/\/cases\/1\/stenosis\/report\//);
});
test('stale results are explicitly excluded',async({page})=>{
  await analyticsSetup(page,{populated:true,stale:true});await page.goto('/dashboard');await expect(page.getByText('Excluded stale results',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('analytics errors never become zero totals; Retry recovers',async({page})=>{
  const fixture=await analyticsSetup(page,{fail:true});await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toContainText('Analytics temporarily unavailable');
  await expect(page.getByText('Eligible completed results',{exact:true})).toHaveCount(0);fixture.recover();await page.getByRole('button',{name:/Retry/}).click();
  await expect(page.getByText('Eligible completed results',{exact:true})).toBeVisible();
});
test('patient filters follow existing roles and mobile analytics is accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await analyticsSetup(page,{role:'Researcher'});await page.goto('/dashboard');
  await expect(page.getByLabel('Patient ID',{exact:true})).toHaveCount(0);await expect(page.getByText('Patient-level counts require a clinical writer.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const audit=await new AxeBuilder({page}).include('.stenosis-analytics').withTags(['wcag2a','wcag2aa']).analyze();expect(audit.violations).toEqual([]);
});
test('case report shows multiple supplied lesions and explicit missing measurements',async({page})=>{
  const fixture=await reportSetup(page);await page.goto(fixture.url);
  await expect(page.locator('.report-lesion')).toHaveCount(3);await expect(page.getByText(/Unavailable: Synthetic fixture: not supplied/)).not.toHaveCount(0);
  await expect(page.getByText(/Experimental research prototype. Not a clinically validated diagnosis/)).toBeVisible();
});
test('JSON and formula-safe CSV are downloaded through authorized report retrieval',async({page})=>{
  const fixture=await reportSetup(page);await page.goto(fixture.url);
  const jsonPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download report JSON'}).click();const json=await jsonPromise;
  const body=JSON.parse(await readFile(await json.path(),'utf8'));expect(body.schema_version).toBe('1.0');expect(body.result.result.lesions).toHaveLength(3);expect(JSON.stringify(body)).not.toMatch(/claim_token|volume_path|password_hash/);
  const csvPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download findings CSV'}).click();const csv=await csvPromise;
  expect(csv.suggestedFilename()).toMatch(/^vascuai-stenosis-.*\.csv$/);expect(await readFile(await csv.path(),'utf8')).toContain("'=SUM(1,2)");expect(fixture.calls.every(auth=>auth==='Bearer browser-test-token')).toBe(true);
});
test('completed zero-lesion report retains context and exports header-only CSV',async({page})=>{
  const fixture=await reportSetup(page,{count:0});await page.goto(fixture.url);await expect(page.getByText(/CSV will contain column headers only/)).toBeVisible();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download findings CSV'}).click();const download=await pending;expect((await readFile(await download.path(),'utf8')).trim().split(/\r?\n/)).toHaveLength(1);
});
for(const state of ['failed','running','stale','integrity_error'])test(`${state} report withholds findings and disables CSV`,async({page})=>{
  const fixture=await reportSetup(page,{state});await page.goto(fixture.url);await expect(page.getByText(/No completed findings are presented/)).toBeVisible();await expect(page.locator('.report-lesion')).toHaveCount(0);await expect(page.getByRole('button',{name:'Download findings CSV'})).toBeDisabled();
});
test('print retains report metadata and warnings while removing application chrome',async({page})=>{
  const fixture=await reportSetup(page);await page.addInitScript(()=>{window.print=()=>{window.__printed=true;};});await page.goto(fixture.url);await page.getByRole('button',{name:'Print / Save as PDF'}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(true);
  await page.emulateMedia({media:'print'});await expect(page.locator('.topbar')).toBeHidden();await expect(page.getByRole('button',{name:'Download report JSON'})).toBeHidden();await expect(page.locator('.report-sheet .notice')).toBeVisible();await expect(page.locator('.report-lesion')).toHaveCount(3);
});
test('case reporting without an analysis is unavailable/not performed, not a findings report',async({page})=>{
  await installApi(page);await page.goto('/cases/1/stenosis/report');await expect(page.getByText(/No analysis selected/)).toBeVisible();await expect(page.getByText(/No stenosis analyses are recorded/)).toBeVisible();await expect(page.getByRole('button',{name:'Download report JSON'})).toHaveCount(0);
});
test('history status/date filters are sent to the existing case API and survive reload',async({page})=>{
  await installApi(page);const requests=[];await page.route('**/api/v1/stenosis/capabilities',r=>r.fulfill({json:capabilitiesFixture()}));
  await page.route('**/api/v1/cases/1/stenosis/analyses?**',r=>{requests.push(r.request().url());return r.fulfill({json:historyFixture()});});
  await page.goto('/cases/1/stenosis');await page.getByLabel('History status',{exact:true}).selectOption('failed');await page.getByLabel('History start date (UTC)',{exact:true}).fill('2026-10-01');
  await page.getByRole('button',{name:'Apply history filters',exact:true}).click();
  await expect.poll(()=>requests.some(url=>url.includes('status=failed')&&url.includes('start_date=2026-10-01'))).toBe(true);
  await expect(page.getByText('No analyses match these history filters.')).toBeVisible();await page.reload();await expect(page.getByLabel('History status',{exact:true})).toHaveValue('failed');
});
test('report authentication failure uses existing session expiry',async({page})=>{
  await installApi(page);const job=jobFixture('completed');await page.route('**/api/v1/cases/1/stenosis/analyses/*/report',r=>r.fulfill({status:401,json:{detail:'Expired session'}}));await page.goto(`/cases/1/stenosis/report/${job.analysis_id}`);await expect(page).toHaveURL(/\/login$/);
});
