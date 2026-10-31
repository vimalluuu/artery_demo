import { useCallback, useEffect, useRef, useState } from "react";
import { createAnalysisTracker } from "../lib/analysis-tracker.js";

export function useAnalysisTracker(load, isActive) {
  const ref = useRef(null);
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    const tracker = createAnalysisTracker({ load, isActive, onState: setState });
    ref.current = tracker;
    tracker.refresh();
    return () => { tracker.stop(); ref.current = null; };
  }, [load, isActive]);
  const refresh = useCallback(options => ref.current?.refresh(options), []);
  return { ...state, refresh };
}
