#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const require = createRequire(import.meta.url);
const savedStructuredClone = globalThis.structuredClone;

try {
  globalThis.structuredClone = undefined;
  const compatibility = require(join(projectDirectory, "browser-compat.js"));
  globalThis.pdfjsWorker = require(join(projectDirectory, "vendor", "pdf.worker.min.js"));
  const pdfjs = require(join(projectDirectory, "vendor", "pdf.min.js"));
  const core = require(join(projectDirectory, "ocr-core.js"));
  const minimalJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const data = core.createImagePdfBytes(minimalJpeg, 1, 1);
  const loadingTask = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
  });
  const document = await loadingTask.promise;

  assert.equal(compatibility.usingStructuredCloneFallback, true);
  assert.equal(document.numPages, 1);
  await document.destroy();
  console.log("PDF compatibility smoke test passed without native structuredClone.");
} finally {
  globalThis.structuredClone = savedStructuredClone;
  delete globalThis.pdfjsWorker;
}
