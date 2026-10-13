# Artery Segmentation and Stenosis Detection Demo

This project is a static front-end demo for a medical image analysis interface. It includes a login page, registration page, dashboard, upload page, history page, and report page.

## Project Structure

- `index.html` - Login page
- `register.html` - Registration page
- `dashboard.html` - Main dashboard
- `upload.html` - Image upload and preview
- `history.html` - Analysis history
- `report.html` - Demo report page
- `style.css` - Styling for the whole app

## Run Manually

1. Open a terminal in the project folder.
2. Start a local web server:

```bash
python -m http.server 8123
```

3. Open the following URL in your browser:

```text
http://localhost:8123/index.html
```

## Optional

If you want to serve from a different folder or port, use:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

## Notes

- This is a frontend-only demonstration.
- There is no backend or actual medical model integration yet.
- The pages are static and designed for UI preview and workflow demonstration.
