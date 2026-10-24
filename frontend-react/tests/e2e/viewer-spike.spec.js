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

test('adapter preserves voxel data and discrete slice filters through redraw and rebuild', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ct,mask}) => {
    const {createVolumeViewer,releaseViewer} = await import('/src/lib/niivue-adapter.js');
    const {inspectVolume} = await import('/src/lib/volume-geometry.js');
    const host = document.createElement('div');
    host.style.cssText = 'width:900px;height:450px;position:relative';
    const canvas = document.createElement('canvas'); host.append(canvas); document.body.append(host);
    const source = new Uint8Array(ct).buffer, labels = new Uint8Array(mask).buffer;
    const geometry = inspectVolume(source);
    const nv = await createVolumeViewer(canvas,{ct:source,mask:labels,geometry},()=>{},new AbortController().signal);
    try {
      const data = () => nv.volumes.map(v => ({values:Array.from(v.img),affine:v.hdr.affine.map(r=>[...r]),dims:[...v.hdr.dims]}));
      const filters = () => {
        const gl = nv.gl, active = gl.getParameter(gl.ACTIVE_TEXTURE);
        const modes = [0,2].map(unit => {
          gl.activeTexture(gl.TEXTURE0+unit);
          return [gl.getTexParameter(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER),gl.getTexParameter(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER)];
        });
        gl.activeTexture(active); return modes;
      };
      const pixels = () => {
        nv.drawScene(); const gl=nv.gl, rgba = new Uint8Array(canvas.width*canvas.height*4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
        let sum=0, magenta=0;
        for(let i=0;i<rgba.length;i+=4) {sum+=rgba[i]+rgba[i+1]+rgba[i+2]; if(rgba[i]>120 && rgba[i+1]<rgba[i]*.7 && rgba[i+2]>80) magenta++;}
        return {sum,magenta};
      };
      const before=data(), modes=[filters()];
      nv.setSliceType(nv.sliceTypeAxial);
      nv.scene.crosshairPos[2]=2.5/8;
      const original=pixels();
      nv.setOpacity(1,0); const hidden=pixels();
      nv.volumes[0].cal_min=0; nv.volumes[0].cal_max=100;
      nv.updateGLVolume(); const windowed=pixels(); modes.push(filters());
      nv.setOpacity(1,.8); const overlay=pixels(); modes.push(filters());
      nv.scene.crosshairPos[2]=5.5/8; nv.drawScene(); modes.push(filters());
      host.style.width='700px'; nv.resizeListener(); modes.push(filters());
      nv.setOpacity(0,0); nv.setSliceType(nv.sliceTypeRender);
      nv.setScale(1.25); nv.setRenderAzimuthElevation(140,25); modes.push(filters());
      nv.setScale(1); nv.setRenderAzimuthElevation(110,10);
      nv.setOpacity(0,1); nv.setSliceType(nv.sliceTypeAxial); modes.push(filters());
      return {before,after:data(),modes,original,hidden,windowed,overlay,labels:[...new Set(nv.volumes[1].img)],range:[nv.volumes[0].cal_min,nv.volumes[0].cal_max],opacity:nv.volumes[1].opacity,world:Array.from(nv.frac2mm(nv.scene.crosshairPos)),glError:nv.gl.getError()};
    } finally {releaseViewer(nv); host.remove();}
  }, {ct:[...syntheticNifti()],mask:[...syntheticNifti({mask:true})]});
  expect(result.after).toEqual(result.before);
  expect(result.labels.sort()).toEqual([0,1]);
  expect(result.modes.every(layers=>layers.every(mode=>mode.every(value=>value===9728)))).toBe(true);
  expect(result.original.magenta).toBeGreaterThan(0);
  expect(result.hidden.magenta).toBe(0);
  expect(result.windowed.sum).not.toBe(result.hidden.sum);
  expect(result.overlay.magenta).toBeGreaterThan(0);
  expect(result.range).toEqual([0,100]);
  expect(result.opacity).toBe(.8);
  expect(result.world.every(Number.isFinite)).toBe(true);
  expect(result.glError).toBe(0);
});
