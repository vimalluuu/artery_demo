import { validateLocation } from "./stenosis-results.js";

export function navigateToLesion(viewer, lesion, geometry) {
  validateLocation(lesion.location, geometry);
  if (!lesion.location) throw new Error("This candidate has no supplied localization.");
  const fraction = viewer.mm2frac(lesion.location.world_coordinates, 0, true);
  if (Array.from(fraction).some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error("The candidate falls outside the displayed CT.");
  viewer.scene.crosshairPos = fraction;
  viewer.drawScene();
  viewer.onLocationChange();
}

export function projectLesionMarkers(viewer, lesions, selectedId) {
  // Pinned NiiVue 0.69.0: signatures and implementation verified in installed
  // build/niivue/index.{d.ts,js}. Projection helpers are marked @internal by the
  // library; keep their use isolated and regression-tested on actual WebGL.
  if (typeof viewer.frac2canvasPosWithTile !== "function" || typeof viewer.canvasPos2frac !== "function") throw new Error("This viewer version cannot safely project lesion markers.");
  const dims = Array.from(viewer.volumes[0].dimsRAS).slice(1, 4);
  const points = [];
  for (const lesion of lesions) {
    if (!lesion.location) continue;
    const frac = Array.from(viewer.mm2frac(lesion.location.world_coordinates, 0, true));
    for (const [plane, axis, name] of [[viewer.sliceTypeAxial, 2, "Axial"], [viewer.sliceTypeCoronal, 1, "Coronal"], [viewer.sliceTypeSagittal, 0, "Sagittal"]]) {
      if (Math.floor(frac[axis] * dims[axis]) !== Math.floor(viewer.scene.crosshairPos[axis] * dims[axis])) continue;
      const projected = viewer.frac2canvasPosWithTile(frac, plane);
      if (!projected) continue;
      // Refuse the library's edge-clamping fallback: a roundtrip must agree in
      // both in-plane axes. Never draw off-slice points as if on the CT plane.
      const inverse = viewer.canvasPos2frac(projected.pos);
      if (!inverse || Array.from(inverse).some((n, i) => i !== axis && (!Number.isFinite(n) || Math.abs(n - frac[i]) > 1e-4))) continue;
      const [x, y] = projected.pos;
      if (x < 0 || y < 0 || x > viewer.canvas.width || y > viewer.canvas.height) continue;
      points.push({ id: lesion.lesion_id, plane: name, x: x / viewer.canvas.width * 100,
        y: y / viewer.canvas.height * 100, selected: lesion.lesion_id === selectedId });
    }
  }
  return points;
}
