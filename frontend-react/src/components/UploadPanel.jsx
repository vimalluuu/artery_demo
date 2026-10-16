import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  FileScan,
  X,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { casesApi } from "../api/cases";
import { validateUpload } from "../lib/uploads";
import { IMAGING_GUIDANCE } from "../constants/imaging-guidance";
import { useAuth } from "../context/AuthContext";

export default function UploadPanel({ caseData, onUploaded }) {
  const { isRole } = useAuth();
  const input = useRef(null),
    controller = useRef(null);
  const [type, setType] = useState("volume"),
    [file, setFile] = useState(null),
    [drag, setDrag] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [preview, setPreview] = useState(""),
    [replace, setReplace] = useState(false);
  const hasExisting =
    type === "volume" ? caseData.hasVolume : caseData.hasImage;
  // Object URLs are browser resources whose lifecycle follows the selected file.
  /* oxlint-disable react/set-state-in-effect -- Synchronize a browser object URL with the selected file and release it on cleanup. */
  useEffect(() => {
    if (
      !file ||
      type !== "image" ||
      !["image/png", "image/jpeg"].includes(file.type)
    ) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, type]);
  /* oxlint-enable react/set-state-in-effect */
  useEffect(() => () => controller.current?.abort(), []);
  function select(selected) {
    if (!selected) return;
    const problem = validateUpload(selected, type);
    setError(problem);
    setSuccess("");
    setFile(problem ? null : selected);
    setReplace(false);
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setSuccess("");
    setProgress(0);
    controller.current = new AbortController();
    try {
      const body = new FormData();
      body.append("file", file);
      const updated = await (
        type === "volume" ? casesApi.uploadVolume : casesApi.upload
      )(caseData.id, body, setProgress, controller.current.signal);
      onUploaded(updated);
      setFile(null);
      setSuccess("Your file was received and validated by the server.");
      if (input.current) input.current.value = "";
    } catch (err) {
      setError(
        err.code === "ERR_CANCELED"
          ? "Upload cancelled on this device. Refresh the case to confirm whether the server received the file."
          : err.message || "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  if (!isRole("Clinician", "Admin"))
    return (
      <div className="notice">
        Your role can inspect study metadata. Uploading requires a Clinician or
        Administrator account.
      </div>
    );
  return (
    <div>
      <div className="segmented" style={{ marginBottom: 18 }}>
        {[
          ["volume", "NIfTI volume"],
          ["image", "2D image"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            disabled={busy}
            className={type === value ? "selected" : ""}
            onClick={() => {
              setType(value);
              setFile(null);
              setError("");
              setSuccess("");
              setReplace(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept={
          type === "volume"
            ? ".nii,.nii.gz"
            : IMAGING_GUIDANCE.twoDimensional.extensions.join(",")
        }
        onChange={(e) => {
          select(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className={`dropzone${drag ? " drag-over" : ""}`}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) {
            if (e.dataTransfer.files.length > 1) {
              setError(
                "Choose one file per upload. DICOM series are not supported.",
              );
              return;
            }
            select(e.dataTransfer.files[0]);
          }
        }}
      >
        <span className="dropzone-icon">
          <UploadCloud size={23} strokeWidth={1.5} />
        </span>
        <strong>Drop your study here, or browse files</strong>
        <small>
          {type === "volume"
            ? IMAGING_GUIDANCE.volumetric.dropzoneText
            : IMAGING_GUIDANCE.twoDimensional.badgeText}
        </small>
      </button>
      {file && (
        <>
          <div className="selected-file">
            <FileScan size={20} />
            <div>
              <strong>{file.name}</strong>
              <small>
                {(file.size / 1024 / 1024).toFixed(2)} MB · Ready for upload
              </small>
            </div>
            <button
              className="icon-btn"
              aria-label="Remove selected file"
              disabled={busy}
              onClick={() => setFile(null)}
            >
              <X size={14} />
            </button>
          </div>
          {preview && (
            <>
              <img
                className="file-preview"
                src={preview}
                alt="Selected local image preview"
              />
              <p className="form-hint">
                Local file preview · No model output or segmentation applied
              </p>
            </>
          )}
          {hasExisting && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                disabled={busy}
              />
              <span>
                I understand this upload replaces the case’s existing{" "}
                {type === "volume" ? "volume" : "2D image"}. Previous upload
                versions are not retained.
              </span>
            </label>
          )}
        </>
      )}
      {error && (
        <div className="notice error" role="alert" style={{ marginTop: 15 }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {success && (
        <div className="notice success" role="status" style={{ marginTop: 15 }}>
          <CheckCircle size={16} />
          {success}
        </div>
      )}
      {busy && (
        <div style={{ margin: "18px 0" }}>
          <div className="flex-between text-xs text-muted">
            <span>
              {progress === 100
                ? "Upload sent. Validating on server…"
                : "Uploading…"}
            </span>
            <span>{progress}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <div className="page-actions" style={{ marginTop: 18 }}>
        <button
          className="btn btn-primary"
          type="button"
          id="upload-btn"
          disabled={!file || busy || (hasExisting && !replace)}
          onClick={upload}
        >
          <UploadCloud size={14} />
          {busy ? "Uploading…" : "Upload & validate"}
        </button>
        {busy && (
          <button
            className="btn btn-ghost"
            onClick={() => controller.current?.abort()}
          >
            Cancel upload
          </button>
        )}
      </div>
      <p className="form-hint" style={{ marginTop: 13 }}>
        The server validates the file. NIfTI ingestion reads header metadata; it
        does not run model inference. DICOM is not supported.
      </p>
    </div>
  );
}
