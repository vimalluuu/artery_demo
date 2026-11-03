import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { installApi } from './fixtures';
import { syntheticNifti } from './nifti-fixture';

const id = '12345678-1234-4567-890a-123456789abc';
const otherId = '22345678-1234-4567-890a-123456789abc';
const affine = [[-.7,0,0,24],[0,1.2,0,-13],[0,0,2.5,42],[0,0,0,1]];

async function setup(page, options = {}) {
  await installApi(page, { role: options.role || 'Researcher' });
  const spatial = options.permuted ? [[0,-1.2,0,24],[-.7,0,0,-13],[0,0,2.5,42],[0,0,0,1]] : affine;
  const ct = gzipSync(syntheticNifti({ qformCode: 4, affine: spatial }));
  const mask = gzipSync(syntheticNifti({ mask: true, affine: options.badGeometry ? [[-.7,0,0,25],...affine.slice(1)] : spatial }));
  const metadata = { source_sha256: createHash('sha256').update(ct).digest('hex'), shape:options.large ? [512,512,217] : [12,10,8], affine:spatial, xyzt_units:2, threshold:.7, architecture:'SmallUNet3D' };
  const records = [id, otherId].map(runId => ({ id:runId, case_id:1, created_at:'2026-10-19T00:00:00Z', stale:false, metadata }));
  if (options.badChecksum) metadata.source_sha256 = 'f'.repeat(64);
  const calls = [];
  let stale = Boolean(options.stale), release;
  const gate = options.slow ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  await page.route('**/api/v1/cases/*/segmentations**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ path, auth:request.headers().authorization });
    if (path.endsWith('/segmentations')) return route.fulfill({ json:records.map(r => ({...r, stale, case_id:Number(path.split('/')[4])})) });
    await gate;
    if (options.status) return route.fulfill({ status:options.status, json:{detail:'Protected volume access failed'} });
    const body = path.endsWith('/source') ? ct : mask;
    return route.fulfill({ contentType:'application/gzip', body });
  });
  return { calls, stale:() => { stale = true; }, release:() => release?.() };
}

async function open(page, runId = id) {
  await page.goto('/cases/1/analysis');
  await page.getByRole('button', {name:`View CT + Segmentation for run ${runId}`, exact:true}).click();
}

async function ready(page) {
  await expect(page.getByText(/Voxel spacing \(original axes\):/)).toBeVisible({timeout:30_000});
}

test('authenticated orthogonal viewer renders real synthetic data and keyboard controls', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = await setup(page);
  await open(page); await ready(page);
  expect(fixture.calls.filter(c => /\/(source|mask)$/.test(c.path))).toHaveLength(2);
  expect(fixture.calls.every(c => c.auth === 'Bearer browser-test-token')).toBe(true);
  expect(fixture.calls.some(c => c.path.endsWith('/probabilities'))).toBe(false);
  await expect(page.getByText(/Neurological convention/)).toBeVisible();
  await expect(page.getByText(/0.7000 × 1.2000 × 2.5000 mm/)).toBeVisible();
  const axial = page.getByRole('slider', {name:/Axial slice/});
  await axial.fill('2'); await axial.focus(); await page.keyboard.press('ArrowRight');
  await expect(axial).toHaveValue('3');
  await page.getByRole('slider',{name:/Coronal slice/}).fill('4');
  await page.getByRole('slider',{name:/Sagittal slice/}).fill('8');
  await expect(page.getByText(/Crosshair RAS: 21.90, -8.20, 49.50 mm/)).toBeVisible();
  await page.getByLabel('View', {exact:true}).selectOption('axial');
  await page.getByRole('slider',{name:/Window width/}).fill('800');
  await page.getByRole('slider',{name:/Window level/}).fill('200');
  await page.getByRole('slider',{name:/Overlay opacity/}).fill('0.8');
  const canvas = page.getByRole('img',{name:/CT slices/});
  const before = await canvas.screenshot();
  await page.getByLabel('Show segmentation').uncheck();
  const after = await canvas.screenshot();
  expect(before.equals(after)).toBe(false);
  await page.getByLabel('Show segmentation').check();
  await page.getByLabel('View',{exact:true}).selectOption('mask3d');
  await expect(page.getByRole('button',{name:'Rotate 3D left'})).toBeVisible();
  await page.getByRole('button',{name:'Rotate 3D right'}).click();
  await page.getByLabel('View',{exact:true}).selectOption('slices');
  const violations = await new AxeBuilder({page}).include('.volume-viewer').withTags(['wcag2a','wcag2aa']).analyze();
  expect(violations.violations).toEqual([]);
  await page.screenshot({path:'test-results/viewer-desktop.png',fullPage:true});
  const retained = await canvas.elementHandle();
  await page.getByRole('button',{name:'Close viewer',exact:true}).click();
  await expect(canvas).toHaveCount(0);
  await expect.poll(() => retained.evaluate(element => element.getContext('webgl2').isContextLost())).toBe(true);
  await retained.dispose();
  await expect(page.getByRole('button',{name:`View CT + Segmentation for run ${id}`,exact:true})).toBeFocused();
  expect(errors).toEqual([]);
});

