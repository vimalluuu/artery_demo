import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installApi } from './fixtures';

// Explicit opt-in, de-identified validation data only; never an app DB or test set.
const paths = {
  ct: process.env.VASCULAI_VIEWER_REAL_CT,
  mask: process.env.VASCULAI_VIEWER_REAL_MASK,
  metadata: process.env.VASCULAI_VIEWER_REAL_METADATA,
};
test.use({ launchOptions: { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args:['--enable-precise-memory-info','--js-flags=--expose-gc'] } });

test('opt-in supplied validation volume: orthogonal and actual 3D mask resource smoke', async ({page}) => {
  test.skip(!Object.values(paths).every(Boolean), 'Set explicit de-identified validation CT/mask/metadata paths.');
  test.setTimeout(180_000);
  const metadata = JSON.parse(await readFile(paths.metadata,'utf8'));
  expect(metadata.shape).toEqual([512,512,217]);
  const id = '32345678-1234-4567-890a-123456789abc';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installApi(page,{role:'Researcher'});
  await page.route('**/api/v1/cases/1/segmentations**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/segmentations')) return route.fulfill({json:[{id,case_id:1,created_at:'2026-10-19T00:00:00Z',stale:false,metadata}]});
    return route.fulfill({path:route.request().url().endsWith('/source') ? paths.ct : paths.mask,contentType:'application/gzip'});
  });
  await page.goto('/cases/1/analysis');
  const cdp = await page.context().newCDPSession(page);
  const baseline = await cdp.send('Runtime.getHeapUsage');
  const samples = [];
  let sampling = false;
  const timer = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try { samples.push(await cdp.send('Runtime.getHeapUsage')); } catch { /* Page closure. */ }
    finally { sampling = false; }
  },500);
  try {
    const started = Date.now();
    await page.getByRole('button',{name:`View CT + Segmentation for run ${id}`,exact:true}).click();
    await expect(page.getByText(/Voxel spacing \(original axes\):/)).toBeVisible({timeout:120_000});
    const readyMilliseconds = Date.now()-started;
    await page.screenshot({path:'test-results/validation-851-slices.png',fullPage:true});
    const ortho = await cdp.send('Runtime.getHeapUsage');
    await page.getByLabel('View',{exact:true}).selectOption('mask3d');
    await page.getByRole('button',{name:'Rotate 3D right'}).click();
    await page.getByRole('img',{name:/CT slices/}).screenshot({path:'test-results/validation-851-mask-3d.png'});
    const threeD = await cdp.send('Runtime.getHeapUsage');
    const capabilities = await page.getByRole('img',{name:/CT slices/}).evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {max3DTextureSize:gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),glError:gl.getError(),
        renderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'not exposed',
        deviceMemory:navigator.deviceMemory || null};
    });
    expect(capabilities.glError).toBe(0);
    await page.getByLabel('View',{exact:true}).selectOption('slices');
    await page.getByRole('button',{name:'Close viewer',exact:true}).click();
    await expect(page.getByRole('img',{name:/CT slices/})).toHaveCount(0);
    await cdp.send('HeapProfiler.collectGarbage');
    const closed = await cdp.send('Runtime.getHeapUsage');
    const {writeFile} = await import('node:fs/promises');
    await writeFile('test-results/validation-851-viewer-resources.json',JSON.stringify({
      shape:metadata.shape,checkpoint_sha256:metadata.checkpoint_sha256,
      readyMilliseconds,baseline,ortho,threeD,closed,samples,capabilities,
      note:'Browser heap/backing storage samples; GPU memory is not directly exposed. Isolated HTTP fixtures serve original de-identified validation artifacts; this is not a live application-database run.'
    },null,2));
    expect(errors).toEqual([]);
    await cdp.detach();
  } finally { clearInterval(timer); }
});
