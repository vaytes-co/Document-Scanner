# VAYTES DOCUMENT SCANNER

Client-side document scanner for mobile and desktop. Designed for GitHub Pages.

## Features
- Camera capture using rear camera on supported devices
- Automatic document-edge detection
- Perspective correction / deskew
- Enhancement: Document, Clean, B&W, Original
- A4, A5, Letter, Legal, Original paper sizes
- Multi-page document
- Reorder and delete pages
- Client-side PDF export
- No backend, database, login, or document upload

## Run locally
Because camera APIs require a secure context, use a local HTTP server instead of opening `index.html` with `file://`.

Examples:
- VS Code Live Server
- `python -m http.server 5500`

Then open `http://localhost:5500`.

## GitHub Pages
1. Create a GitHub repository.
2. Upload all files/folders in this ZIP.
3. Settings → Pages → Deploy from branch → `main` / root.
4. Open the generated `github.io` URL.
5. Allow camera access.

## Notes
The app processes images in the browser. Internet is needed on first load for the OpenCV.js and jsPDF CDN scripts unless those libraries are later vendored into the repository.

For best results:
- Place the page on a flat, contrasting surface.
- Use even lighting and avoid strong shadows.
- Keep the entire paper inside the camera view.
- Hold the perangkat parallel to the document where possible.