test('3D camera controls are keyboard accessible and reset presentation only', async ({page}) => {
  await setup(page); await open(page); await ready(page);
  await page.getByRole('slider',{name:/Window width/}).fill('800');
  await page.getByRole('slider',{name:/Window level/}).fill('200');
  await page.getByRole('slider',{name:/Overlay opacity/}).fill('0.8');
  await expect(page.getByRole('slider',{name:/Window width/})).toHaveValue('800');
  // Let the existing debounced window update finish before fixed-view comparisons.
  await page.waitForTimeout(200);
  await page.getByLabel('View',{exact:true}).selectOption('mask3d');
  const feedback = page.getByLabel('3D camera',{exact:true});
  await expect(feedback).toHaveText('Azimuth 110°, elevation 10°, zoom 100%');
  const canvas = page.getByRole('img',{name:/CT slices/});
  const baseline = await canvas.screenshot({path:test.info().outputPath('3d-default.png')});
  await page.getByRole('button',{name:'Rotate 3D right',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Tilt 3D up',exact:true}).click();
  await page.getByRole('button',{name:'Zoom 3D in',exact:true}).click();
  await expect(feedback).toHaveText('Azimuth 140°, elevation 25°, zoom 125%');
  const changed = await canvas.screenshot({path:test.info().outputPath('3d-camera-adjusted.png')});
  expect(changed.equals(baseline)).toBe(false);
  await canvas.hover();
  await page.mouse.wheel(0, -100);
  await expect(feedback).not.toContainText('zoom 125%');
  const beforeDrag = await feedback.textContent();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:5});
  await page.mouse.up();
  await expect(feedback).not.toHaveText(beforeDrag);
  const [azimuth,elevation] = (await feedback.textContent()).match(/-?\d+/g).map(Number);
  await page.getByRole('button',{name:'Rotate 3D right',exact:true}).click();
  await expect(feedback).toContainText(`Azimuth ${azimuth+30}°, elevation ${elevation}°`);
  await page.getByRole('button',{name:'Reset 3D view',exact:true}).click();
  await expect(feedback).toHaveText('Azimuth 110°, elevation 10°, zoom 100%');
  const reset = await canvas.screenshot({path:test.info().outputPath('3d-reset.png')});
  expect(reset.equals(baseline)).toBe(true);
  for (let i=0; i<4; i++) await page.getByRole('button',{name:'Zoom 3D in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Zoom 3D in',exact:true})).toBeDisabled();
  await expect(feedback).toContainText('zoom 200%');
  await page.getByRole('button',{name:'Reset 3D view',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations = await new AxeBuilder({page}).include('.volume-viewer').withTags(['wcag2a','wcag2aa']).analyze();
  expect(violations.violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath('3d-controls-mobile.png'),fullPage:true});
  await page.getByLabel('View',{exact:true}).selectOption('axial');
  await expect(page.getByRole('slider',{name:/Window width/})).toHaveValue('800');
  await expect(page.getByRole('slider',{name:/Window level/})).toHaveValue('200');
  await expect(page.getByRole('slider',{name:/Overlay opacity/})).toHaveValue('0.8');
  await expect(page.getByLabel('Show segmentation')).toBeChecked();
  await expect(page.getByRole('group',{name:'3D view controls',exact:true})).toHaveCount(0);
});

