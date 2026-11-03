// One request/timer per mounted tracker. Failed refreshes retain valid history.
export function createAnalysisTracker({ load, isActive, onState, interval = 5000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let stopped = false, pending = null, timer, again = false;
  let state = { data: null, loading: true, error: null };
  const controller = new AbortController();
  const emit = next => { if (!stopped) { state = { ...state, ...next }; onState(state); } };
  function refresh({ afterCurrent = false } = {}) {
    if (stopped) return Promise.resolve();
    clearTimer(timer); timer = undefined;
    if (pending) { again ||= afterCurrent; return pending; }
    emit({ loading: true });
    pending = Promise.resolve().then(() => {
      if (!stopped) return load(controller.signal);
    }).then(data => { if (!stopped) emit({ data, loading: false, error: null }); })
      .catch(error => { if (!stopped) emit({ loading: false, error }); })
      .finally(() => {
        pending = null;
        if (stopped) return;
        if (again) { again = false; refresh(); }
        else if (state.data && isActive(state.data)) timer = setTimer(refresh, interval);
      });
    return pending;
  }
  return {
    refresh,
    stop() { stopped = true; controller.abort(); clearTimer(timer); },
  };
}

export const activeJob = job => ["queued", "running"].includes(job.status);
export const activeHistory = history => history.items.some(activeJob);

// Persist an uncertain submission's identity across navigation in this tab.
// It contains only logical IDs/hashes, never a bearer token or image payload.
export function requestKey(storage, userId, source, newKey = () => crypto.randomUUID()) {
  const slot = `vascuai_stenosis_request_${userId}_${source.case_id}_${source.parent_segmentation_result_id}_${source.source_sha256}`;
  const existing = storage.getItem(slot);
  if (existing) return existing;
  const key = newKey(); storage.setItem(slot, key); return key;
}
