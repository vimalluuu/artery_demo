"""Algorithm/geometry tests use synthetic volumes; original weights are opt-in."""
import os
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

torch = pytest.importorskip("torch")
from app.services.segmentation.inference import (
    InferenceError, load_model, load_volume, predict_volume, preprocess_ct,
    reference_metrics, run_inference, save_like, select_device, sliding_starts,
)
from app.services.segmentation.model import SmallUNet3D


@pytest.fixture
def original_checkpoint():
    path = os.environ.get("VASCULAI_TEST_CHECKPOINT")
    if not path:
        pytest.skip("Set VASCULAI_TEST_CHECKPOINT to test the original local artifact")
    return Path(path)


def test_architecture_and_preprocessing():
    assert sum(p.numel() for p in SmallUNet3D().parameters()) == 85177
    raw = np.array([-500, -200, 0, 800, 1200], dtype=np.float32).reshape(1, 1, 5)
    np.testing.assert_allclose(preprocess_ct(raw).ravel(), [0, 0, .2, 1, 1])
    assert raw.flat[0] == -500


@pytest.mark.parametrize("raw", [np.zeros((3, 3)), np.zeros((3, 3, 3, 1)), np.full((2, 2, 2), np.nan), np.full((2, 2, 2), np.inf)])
def test_invalid_voxels_and_dimensions(raw):
    with pytest.raises(InferenceError):
        preprocess_ct(raw)


def test_missing_and_incompatible_checkpoints(tmp_path):
    with pytest.raises(InferenceError, match="missing"):
        load_model(tmp_path / "missing.pt", torch.device("cpu"))
    # Deliberately invalid fixture, never a replacement model artifact.
    path = tmp_path / "invalid.pt"
    torch.save({"base_channels": 16, "model_state_dict": {}}, path)
    with pytest.raises(InferenceError, match="strictly"):
        load_model(path, torch.device("cpu"))
    path.write_bytes(b"not a checkpoint")
    with pytest.raises(InferenceError, match="strictly"):
        load_model(path, torch.device("cpu"))


def test_original_checkpoint_loads_strictly(original_checkpoint):
    model, step = load_model(original_checkpoint, torch.device("cpu"))
    assert step == 700 and not model.training
    assert sum(p.numel() for p in model.parameters()) == 85177


def test_sliding_windows_cover_far_edge_and_blend_probabilities():
    assert sliding_starts(10) == [0]
    assert sliding_starts(97) == [0, 32, 33]
    class PatchLogits(torch.nn.Module):
        def forward(self, batch):
            return batch[:, :, :1, :1, :1].expand_as(batch)
    image = np.arange(97, dtype=np.float32)[:, None, None] * np.ones((1, 65, 5), dtype=np.float32) / 32
    probability = predict_volume(PatchLogits(), image, torch.device("cpu"), batch_size=2)
    assert probability.shape == image.shape
    assert probability[0, 0, 0] == pytest.approx(.5)
    expected = np.mean([.5, 1 / (1 + np.exp(-1)), 1 / (1 + np.exp(-33 / 32))])
    assert probability[33, 33, 3] == pytest.approx(expected)
    assert probability[-1, -1, -1] == pytest.approx(1 / (1 + np.exp(-33 / 32)))


def test_nonfinite_model_output_rejected():
    class Invalid(torch.nn.Module):
        def forward(self, batch):
            return batch * float("nan")
    with pytest.raises(InferenceError, match="logits"):
        predict_volume(Invalid(), np.zeros((2, 2, 2), dtype=np.float32), torch.device("cpu"))


@pytest.mark.parametrize("version", [1, 2])
def test_outputs_preserve_geometry_and_reset_intensity_scaling(tmp_path, version):
    cls = nib.Nifti1Image if version == 1 else nib.Nifti2Image
    affine = np.array([[0, -.002, 0, .01], [.001, 0, 0, -.02], [0, 0, .003, .03], [0, 0, 0, 1]])
    source = cls(np.zeros((3, 4, 5), dtype=np.int16), affine)
    source.header.set_xyzt_units("meter", "sec")
    source.set_qform(affine, code=1)
    source.set_sform(affine, code=2)
    source.header.set_slope_inter(2, -1000)
    source.header.extensions.append(nib.nifti1.Nifti1Extension(6, b"synthetic test metadata"))
    path = tmp_path / "source.nii.gz"
    nib.save(source, path)
    loaded = nib.load(path)
    for dtype, values in [(np.uint8, np.ones(source.shape)), (np.float32, np.full(source.shape, .25))]:
        output = tmp_path / (np.dtype(dtype).name + ".nii.gz")
        save_like(loaded, values, output, dtype)
        result = nib.load(output)
        assert isinstance(result, cls)
        assert result.shape == loaded.shape
        assert result.get_data_dtype() == np.dtype(dtype)
        np.testing.assert_allclose(result.get_fdata(), values)
        np.testing.assert_allclose(result.affine, loaded.affine)
        np.testing.assert_allclose(result.get_qform(), loaded.get_qform())
        np.testing.assert_allclose(result.get_sform(), loaded.get_sform())
        np.testing.assert_allclose(result.header.get_zooms(), loaded.header.get_zooms())
        assert result.header.get_xyzt_units() == loaded.header.get_xyzt_units()
        assert result.header["qform_code"] == 1 and result.header["sform_code"] == 2
        assert result.header.extensions[0].get_content() == b"synthetic test metadata"