test('permuted anatomical axes keep sliders and world positions aligned', async ({page}) => {
  await setup(page,{permuted:true}); await open(page); await ready(page);
  await expect(page.getByRole('slider',{name:/Sagittal slice/})).toHaveAttribute('max','9');
  await expect(page.getByRole('slider',{name:/Coronal slice/})).toHaveAttribute('max','11');
  await page.getByRole('slider',{name:/Sagittal slice/}).fill('5');
  await page.getByRole('slider',{name:/Coronal slice/}).fill('7');
  await page.getByRole('slider',{name:/Axial slice/}).fill('2');
  await expect(page.getByText(/Crosshair RAS: 19.20, -15.80, 47.00 mm/)).toBeVisible();
});

test('limited browser memory is rejected before binary downloads', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator,'deviceMemory',{value:2}));
  const fixture = await setup(page,{large:true}); await open(page);
  await expect(page.getByRole('alert')).toContainText(/memory budget/);
  expect(fixture.calls.filter(c => /\/(source|mask)$/.test(c.path))).toHaveLength(0);
});

test('unavailable WebGL2 has a useful authenticated-download fallback', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : original.call(this,type,...args); };
  });
  const fixture = await setup(page); await open(page);
  await expect(page.getByRole('alert')).toContainText(/WebGL2 is unavailable/);
  expect(fixture.calls.filter(c => /\/(source|mask)$/.test(c.path))).toHaveLength(0);
});

test('session changes release the image and block continued viewing', async ({page}) => {
  await setup(page); await open(page); await ready(page);
  await page.evaluate(() => { localStorage.setItem('vascuai_token','changed-test-session'); dispatchEvent(new StorageEvent('storage')); });
  await expect(page.getByRole('alert')).toContainText(/session changed/);
  await expect(page.getByRole('slider',{name:/Axial slice/})).toBeDisabled();
});

test('mobile viewer remains accessible and does not overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await setup(page); await open(page); await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations = await new AxeBuilder({page}).include('.volume-viewer').withTags(['wcag2a','wcag2aa']).analyze();
  expect(violations.violations).toEqual([]);
  await page.screenshot({path:'test-results/viewer-mobile.png',fullPage:true});
});

for (const [name, options, message] of [
  ['mismatched geometry',{badGeometry:true}, /geometry do not match/],
  ['changed source checksum',{badChecksum:true}, /source changed during retrieval/],
  ['protected source failure',{status:403}, /Protected volume access failed/],
]) test(`viewer refuses ${name} and provides retry`, async ({page}) => {
  await setup(page, options); await open(page);
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(page.getByRole('button',{name:'Retry viewer'})).toBeVisible();
  await expect(page.getByRole('slider',{name:/Axial slice/})).toBeDisabled();
});

test('closing pending requests and switching runs never restores old content', async ({page}) => {
  const fixture = await setup(page,{slow:true});
  await open(page);
  await expect(page.getByText(/Downloading CT and binary/)).toBeVisible();
  await page.getByRole('button',{name:'Close viewer',exact:true}).click();
  fixture.release();
  await expect(page.getByRole('img',{name:/CT slices/})).toHaveCount(0);
  await page.getByRole('button',{name:`View CT + Segmentation for run ${otherId}`,exact:true}).click();
  await ready(page);
  await expect(page.getByRole('region',{name:`CT and segmentation viewer for run ${otherId}`})).toBeVisible();
});

test('stale history prevents opening and a refresh invalidates an open viewer', async ({page}) => {
  const fixture = await setup(page);
  await open(page); await ready(page);
  fixture.stale();
  await page.getByRole('button',{name:'Refresh history',exact:true}).click();
  await expect(page.getByRole('img',{name:/CT slices/})).toHaveCount(0);
  await expect(page.getByRole('button',{name:`View CT + Segmentation for run ${id}`,exact:true})).toBeDisabled();
});

test('repeated viewer and case navigation releases resources', async ({page}) => {
  const errors = []; page.on('pageerror',e => errors.push(e.message));
  await setup(page);
  for (let i=0; i<3; i++) {
    await open(page); await ready(page);
    await page.getByRole('button',{name:'Close viewer',exact:true}).click();
    await page.goto('/cases/2/analysis');
    await expect(page.getByRole('img',{name:/CT slices/})).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
