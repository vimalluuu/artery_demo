export function segmentationEligibility(item, volume) {
  if (!item.hasVolume) return "Upload a three-dimensional CT NIfTI volume first. A 2D image cannot be segmented by this model.";
  if (!["CTA", "CT Angiography"].includes(item.modality)) return "This model supports CT only. Confirm the case modality as CTA or CT Angiography in the case overview.";
  if (!volume) return "Volume metadata is unavailable. Refresh the input check or inspect the uploaded study.";
  if (volume.ndim !== 3) return "Only three-dimensional CT volumes can be segmented. 4D inference is not supported.";
  return "";
}

export function segmentationError(error, action = "run") {
  const status = error.response?.status;
  const detail = error.message || "The request could not be completed.";
  if (status === 409) return `${detail} Refresh case inputs and history before retrying.`;
  if (status === 503) return `${detail} If the worker is busy, retry after the active run finishes. A missing model or runtime requires your administrator.`;
  if (status === 403) return `${detail} Your account does not have access to this action.`;
  if (action === "run" && (!status || status >= 500)) return `${detail} The server may still finish. Refresh history before retrying; leaving this page does not cancel server processing.`;
  return detail;
}

export function saveArtifact({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
