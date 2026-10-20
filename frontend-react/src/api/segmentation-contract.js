// Reuse the authenticated client; construct known routes instead of following
// server-supplied URLs with bearer credentials or duplicating its API base.
export function parseThreshold(value) {
  const threshold = Number(value);
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Enter a threshold between 0 and 1.");
  }
  return threshold;
}

function casePath(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error("Invalid case ID.");
  return `/cases/${Number(id)}/segmentations`;
}

export function createSegmentationApi(api) {
  const activeRuns = new Set();
  return {
    async list(caseId, { signal } = {}) {
      const { data } = await api.get(casePath(caseId), signal ? { signal } : undefined);
      if (!Array.isArray(data)) throw new Error("Unexpected segmentation history response.");
      return data;
    },
    async run(caseId, threshold) {
      const body = threshold === undefined ? {} : { threshold: parseThreshold(threshold) };
      const path = casePath(caseId);
      if (activeRuns.has(path)) throw new Error("A segmentation request is already active for this case. Wait for it to finish and refresh history.");
      activeRuns.add(path);
      try {
        const response = await api.post(path, body, { timeout: 0 });
        if (response.status !== 201) throw new Error("The server did not confirm a saved segmentation. Refresh history before retrying.");
        return response.data;
      } finally { activeRuns.delete(path); }
    },
    async download(caseId, resultId, artifact) {
      if (!["mask", "probabilities"].includes(artifact) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resultId)) {
        throw new Error("Invalid segmentation artifact.");
      }
      try {
        const response = await api.get(`${casePath(caseId)}/${resultId}/${artifact}`, {
          responseType: "blob", headers: { Accept: "application/gzip, application/octet-stream" },
        });
        const type = response.headers?.["content-type"] || response.data?.type || "";
        if (response.status !== 200 || !(response.data instanceof Blob) || !response.data.size || /json|html|text\//i.test(type)) {
          throw new Error("The server did not return a medical-volume artifact. No file was saved.");
        }
        return { blob: response.data, filename: `case-${Number(caseId)}-segmentation-${resultId}-${artifact}.nii.gz` };
      } catch (error) {
        // HTTP error bodies are Blobs too. Decode them instead of saving as NIfTI.
        if (error.response?.data instanceof Blob) {
          try {
            const body = JSON.parse(await error.response.data.text());
            if (typeof body.detail === "string") error.message = body.detail;
            if (Array.isArray(body.detail)) error.message = body.detail.map((entry) => entry.msg).join("; ");
          } catch { /* Retain the HTTP error if the body is not JSON. */ }
        }
        throw error;
      }
    },
    async loadVolume(caseId, resultId, artifact, { signal, onProgress } = {}) {
      if (!["source", "mask"].includes(artifact) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(resultId)) throw new Error("Invalid viewer artifact.");
      const limit = 512 * 1024 * 1024;
      const bounded = new AbortController();
      const cancel = () => bounded.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      let exceeded = false;
      try {
        const response = await api.get(`${casePath(caseId)}/${resultId}/${artifact}`, {
          responseType: "arraybuffer", signal: bounded.signal,
          headers: { Accept: "application/gzip, application/octet-stream" },
          onDownloadProgress: event => {
            if (event.loaded > limit || event.total > limit) { exceeded = true; bounded.abort(); return; }
            onProgress?.({ loaded: event.loaded, total: event.total || null });
          },
        });
        if (bounded.signal.aborted) throw new DOMException("Viewer request cancelled.", "AbortError");
        const type = response.headers?.["content-type"] || "";
        if (response.status !== 200 || !(response.data instanceof ArrayBuffer) || !response.data.byteLength || response.data.byteLength > limit || /json|html|text\//i.test(type)) throw new Error("The server did not return a supported medical volume.");
        return response.data;
      } catch (error) {
        if (exceeded) throw new Error("The download exceeds the browser memory limit. Use authenticated downloads in a desktop imaging application.");
        if (error.response?.data instanceof ArrayBuffer) {
          try {
            const body = JSON.parse(new TextDecoder().decode(error.response.data));
            if (typeof body.detail === "string") error.message = body.detail;
          } catch { /* Retain the HTTP error. */ }
        }
        throw error;
      } finally { signal?.removeEventListener("abort", cancel); }
    },
  };
}
