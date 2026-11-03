import { useCallback, useEffect, useRef, useState } from "react";
import { matchingLesion, validateLocalizationBinding } from "../lib/stenosis-results";
import { navigateToLesion, projectLesionMarkers } from "../lib/lesion-viewer";

export function useLesionLayer(instance, canvas, geometry, { ready, view, location, caseId, parentId, localization, selectedId, onSelect, onSlices }) {
  const [markers, setMarkers] = useState([]), [error, setError] = useState(""), [ambiguous, setAmbiguous] = useState(false);
  const latest = useRef({});
  const validated = useRef(false);
  useEffect(() => { latest.current = { localization, selectedId, onSelect, onSlices, ready }; }, [localization, selectedId, onSelect, onSlices, ready]);
  const onLocation = useCallback(value => {
    const current = latest.current;
    if (!validated.current || !current.ready || !current.localization || current.localization.visualization.status !== "supported") return;
    const match = matchingLesion(current.localization.result.lesions, value.world, current.selectedId);
    setAmbiguous(match.ambiguous);
    if (match.id && match.id !== current.selectedId) current.onSelect?.(match.id);
  }, []);
  const project = useCallback(() => {
    try {
      if (!instance.current || !localization) { validated.current = false; setMarkers([]); return; }
      validateLocalizationBinding(localization, geometry.current, caseId, parentId);
      if (localization.visualization.status !== "supported") throw new Error(localization.visualization.reason);
      validated.current = true;
      setMarkers(view === "mask3d" ? [] : projectLesionMarkers(instance.current, localization.result.lesions, selectedId));
      setError("");
    } catch (failure) { validated.current = false; setMarkers([]); setError(failure.message); }
  }, [instance, localization, view, geometry, caseId, parentId, selectedId]);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(project);
    return () => cancelAnimationFrame(frame);
  }, [ready, location, project]);
  useEffect(() => {
    if (!ready || !localization || !selectedId || !instance.current) return;
    const frame = requestAnimationFrame(() => { try {
      validateLocalizationBinding(localization, geometry.current, caseId, parentId);
      if (localization.visualization.status !== "supported") throw new Error(localization.visualization.reason);
      const lesion = localization.result.lesions.find(item => item.lesion_id === selectedId);
      if (lesion?.location) { latest.current.onSlices?.(); navigateToLesion(instance.current, lesion, geometry.current); }
    } catch (failure) { setError(failure.message); setMarkers([]); } });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, localization, ready, instance, geometry, caseId, parentId]);
  useEffect(() => {
    if (!ready || !canvas.current || !localization) return;
    let frame;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(project); });
    observer.observe(canvas.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ready, canvas, localization, project]);
  return { markers, error, ambiguous, onLocation };
}
