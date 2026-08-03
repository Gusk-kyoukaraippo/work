# Third-party notices

ScanScribe Image bundles the following open-source components for completely offline use.
The exact source and compressed model digests are recorded in the shared project's
`vendor/MANIFEST.json` and `vendor-precision/MANIFEST.json` files.

## Tesseract.js 7.0.0

- Project: https://github.com/naptha/tesseract.js
- License: Apache License 2.0
- Bundled files: `vendor/tesseract.min.js`; worker source embedded in the offline asset bundle
- Adaptation: the embedded worker initializes byte-backed language objects by their `code`

## tesseract.js-core 7.0.0

- Project: https://github.com/naptha/tesseract.js-core
- License: Apache License 2.0
- Bundled file: LSTM single-file core embedded in the offline asset bundle

## Tesseract language data

- Project: https://github.com/tesseract-ocr/tessdata_best
- License: Apache License 2.0
- Models: horizontal-text `eng` and `jpn` float models
- Pinned commit: `e12c65a915945e4c28e237a9b52bc4a8f39a0cec`

Original license banners are preserved in the bundled JavaScript sources.
