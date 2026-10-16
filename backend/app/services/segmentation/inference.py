"""Checkpoint-compatible sliding-window inference and a standalone NIfTI CLI.

Adapted from the supplied 2026-10-16 handoff. No resampling, reorientation,
training, augmentation, postprocessing, or clinical interpretation is applied.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import time

import nibabel as nib
import numpy as np
import torch

from app.services.volume_ingestion import (
    MAX_UNCOMPRESSED_BYTES, MAX_VOXEL_COUNT, VolumeIngestionError,
    validate_nifti_extension, validate_nifti_file,
)
from .model import SmallUNet3D
from app.services.source_fingerprint import file_version, source_sha256 as cached_source_sha256

PATCH = (64, 64, 64)
STRIDE = 32
LIMITATION = "Experimental research segmentation; not clinically validated. No stenosis, severity, confidence, or clinical findings are implemented."


class InferenceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def select_device(name: str):
    if name not in {"auto", "cpu", "cuda"}:
        raise InferenceError("Device must be auto, cpu, or cuda.")
    if name == "cuda" and not torch.cuda.is_available():
        raise InferenceError("CUDA was requested but is unavailable.", 503)
    return torch.device("cuda" if name == "auto" and torch.cuda.is_available() else "cpu" if name == "auto" else name)


def load_model(checkpoint_path: Path, device):
    if not checkpoint_path.is_file():
        raise InferenceError("Model checkpoint is missing; configure VASCULAI_MODEL_CHECKPOINT.", 503)
    try:
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        if not isinstance(checkpoint, dict) or checkpoint.get("base_channels", 8) != 8:
            raise ValueError("Wrong checkpoint architecture")
        if tuple(checkpoint.get("patch_size", PATCH)) != PATCH:
            raise ValueError("Wrong checkpoint patch size")
        model = SmallUNet3D(base=8)
        model.load_state_dict(checkpoint["model_state_dict"], strict=True)
        if sum(p.numel() for p in model.parameters()) != 85_177:
            raise ValueError("Wrong parameter count")
        if any(not torch.isfinite(value).all() for value in model.state_dict().values()):
            raise ValueError("Non-finite weights")
        model = model.to(device).eval()
        return model, checkpoint.get("step")
    except Exception as exc:
        raise InferenceError("Checkpoint could not be loaded strictly as SmallUNet3D (base channels 8).", 503) from exc


def preprocess_ct(raw):
    image = np.asarray(raw, dtype=np.float32).copy()
    if image.ndim != 3 or any(dim < 1 for dim in image.shape):
        raise InferenceError("Inference requires a three-dimensional CT volume; 4D is not supported.")
    if not np.isfinite(image).all():
        raise InferenceError("CT voxel values must all be finite.")
    np.clip(image, -200.0, 800.0, out=image)
    image += 200.0
    image /= 1000.0
    return image


def sliding_starts(length, patch_size=64, stride=32):
    if length <= patch_size:
        return [0]
    starts = list(range(0, length - patch_size + 1, stride))
    final_start = length - patch_size
    if starts[-1] != final_start:
        starts.append(final_start)
    return starts


def predict_volume(model, image, device, batch_size=1, progress=None):
    if image.ndim != 3 or not np.isfinite(image).all():
        raise InferenceError("Expected a finite three-dimensional preprocessed volume.")
    if not 1 <= batch_size <= 16:
        raise InferenceError("Batch size must be between 1 and 16.")
    original_shape = image.shape
    padding = [(0, max(0, PATCH[i] - image.shape[i])) for i in range(3)]
    if any(right > 0 for _, right in padding):
        image = np.pad(image, padding, mode="constant", constant_values=0)
    axes = [sliding_starts(image.shape[i]) for i in range(3)]
    coordinates = list(itertools.product(*axes))
    probability_sum = np.zeros(image.shape, dtype=np.float32)
    coverage_count = np.zeros(image.shape, dtype=np.uint16)
    model.eval()
    with torch.inference_mode():
        for offset in range(0, len(coordinates), batch_size):
            batch_coords = coordinates[offset:offset + batch_size]
            patches = [image[i:i+64, j:j+64, k:k+64] for i, j, k in batch_coords]
            batch = torch.from_numpy(np.stack(patches)).unsqueeze(1).to(device)
            logits = model(batch)
            if tuple(logits.shape) != (len(batch_coords), 1, *PATCH) or not torch.isfinite(logits).all():
                raise InferenceError("Model produced invalid segmentation logits.", 500)
            probabilities = torch.sigmoid(logits).squeeze(1).float().cpu().numpy()
            for (i, j, k), patch_prob in zip(batch_coords, probabilities):
                region = (slice(i, i+64), slice(j, j+64), slice(k, k+64))
                probability_sum[region] += patch_prob
                coverage_count[region] += 1
            if progress:
                progress(min(offset + batch_size, len(coordinates)), len(coordinates))
    if np.any(coverage_count == 0):
        raise InferenceError("Inference did not cover every voxel.", 500)
    probability_sum /= coverage_count
    crop = tuple(slice(0, dim) for dim in original_shape)
    return probability_sum[crop]


def load_volume(path: Path, max_voxels=MAX_VOXEL_COUNT, max_bytes=MAX_UNCOMPRESSED_BYTES):
    if not path.is_file():
        raise InferenceError("Input volume is missing from storage.", 404)
    try:
        props = validate_nifti_file(path, validate_nifti_extension(path.name),
                                    max_uncompressed_bytes=max_bytes, max_voxels=max_voxels)
        if props.ndim != 3:
            raise InferenceError("Inference requires a three-dimensional CT volume; 4D is not supported.")
        image = nib.load(str(path))
        raw = image.get_fdata(dtype=np.float32, caching="unchanged")
        if not np.isfinite(raw).all():
            raise InferenceError("Volume voxel values must all be finite.")
        return image, raw
    except InferenceError:
        raise
    except (VolumeIngestionError, OSError, ValueError, EOFError, nib.filebasedimages.ImageFileError) as exc:
        raise InferenceError("Invalid NIfTI volume: " + str(exc) if isinstance(exc, VolumeIngestionError) else "NIfTI volume could not be decoded.") from exc


def save_like(source, data, path: Path, dtype):
    header = source.header.copy()
    header.set_data_dtype(dtype)
    header.set_slope_inter(1.0, 0.0)
    header["cal_min"] = 0
    header["cal_max"] = 1
    # Keep NIfTI-1/2, units, pixdim, extensions, and both independent transforms.
    result = type(source)(data.astype(dtype, copy=False), source.affine, header)
    result.set_qform(source.get_qform(), int(source.header["qform_code"]))
    result.set_sform(source.get_sform(), int(source.header["sform_code"]))
    result.header.set_slope_inter(1.0, 0.0)
    nib.save(result, str(path))


def reference_metrics(source, mask, reference_path: Path, max_voxels, max_bytes, allow_unknown_units=False):
    reference, values = load_volume(reference_path, max_voxels, max_bytes)
    source_units = source.header.get_xyzt_units()[0]
    reference_units = reference.header.get_xyzt_units()[0]
    units_match = source_units == reference_units
    unknown_units_override = allow_unknown_units and "unknown" in {source_units, reference_units}
    if reference.shape != source.shape or not np.allclose(reference.affine, source.affine, rtol=1e-5, atol=1e-5) or not np.allclose(reference.header.get_zooms(), source.header.get_zooms()) or not (units_match or unknown_units_override):
        raise InferenceError("Reference mask must match CT dimensions, affine, and spatial units.")
    foreground = values > 0
    intersection = int(np.count_nonzero(foreground & (mask > 0)))
    denominator = int(np.count_nonzero(foreground)) + int(np.count_nonzero(mask))
    return {"dice": 2 * intersection / denominator if denominator else 1.0,
            "reference_foreground_voxels": int(np.count_nonzero(foreground)),
            "reference_definition": "label > 0",
            "ct_spatial_units": source_units, "reference_spatial_units": reference_units,
            "unknown_units_override": bool(not units_match and unknown_units_override),
            "geometry_note": "Explicit voxelwise alignment assumption for matching dimensions, affine and spacing with unknown units." if not units_match else "Dimensions, affine, spacing and spatial units match."}


def run_inference(ct_path, checkpoint_path, output_dir, threshold=0.70,
                  batch_size=1, device="cpu", max_voxels=MAX_VOXEL_COUNT,
                  max_bytes=MAX_UNCOMPRESSED_BYTES, reference_path=None, progress=None,
                  allow_reference_unknown_units=False):
    if not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise InferenceError("Threshold must be finite and between 0 and 1.")
    if not 1 <= batch_size <= 16:
        raise InferenceError("Batch size must be between 1 and 16.")
    if not checkpoint_path:
        raise InferenceError("Model checkpoint is not configured; set VASCULAI_MODEL_CHECKPOINT.", 503)
    started = time.monotonic()
    selected = select_device(device)
    checkpoint_path = Path(checkpoint_path)
    checkpoint_sha256 = sha256_file(checkpoint_path) if checkpoint_path.is_file() else None
    model, step = load_model(checkpoint_path, selected)
    try:
        source_version = file_version(Path(ct_path))
        source_sha256 = cached_source_sha256(Path(ct_path))
    except OSError as exc:
        raise InferenceError("Input volume is unavailable or changed while being fingerprinted.", 409) from exc
    source, raw = load_volume(Path(ct_path), max_voxels, max_bytes)
    if reference_path:
        # Fail reference validation before spending time on tiled inference.
        reference_metrics(source, np.zeros(source.shape, dtype=np.uint8), Path(reference_path),
                          max_voxels, max_bytes, allow_reference_unknown_units)
    image = preprocess_ct(raw)
    del raw
    try:
        probability = predict_volume(model, image, selected, batch_size, progress)
    except InferenceError:
        raise
    except Exception as exc:
        raise InferenceError("Segmentation inference failed; check runtime resources and model configuration.", 500) from exc
    del model, image
    try:
        if file_version(Path(ct_path)) != source_version:
            raise OSError("Input changed")
    except OSError as exc:
        raise InferenceError("Input volume changed during inference; run again on the current upload.", 409) from exc
    mask = (probability >= threshold).astype(np.uint8)
    metadata = {
        "architecture": "SmallUNet3D", "base_channels": 8, "parameter_count": 85177,
        "checkpoint_step": step, "checkpoint_sha256": checkpoint_sha256,
        "source_sha256": source_sha256, "shape": list(source.shape),
        "affine": source.affine.tolist(), "xyzt_units": int(source.header["xyzt_units"]),
        "patch_size": list(PATCH), "stride": STRIDE, "threshold": threshold,
        "preprocessing": "clip [-200, 800], then (image + 200) / 1000",
        "probability_min": float(probability.min()), "probability_max": float(probability.max()),
        "foreground_voxels": int(mask.sum()), "device": str(selected),
        "experimental": True, "clinical_validation": False, "limitations": LIMITATION,
    }
    if reference_path:
        metadata["evaluation"] = reference_metrics(source, mask, Path(reference_path), max_voxels, max_bytes, allow_reference_unknown_units)
    output_dir = Path(output_dir)
    # Each run owns a new directory; never overwrite another run or the input.
    output_dir.mkdir(parents=True, exist_ok=False)
    try:
        save_like(source, probability, output_dir / "probabilities.nii.gz", np.float32)
        save_like(source, mask, output_dir / "prediction_mask.nii.gz", np.uint8)
        metadata["duration_seconds"] = round(time.monotonic() - started, 3)
        (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    except Exception:
        for name in ("probabilities.nii.gz", "prediction_mask.nii.gz", "metadata.json"):
            (output_dir / name).unlink(missing_ok=True)
        output_dir.rmdir()
        raise
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Experimental VascuAI segmentation; not clinically validated")
    parser.add_argument("--ct", required=True)
    parser.add_argument("--checkpoint", default=os.environ.get("VASCULAI_MODEL_CHECKPOINT"))
    parser.add_argument("--output-dir", required=True, help="New directory for this run (must not exist)")
    parser.add_argument("--threshold", type=float, default=float(os.environ.get("VASCULAI_MODEL_THRESHOLD", "0.70")))
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="cpu")
    parser.add_argument("--reference-mask")
    parser.add_argument("--allow-reference-unknown-units", action="store_true",
                        help="Explicitly assume voxelwise alignment when reference/CT units are unknown but dimensions, affine and spacing match")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.threads <= 32:
        parser.error("--threads must be between 1 and 32")
    torch.set_num_threads(args.threads)
    last_print = time.monotonic()
    def progress(done, total):
        nonlocal last_print
        if time.monotonic() - last_print >= 10 or done == total:
            print(f"Patches {done}/{total}", flush=True)
            last_print = time.monotonic()
    try:
        metadata = run_inference(args.ct, args.checkpoint, args.output_dir, args.threshold,
                                 args.batch_size, args.device, reference_path=args.reference_mask,
                                 progress=progress, allow_reference_unknown_units=args.allow_reference_unknown_units)
    except (InferenceError, OSError) as exc:
        parser.exit(1, f"Inference failed: {exc}\n")
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == "__main__":
    main()
