#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const [html, app, imageCore, builder] = await Promise.all([
  readFile(join(projectDirectory, "index.html"), "utf8"),
  readFile(join(projectDirectory, "app.js"), "utf8"),
  readFile(join(projectDirectory, "image-core.js"), "utf8"),
  readFile(join(projectDirectory, "build-single-html.mjs"), "utf8"),
]);

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const elementIdBlock = app.match(/const elementIds = \[([\s\S]*?)\n  \];/);
assert.ok(elementIdBlock, "application element id list is required");
for (const match of elementIdBlock[1].matchAll(/"([^"]+)"/g)) {
  assert.ok(htmlIds.has(match[1]), `missing required application element #${match[1]}`);
}

assert.match(html, /connect-src 'none'/);
assert.match(html, /worker-src blob:/);
assert.match(html, /accept="image\/png,image\/jpeg,image\/webp/);
assert.doesNotMatch(html, /pdf\.min\.js|pdf\.worker/);
assert.ok(
  html.indexOf("../PDF-OCR_開発用/offline-guard.js")
    < html.indexOf("../PDF-OCR_開発用/vendor/tesseract.min.js"),
  "offline guard must load before Tesseract",
);
assert.ok(
  html.indexOf("../PDF-OCR_開発用/vendor-precision/offline-ocr-assets.js") < html.indexOf("./app.js"),
  "OCR models must load before the application",
);
for (const id of [
  "dropZone",
  "imageFile",
  "pasteButton",
  "previewCanvas",
  "startButton",
  "cancelButton",
  "resultText",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
}

assert.match(app, /document\.addEventListener\("paste"/);
assert.match(app, /clipboardData\?\.items/);
assert.match(app, /clipboardHasPlainText/);
assert.match(app, /navigator\.clipboard\?\.read/);
assert.match(app, /addEventListener\("drop"/);
assert.match(app, /inspectImageHeader/);
assert.match(app, /validateImageDimensions/);
assert.match(app, /readBlobAsArrayBuffer/);
assert.match(app, /URL\.revokeObjectURL/);
assert.match(app, /context\.fillStyle = "#ffffff"/);
assert.match(app, /sourceCanvas/);
assert.match(app, /createWorkingCanvas/);
assert.match(app, /captureWorkers/);
assert.match(app, /RunCancelledError/);
assert.match(app, /scanscribe-image-ocr-result/);
assert.doesNotMatch(app, /pdfjsLib|PDF_RENDER|\.pdf\b/i);
assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|showOpenFilePicker/i);
assert.doesNotMatch(app, /https?:\/\//i, "first-party runtime must not contain network endpoints");
assert.doesNotMatch(app, /\.innerHTML\s*=|\.outerHTML\s*=|document\.write/);

assert.match(imageCore, /PNG_HEADER_INVALID/);
assert.match(imageCore, /JPEG_DIMENSIONS_MISSING/);
assert.match(imageCore, /WEBP_FORMAT_UNSUPPORTED/);
assert.match(imageCore, /maxBytes: 40 \* 1024 \* 1024/);
assert.match(imageCore, /maxDimension: 12_000/);
assert.match(imageCore, /maxPixels: 20_000_000/);
assert.match(builder, /sha256Source/);
assert.match(builder, /PDF-OCR_開発用/);
assert.match(builder, /vendor-precision\/offline-ocr-assets\.js/);
assert.doesNotMatch(builder, /pdf\.min\.js|pdf\.worker/);

console.log("Static image OCR checks passed.");
