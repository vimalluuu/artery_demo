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
    async list(caseId) {
      const { data } = await api.get(casePath(caseId));
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
  };
}
