# VAYTES DOCUMENT SCANNER v2.0

A browser-based document scanner inspired by the workflow of modern mobile scanners.

## Pipeline
1. Rear-camera capture
2. Live document-edge detection overlay
3. Four-corner perspective correction
4. Conservative safe margin (prevents content clipping)
5. Illumination normalization / local contrast
6. Smart / Color / Grayscale / B&W / Original modes
7. Paper-size normalization without cropping
8. Preview of the actual processed result
9. Multi-page ordering
10. Client-side PDF export

## Deploy
Upload the repository contents to GitHub and enable GitHub Pages from the main branch / root.

Camera access requires HTTPS or localhost.

## Privacy / cost
No backend, database, login, or upload endpoint is used. Images are processed in the browser.

OpenCV.js and jsPDF are loaded from public CDNs. If you want the repository to work completely offline, vendor those libraries into the repository later.

## Important
This is a browser implementation, so image quality is constrained by the camera image supplied by the device/browser. The pipeline deliberately avoids aggressive enlargement/cropping because that can destroy document content.

## Scanner behavior
The live camera uses a contour-based document detector to draw a four-corner guide. Capture processing uses the detected quadrilateral, perspective correction, conservative margins, illumination normalization, CLAHE/local contrast, sharpening, grayscale/adaptive B&W, and non-cropping paper normalization. The preview is rendered from the processed image that is later exported to PDF.
