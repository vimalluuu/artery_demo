import { volumeBudget } from './volume-geometry.js';

export function prepareVolumes(ct, mask, metadata, { signal, onPhase } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Viewer closed.', 'AbortError'));
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) return Promise.reject(new Error('Source verification requires HTTPS or localhost. Open the application through its secure URL.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/volume.worker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Viewer closed.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.phase) onPhase?.(data.phase);
      else finish(data.error ? new Error(data.error) : null, data);
    };
    worker.onerror = () => finish(new Error('Volume decoding failed. Try reopening the viewer or use the downloads.'));
    worker.postMessage({ ct, mask, metadata }, [ct, mask]);
  });
}

// A caller-owned AbortSignal is required so navigation can cancel all work.
export async function loadViewerPair(api, caseId, result, { signal, onPhase, onProgress } = {}) {
  if (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean') throw new TypeError('loadViewerPair requires an AbortSignal.');
  if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) throw new Error('Source verification requires HTTPS or localhost. Open the application through its secure URL.');
  volumeBudget(result.metadata?.shape, navigator.deviceMemory || 8);
  const token = localStorage.getItem('vascuai_token');
  const verifyCurrent = async () => {
    if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
    const runs = await api.list(caseId, { signal });
    if (signal.aborted) throw new DOMException('Viewer closed.', 'AbortError');
    if (token !== localStorage.getItem('vascuai_token')) throw new Error('Your session changed. Reopen the viewer after signing in.');
    const current = runs.find(r => r.id === result.id && r.case_id === Number(caseId));
    if (!current || current.stale || current.metadata?.source_sha256 !== result.metadata.source_sha256) throw new Error('This result is stale or no longer belongs to the current case. Refresh history.');
  };
  await verifyCurrent();
  onPhase('Downloading CT and binary segmentation…');
  const [ct, mask] = await Promise.all(['source', 'mask'].map(artifact => api.loadVolume(caseId, result.id, artifact, { signal, onProgress: progress => onProgress?.(artifact, progress) })));
  onPhase('Verifying the source checksum…');
  const pair = await prepareVolumes(ct, mask, result.metadata, { signal, onPhase });
  // Covers replacement while the bytes were being fetched/decoded.
  await verifyCurrent();
  return pair;
}
