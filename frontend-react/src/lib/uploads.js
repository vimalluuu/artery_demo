import { IMAGING_GUIDANCE } from "../constants/imaging-guidance.js";
export function validateUpload(file, type) {
  if (!file) return "Select a file to continue.";
  const name = file.name.toLowerCase();
  if (type === "volume") {
    if (!name.endsWith(".nii") && !name.endsWith(".nii.gz"))
      return "Choose a NIfTI volume (.nii or .nii.gz). DICOM is not supported.";
    const max = name.endsWith(".nii.gz")
      ? IMAGING_GUIDANCE.volumetric.compressedLimitMb
      : IMAGING_GUIDANCE.volumetric.rawLimitMb;
    if (file.size > max * 1024 * 1024)
      return `This file exceeds the ${max.toLocaleString()} MB upload limit.`;
  } else {
    if (
      !IMAGING_GUIDANCE.twoDimensional.extensions.some((ext) =>
        name.endsWith(ext),
      )
    )
      return "Choose a PNG, JPEG, or TIFF image.";
    if (file.size > IMAGING_GUIDANCE.twoDimensional.maxSizeMb * 1024 * 1024)
      return "This image exceeds the 20 MB upload limit.";
  }
  if (file.size === 0) return "This file is empty. Choose a different file.";
  return "";
}