def test_input_validation_and_reference_binarization(tmp_path):
    source = nib.Nifti1Image(np.zeros((3, 4, 5), dtype=np.int16), np.eye(4))
    path = tmp_path / "reference.nii.gz"
    nib.save(nib.Nifti1Image(np.full(source.shape, 7, dtype=np.uint8), np.eye(4)), path)
    metrics = reference_metrics(source, np.ones(source.shape, dtype=np.uint8), path, 1000, 10000)
    assert metrics["dice"] == 1 and metrics["reference_foreground_voxels"] == 60
    nib.save(nib.Nifti1Image(np.zeros((3, 4, 5, 2)), np.eye(4)), path)
    with pytest.raises(InferenceError, match="three-dimensional"):
        load_volume(path)
    path.write_bytes(b"invalid")
    with pytest.raises(InferenceError, match="NIfTI"):
        load_volume(path)


def test_real_pipeline_on_synthetic_volume(original_checkpoint, tmp_path):
    source = tmp_path / "synthetic.nii.gz"
    nib.save(nib.Nifti2Image(np.full((5, 7, 9), 100, dtype=np.int16), np.diag([.6, .8, 1.2, 1])), source)
    output = tmp_path / "run"
    before = original_checkpoint.read_bytes()
    metadata = run_inference(source, original_checkpoint, output)
    probability = nib.load(output / "probabilities.nii.gz").get_fdata()
    mask = nib.load(output / "prediction_mask.nii.gz").get_fdata()
    assert probability.shape == mask.shape == (5, 7, 9)
    assert np.isfinite(probability).all() and 0 <= probability.min() <= probability.max() <= 1
    np.testing.assert_array_equal(mask, probability >= .70)
    assert metadata["checkpoint_step"] == 700 and metadata["experimental"]
    assert original_checkpoint.read_bytes() == before
    with pytest.raises(FileExistsError):
        run_inference(source, original_checkpoint, output)


def test_invalid_runtime_options(tmp_path, monkeypatch):
    with pytest.raises(InferenceError, match="configured"):
        run_inference(tmp_path / "ct.nii.gz", None, tmp_path / "out")
    with pytest.raises(InferenceError, match="Threshold"):
        run_inference(tmp_path / "ct.nii.gz", "anything", tmp_path / "out", threshold=float("nan"))
    with pytest.raises(InferenceError, match="Batch"):
        run_inference(tmp_path / "ct.nii.gz", "anything", tmp_path / "out", batch_size=0)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    with pytest.raises(InferenceError, match="unavailable"):
        select_device("cuda")


def test_unknown_reference_units_require_explicit_override(tmp_path):
    source = nib.Nifti1Image(np.zeros((3, 4, 5), dtype=np.int16), np.eye(4))
    source.header.set_xyzt_units("mm")
    reference = nib.Nifti1Image(np.ones(source.shape, dtype=np.uint8), np.eye(4))
    path = tmp_path / "unknown-units.nii.gz"
    nib.save(reference, path)
    with pytest.raises(InferenceError, match="spatial units"):
        reference_metrics(source, np.ones(source.shape), path, 1000, 10000)
    metrics = reference_metrics(source, np.ones(source.shape), path, 1000, 10000, allow_unknown_units=True)
    assert metrics["dice"] == 1 and metrics["unknown_units_override"]
    reference.set_sform(np.diag([2., 1., 1., 1.]), code=2)
    nib.save(reference, path)
    with pytest.raises(InferenceError, match="affine"):
        reference_metrics(source, np.ones(source.shape), path, 1000, 10000, allow_unknown_units=True)


def test_standalone_rejects_source_changed_during_prediction(original_checkpoint, tmp_path, monkeypatch):
    from app.services.segmentation import inference
    source = tmp_path / "synthetic.nii.gz"
    nib.save(nib.Nifti1Image(np.zeros((5, 7, 9), dtype=np.int16), np.eye(4)), source)
    def predict_and_mutate(model, image, device, batch_size, progress):
        source.write_bytes(source.read_bytes() + b"changed test input")
        return np.zeros(image.shape, dtype=np.float32)
    monkeypatch.setattr(inference, "predict_volume", predict_and_mutate)
    with pytest.raises(InferenceError, match="changed during inference"):
        run_inference(source, original_checkpoint, tmp_path / "run")
    assert not (tmp_path / "run").exists()
