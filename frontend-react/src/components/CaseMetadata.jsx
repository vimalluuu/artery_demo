import { Metadata } from "./ui";
export function ImageMetadata({ metadata }) {
  return (
    <Metadata
      items={
        metadata
          ? [
              ["Format", metadata.format],
              ["Dimensions", `${metadata.width} × ${metadata.height} px`],
              ["Channels", metadata.channels],
              ["Pixel type", metadata.pixel_dtype],
              [
                "Stored file size",
                `${(metadata.file_size_bytes / 1024 / 1024).toFixed(2)} MB`,
              ],
            ]
          : [["Image metadata", "No image uploaded"]]
      }
    />
  );
}
export function VolumeMetadata({ metadata }) {
  const units =
    { 1: "m", 2: "mm", 3: "µm" }[metadata?.xyzt_units & 7] ||
    "units not specified";
  return (
    <Metadata
      items={
        metadata
          ? [
              ["Format", `NIfTI-${metadata.nifti_version}`],
              ["Dimensionality", `${metadata.ndim}D`],
              [
                "Shape",
                [
                  metadata.shape_x,
                  metadata.shape_y,
                  metadata.shape_z,
                  metadata.shape_t,
                ]
                  .filter((v) => v != null)
                  .join(" × "),
              ],
              [
                "Voxel spacing",
                `${[metadata.voxel_spacing_x, metadata.voxel_spacing_y, metadata.voxel_spacing_z].join(" × ")} ${units}`,
              ],
              ["Voxel data type", metadata.voxel_dtype],
              [
                "qform / sform",
                `${metadata.qform_code} / ${metadata.sform_code}`,
              ],
              [
                "Stored file size",
                `${(metadata.file_size_bytes / 1024 / 1024).toFixed(2)} MB`,
              ],
            ]
          : [["Volume metadata", "No volume uploaded"]]
      }
    />
  );
}
