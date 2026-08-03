# Third-party notices

ScanScribe bundles the following unmodified or minimally adapted open-source components for offline use.
The generated manifest records the exact source URLs and SHA-256 digests.

## PDF.js 3.11.174

- Project: https://github.com/mozilla/pdf.js
- License: Apache License 2.0
- Bundled files: `vendor/pdf.min.js`, `vendor/pdf.worker.min.js`

## Tesseract.js 7.0.0

- Project: https://github.com/naptha/tesseract.js
- License: Apache License 2.0
- Bundled files: `vendor/tesseract.min.js`; worker source embedded in `vendor/offline-ocr-assets.js`
- Adaptation: the embedded worker initializes byte-backed language objects by their `code`; the patch is documented in `vendor/MANIFEST.json`

## tesseract.js-core 7.0.0

- Project: https://github.com/naptha/tesseract.js-core
- License: Apache License 2.0
- Bundled file: LSTM single-file core embedded in `vendor/offline-ocr-assets.js`

## Tesseract language data

- Project: https://github.com/naptha/tessdata
- License: Apache License 2.0
- Packages: `@tesseract.js-data/jpn@1.0.0`, `@tesseract.js-data/eng@1.0.0`
- Variant: `4.0.0_best_int`, embedded in `vendor/offline-ocr-assets.js`

The high-accuracy and maximum variants instead embed the official float
horizontal-text `eng` and `jpn` models from `tesseract-ocr/tessdata_best`, pinned to
commit `e12c65a915945e4c28e237a9b52bc4a8f39a0cec`. Their source and compressed
SHA-256 digests are recorded in `vendor-precision/MANIFEST.json`.

The original license banners are preserved in the bundled JavaScript sources.
