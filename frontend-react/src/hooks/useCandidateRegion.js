import { useEffect, useRef, useState } from "react";
import { stenosisApi } from "../api/stenosis";
import { prepareRegion } from "../lib/volume-loader";
import { volumeBudget, sameAffine } from "../lib/volume-geometry";
import { addCandidateRegion } from "../lib/niivue-adapter";

export function useCandidateRegion(instance, geometry, { ready, view, localization, selectedId, caseId, enabled }) {
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const volume = useRef(null);
  const currentView = useRef(view);
  useEffect(() => { currentView.current = view; }, [view]);
  const reference = localization?.result.lesions.find(item => item.lesion_id === selectedId)?.candidate_region;
  useEffect(() => {
    if (!ready || !enabled || !reference || !localization || localization.visualization.status !== "supported") return;
    const controller = new AbortController(); const viewer = instance.current; let alive = true;
    (async () => {
      try {
        setError(""); setLoading(true);
        const budget = volumeBudget(geometry.current.shape, navigator.deviceMemory || 8);
        if (budget.voxels * 32 > budget.budgetBytes) throw new Error("The additional region exceeds the browser memory budget; the CT view was retained.");
        const bytes = await stenosisApi.region(caseId, localization.result.analysis_id, selectedId, reference.artifact_id, { signal: controller.signal });
        const decoded = await prepareRegion(bytes, localization.segmentation.metadata, reference.sha256, controller.signal);
        if (!sameAffine(decoded.geometry.affine, geometry.current.affine) || decoded.geometry.shape.some((n, i) => n !== geometry.current.shape[i])) throw new Error("Candidate-region geometry does not match the displayed CT.");
        if (!alive) return;
        const candidate = await addCandidateRegion(viewer, decoded.region, geometry.current.affine, controller.signal);
        if (!alive) { if (viewer.volumes.includes(candidate)) viewer.removeVolume(candidate); return; }
        volume.current = candidate;
        if (currentView.current === "mask3d") viewer.setOpacity(viewer.volumes.indexOf(candidate), 0);
      } catch (failure) { if (alive && !controller.signal.aborted) setError(failure.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => {
      alive = false; controller.abort();
      if (volume.current && viewer.volumes.includes(volume.current)) viewer.removeVolume(volume.current);
      volume.current = null;
    };
    // View changes alter opacity below; they do not redownload/redecode the region.
  }, [ready, enabled, reference, localization, selectedId, caseId, instance, geometry]);
  useEffect(() => {
    if (instance.current && volume.current) instance.current.setOpacity(instance.current.volumes.indexOf(volume.current), view === "mask3d" ? 0 : .6);
  }, [view, instance]);
  return { error: enabled && reference ? error : "", loading: enabled && reference && loading };
}
