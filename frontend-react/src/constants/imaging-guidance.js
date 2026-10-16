/**
 * imaging-guidance.js
 *
 * Single source of truth for frontend imaging format specifications and guidance copy,
 * aligned with backend upload constraints in app/core/config.py and app/services/volume_ingestion.py.
 */

export const IMAGING_GUIDANCE = {
  twoDimensional: {
    formats: ['PNG', 'JPG/JPEG', 'TIFF'],
    extensions: ['.png', '.jpg', '.jpeg', '.tif', '.tiff'],
    maxSizeMb: 20,
    maxDimensionPx: 8192,
    badgeText: 'PNG, JPEG, TIFF · Max 20 MB · 8192 px',
    description: 'PNG, JPG/JPEG, TIFF — 20 MB maximum, 8,192 pixels per side.',
  },
  volumetric: {
    formats: ['.nii', '.nii.gz'],
    rawLimitMb: 2000,
    compressedLimitMb: 512,
    decompressedLimitMb: 2000,
    dropzoneText: '.nii (max 2,000 MB) or .nii.gz (max 512 MB) · 3D / 4D volumes',
    headerBadgeText: 'NIfTI · upload & metadata only — segmentation & inference deferred',
    metadataDisclaimer:
      'NIfTI header metadata extraction is supported for 3D and 4D volumes. 3D vessel segmentation, ML inference, and stenosis quantification are deferred / not yet implemented.',
    pageLocation: 'Supported on the Case Details page',
    description:
      'Supported on the Case Details page: raw .nii (max 2,000 MB) and compressed .nii.gz (max 512 MB). 3D and 4D volumes supported.',
  },
  unsupported: {
    dicom: {
      status: 'Not yet supported by the backend.',
      action: 'Convert DICOM to NIfTI (.nii / .nii.gz) or 2D image formats before upload.',
    },
  },
};
