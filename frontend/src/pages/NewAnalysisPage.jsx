
import "./NewAnalysisPage.css";

export default function NewAnalysisPage() {
  return (
    <section className="new-analysis-page">
      <p className="new-analysis-eyebrow">IMAGE WORKSPACE</p>

      <h1>New Analysis</h1>
      <p className="new-analysis-subtitle">
        Upload a medical image to prepare a new artery analysis.
      </p>

      <div className="new-analysis-card">
        <h2>Upload Medical Image</h2>
        <p>
          Select an image file to prepare it for analysis.
        </p>

        <label className="new-analysis-dropzone">
          <span className="new-analysis-upload-icon">↑</span>
          <strong>Choose an image</strong>
          <span>Supported image formats depend on backend integration.</span>

          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                alert(`Selected file: ${file.name}`);
              }
            }}
          />
        </label>

        <p className="new-analysis-notice">
          Research interface only. Selecting a file does not run
          segmentation or stenosis detection.
        </p>
      </div>
    </section>
  );
}
