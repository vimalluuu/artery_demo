import { test, expect } from '@playwright/test';
import { syntheticNifti } from './nifti-fixture';

test('NiiVue 0.69 spike: real WebGL slices, anisotropic flipped affine, labels and cleanup', async ({ page }) => {
  await page.goto('/');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const result = await page.evaluate(async ({ ct, mask }) => {
    const { Niivue, NVImage } = await import('/node_modules/@niivue/niivue/dist/index.js');
    const host = document.createElement('div');
    host.style.cssText = 'width:900px;height:450px;position:relative';
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    document.body.appendChild(host);
    const nv = new Niivue({ dragAndDropEnabled: false, isNearestInterpolation: true, multiplanarShowRender: 0, logLevel: 'error' });
    try {
      await nv.attachToCanvas(canvas, false);
      const background = await NVImage.new(new Uint8Array(ct).buffer, 'synthetic-ct.nii');
      const labels = await NVImage.new(new Uint8Array(mask).buffer, 'synthetic-mask.nii');
      labels.setColormapLabel({ R: [0, 255], G: [0, 60], B: [0, 180], A: [0, 255], I: [0, 1], labels: ['Background', 'Prediction'] });
      nv.addVolume(background);
      nv.addVolume(labels);
      nv.setSliceType(nv.sliceTypeMultiplanar);
      nv.drawScene();
      const world = background.vox2mm([3, 4, 2], background.hdr.affine.flat());
      const maskWorld = labels.vox2mm([3, 4, 2], labels.hdr.affine.flat());
      const pixel = new Uint8Array(canvas.width * canvas.height * 4);
      nv.gl.readPixels(0, 0, canvas.width, canvas.height, nv.gl.RGBA, nv.gl.UNSIGNED_BYTE, pixel);
      const answer = { world: Array.from(world), maskWorld: Array.from(maskWorld),
        dims: background.hdr.dims.slice(1, 4), tiles: nv.screenSlices.length,
        nonBlack: pixel.some((v, i) => i % 4 !== 3 && v > 0),
        overlayVisible: pixel.some((v, i) => i % 4 === 0 && v > 120 && pixel[i + 1] < v * .7 && pixel[i + 2] > 80),
        glError: nv.gl.getError(),
        sliceTypes: [nv.sliceTypeAxial, nv.sliceTypeCoronal, nv.sliceTypeSagittal].map(type => { nv.setSliceType(type); nv.drawScene(); return nv.screenSlices.length; }) };
      nv.cleanup();
      nv.volumes = [];
      nv.gl.getExtension('WEBGL_lose_context')?.loseContext();
      host.remove();
      return answer;
    } finally { nv.cleanup(); host.remove(); }
  }, { ct: [...syntheticNifti()], mask: [...syntheticNifti({ mask: true })] });
  expect(result.dims).toEqual([12, 10, 8]);
  expect(result.tiles).toBe(3);
  expect(result.sliceTypes).toEqual([1, 1, 1]);
  expect(result.nonBlack).toBe(true);
  expect(result.overlayVisible).toBe(true);
  expect(result.glError).toBe(0);
  expect(result.world).toEqual(result.maskWorld);
  expect(result.world[0]).toBeCloseTo(21.9, 4);
  expect(result.world[1]).toBeCloseTo(-8.2, 4);
  expect(result.world[2]).toBeCloseTo(47, 4);
  expect(errors).toEqual([]);
});

test('permuted affine coordinate roundtrip matches voxel centres', async ({page}) => {
  await page.goto('/');
  const input = syntheticNifti({affine:[[0,-1.2,0,24],[-.7,0,0,-13],[0,0,2.5,42],[0,0,0,1]]});
  const result = await page.evaluate(async data => {
    const { NVImage } = await import('/node_modules/@niivue/niivue/dist/index.js');
    const volume = await NVImage.new(new Uint8Array(data).buffer,'permuted.nii');
    return { matrix:Array.from(volume.matRAS),
      world:Array.from(volume.vox2mm([5,7,2],volume.matRAS)),
      frac:Array.from(volume.convertFrac2MM([.55,7.5/12,2.5/8],true)),
      ortho:Array.from(volume.convertFrac2MM([.55,7.5/12,2.5/8],false)),
      dims:volume.dimsRAS };
  }, [...input]);
  expect(result.world[0]).toBeCloseTo(19.2,4);
  expect(result.frac[0]).toBeCloseTo(19.2,4);
  expect(result.ortho[0]).toBeCloseTo(19.2,4);
});
