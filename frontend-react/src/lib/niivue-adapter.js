// Keep the pinned viewer API in one place. No unauthenticated library fetches.
const released = new WeakSet();
export function releaseViewer(viewer) {
  if (!viewer || released.has(viewer)) return;
  released.add(viewer);
  viewer.onLocationChange = () => {};
  viewer.onAzimuthElevationChange = () => {};
  viewer.onZoom3DChange = () => {};
  try { viewer.cleanup(); } // Library event controllers and resize/mutation observers.
  catch { /* Continue releasing buffers and GPU resources if library cleanup fails. */ }
  viewer.volumes = [];
  viewer.back = null;
  viewer.overlays = [];
  // cleanup() in 0.69 does not free all GPU objects. Explicitly release context.
  try { viewer.gl?.getExtension('WEBGL_lose_context')?.loseContext(); }
  catch { /* attachToCanvas can fail before a GL context exists. */ }
}

export function graphicsCapabilities(shape) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 is unavailable. Use the authenticated downloads in a desktop imaging application.');
  try {
    const max3D = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    if (shape.some(dim => dim > max3D)) throw new Error('Volume dimensions exceed this GPU’s 3D texture limit. Use the original downloads.');
    return { max3D };
  } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

export async function createVolumeViewer(canvas, pair, onLocation, signal) {
  const { Niivue, NVImage } = await import('@niivue/niivue');
  if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
  const viewer = new Niivue({
    dragAndDropEnabled: false, isNearestInterpolation: true,
    isRadiologicalConvention: false, multiplanarShowRender: 0, // SHOW_RENDER.NEVER
    dragMode: 0, // DRAG_MODE.none: window/level stays in the labelled controls.
    isForceMouseClickToVoxelCenters: true,
    isColorbar: false, showLegend: false, logLevel: 'error',
    isCornerOrientationText: true, showAllOrientationMarkers: true,
  });
  try {
    await viewer.attachToCanvas(canvas, false);
    if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
    const ct = await NVImage.new(pair.ct, 'source_ct.nii');
    pair.ct = null;
    if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
    const mask = await NVImage.new(pair.mask, 'prediction_mask.nii');
    pair.mask = null;
    if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
    // NiiVue otherwise prefers qform when qform_code > sform_code, unlike nibabel.
    ct.setAffine(pair.geometry.affine);
    mask.setAffine(pair.geometry.affine);
    ct.cal_min = -200; ct.cal_max = 800;
    mask.setColormapLabel({ R: [0, 255], G: [0, 64], B: [0, 180], A: [0, 255], I: [0, 1], labels: ['Background', 'Predicted artery'] });
    mask.opacity = .55;
    viewer.addVolume(ct);
    viewer.addVolume(mask);
    viewer.setSliceType(viewer.sliceTypeMultiplanar);
    // Even-sized axes have no voxel centre at fraction 0.5. Keep slider indices,
    // displayed world position and sampled nearest-neighbour voxel consistent.
    viewer.scene.crosshairPos = Array.from(ct.dimsRAS).slice(1, 4).map(n => (Math.floor(n / 2) + .5) / n);
    const notify = () => onLocation({
      fraction: Array.from(viewer.scene.crosshairPos),
      world: Array.from(viewer.frac2mm(viewer.scene.crosshairPos)).slice(0, 3),
      dimensions: Array.from(ct.dimsRAS).slice(1, 4),
      spacing: pair.geometry.spacing,
    });
    viewer.onLocationChange = notify;
    viewer.drawScene();
    notify();
    if (viewer.gl.getError() !== viewer.gl.NO_ERROR) throw new Error('The GPU could not allocate this volume. Close other GPU-heavy tabs or use the downloads.');
    return viewer;
  } catch (error) { releaseViewer(viewer); throw error; }
}
