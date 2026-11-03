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

export async function addCandidateRegion(viewer, buffer, affine, signal) {
  const { NVImage } = await import('@niivue/niivue');
  if (signal.aborted) throw new DOMException('Region cancelled.', 'AbortError');
  const region = await NVImage.new(buffer, 'candidate_region.nii');
  if (signal.aborted) throw new DOMException('Region cancelled.', 'AbortError');
  region.setAffine(affine);
  region.setColormapLabel({ R: [0, 0], G: [0, 255], B: [0, 128], A: [0, 255], I: [0, 1], labels: ['Background', 'Supplied candidate region'] });
  region.opacity = .6;
  try { viewer.addVolume(region); return region; }
  catch (error) {
    // Insertion can attach a volume before GPU allocation fails. The hook has
    // not received ownership yet, so this adapter must remove that partial layer.
    try { if (viewer.volumes.includes(region)) viewer.removeVolume(region); }
    catch { /* Preserve the insertion error; CT teardown handles context loss. */ }
    throw error;
  }
}

export async function addAttributionVolume(viewer, buffer, affine, values, signal) {
  const {NVImage}=await import('@niivue/niivue');
  if(signal.aborted)throw new DOMException('Attribution cancelled.','AbortError');
  // Public NiiVue 0.69 APIs/properties, verified in installed source/types.
  // Zero (or the declared non-negative minimum) is transparent. No data rewrite.
  viewer.addColormap('vascuai-attribution-positive',{R:[0,100,255],G:[0,35,112],B:[0,0,0],A:[0,255,255],I:[0,1,255]});
  viewer.addColormap('vascuai-attribution-negative',{R:[0,25,80],G:[0,50,100],B:[0,150,255],A:[0,255,255],I:[0,1,255]});
  const image=await NVImage.new(buffer,'model_attribution.nii');
  if(signal.aborted)throw new DOMException('Attribution cancelled.','AbortError');
  image.setAffine(affine);image.colormap='vascuai-attribution-positive';image.colormapNegative=values.value_type==='signed'?'vascuai-attribution-negative':'';
  image.cal_min=values.value_type==='signed'?0:values.expected_range[0];image.cal_max=values.expected_range[1];
  image.cal_minNeg=values.expected_range[0];image.cal_maxNeg=0;image.colormapType=0;image.colorbarVisible=false;image.opacity=0;
  try{viewer.addVolume(image);return image;}
  catch(error){try{if(viewer.volumes.includes(image))viewer.removeVolume(image);}catch{/* context may already be lost */}throw error;}
}
