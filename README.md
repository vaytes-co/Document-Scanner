# VAYTES DOCUMENT SCANNER v1.2

A client-side document scanner designed for phones, tablets, and desktop browsers. No backend or document storage is required.

## What changed in v1.2
- Live document-edge detection with a green outline while aiming the camera.
- Uses outer contours to avoid accidentally detecting text boxes as the paper.
- Conservative perspective correction: if a document cannot be detected confidently, the full photo is kept instead of aggressively cropping it.
- Adds a small white safety border after perspective correction so content near the edge is not cut.
- Normalizes every processed page to the selected paper size with consistent margins and straight orientation.
- Preview now displays the actual processed result before acceptance.
- Enhancement modes now affect both preview and exported PDF.
- Changing paper size / enhancement / detection mode reprocesses existing pages.
- Multi-page PDF export uses the processed pages, not the original camera photos.

## Best scanning practice
1. Put the paper on a contrasting, flat surface.
2. Use even lighting and avoid hard shadows.
3. Keep all four corners visible.
4. Hold the camera as parallel to the paper as possible.
5. Wait for the green outline, then capture.

## GitHub Pages
Upload the contents of this folder to a GitHub repository and enable Settings → Pages → Deploy from branch → main / root.

The app uses OpenCV.js and jsPDF from public CDNs, so the first page load requires internet access. Image processing itself happens locally in the browser.

## Important limitation
No browser-only algorithm can recover detail that was never captured by the camera. The goal of this version is to preserve the complete document, correct perspective, standardize page framing, and improve readability without destructive cropping.
