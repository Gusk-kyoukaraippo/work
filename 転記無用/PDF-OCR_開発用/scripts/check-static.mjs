#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");

function fail(message) {
  throw new Error(message);
}

const index = await readFile(join(projectDirectory, "index.html"), "utf8");
const runtimeSources = await Promise.all(
  [
    "index.html",
    "app.js",
    "ocr-core.js",
    "accuracy-core.js",
    "offline-guard.js",
    "browser-compat.js",
    "styles.css",
  ]
    .map(async (name) => [name, await readFile(join(projectDirectory, name), "utf8")]),
);
const appSource = runtimeSources.find(([name]) => name === "app.js")[1];
const coreSource = runtimeSources.find(([name]) => name === "ocr-core.js")[1];

for (const [name, source] of runtimeSources) {
  if (/\b(?:https?|wss?):\/\//i.test(source)) {
    fail(`${name} contains an external runtime URL.`);
  }
}

const scriptSources = [...index.matchAll(/<script\s+defer\s+src="([^"]+)"/g)]
  .map((match) => match[1]);
const expectedOrder = [
  "./offline-guard.js",
  "./browser-compat.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/tesseract.min.js",
  "./vendor/offline-ocr-assets.js",
  "./ocr-core.js",
  "./accuracy-core.js",
  "./app.js",
];
if (JSON.stringify(scriptSources) !== JSON.stringify(expectedOrder)) {
  fail(`Script order differs from the offline-safe order: ${scriptSources.join(", ")}`);
}
const stylesheetSources = [...index.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)]
  .map((match) => match[1]);
if (JSON.stringify(stylesheetSources) !== JSON.stringify(["./styles.css"])) {
  fail(`Stylesheet sources differ from the offline-safe list: ${stylesheetSources.join(", ")}`);
}
for (const match of index.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
  if (/^(?:\/\/|file:\/\/|\\\\)/i.test(match[1])) {
    fail(`UNC or protocol-relative resource reference is not allowed: ${match[1]}`);
  }
}

const htmlIdList = [...index.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const htmlIds = new Set(htmlIdList);
if (htmlIds.size !== htmlIdList.length) {
  const duplicateIds = [...new Set(htmlIdList.filter(
    (id, index) => htmlIdList.indexOf(id) !== index,
  ))];
  fail(`index.html contains duplicate ids: ${duplicateIds.join(", ")}`);
}
const elementIdBlock = appSource.match(/const elementIds = \[([\s\S]*?)\n  \];/);
if (!elementIdBlock) fail("Could not find the app elementIds declaration.");
const referencedIds = [...elementIdBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
for (const id of referencedIds) {
  const occurrences = htmlIdList.filter((candidate) => candidate === id).length;
  if (occurrences !== 1) {
    fail(`app.js requires exactly one HTML id ${id}; found ${occurrences}.`);
  }
}

for (const [label, pattern] of [
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["IndexedDB", /\bindexedDB\b/i],
  ["File System Access open picker", /\bshowOpenFilePicker\b/],
  ["File System Access save picker", /\bshowSaveFilePicker\b/],
  ["File System Access directory picker", /\bshowDirectoryPicker\b/],
]) {
  for (const [name, source] of runtimeSources) {
    if (pattern.test(source)) fail(`${name} must not use ${label}.`);
  }
}

const manifestPath = join(projectDirectory, "vendor", "MANIFEST.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const directFiles = {
  pdfMain: "pdf.min.js",
  pdfWorker: "pdf.worker.min.js",
  tesseractMain: "tesseract.min.js",
};

for (const [key, name] of Object.entries(directFiles)) {
  const bytes = await readFile(join(projectDirectory, "vendor", name));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== manifest.assets[key].sha256) {
    fail(`${name} does not match vendor/MANIFEST.json.`);
  }
}

const embeddedAssetPath = join(projectDirectory, "vendor", "offline-ocr-assets.js");
const embeddedAssetStats = await stat(embeddedAssetPath);
if (embeddedAssetStats.size < 8 * 1024 * 1024) {
  fail("offline-ocr-assets.js is unexpectedly small; OCR core or language models may be missing.");
}

const embeddedAssetSource = await readFile(embeddedAssetPath, "utf8");
const embeddedBundleHash = createHash("sha256").update(embeddedAssetSource).digest("hex");
if (
  manifest.bundle?.file !== "offline-ocr-assets.js"
  || manifest.bundle?.sha256 !== embeddedBundleHash
  || manifest.bundle?.bytes !== embeddedAssetStats.size
) {
  fail("offline-ocr-assets.js does not match the complete bundle hash in vendor/MANIFEST.json.");
}
for (const marker of [
  "tesseractWorkerSource",
  "tesseractCoreSource",
  "jpn:",
  "eng:",
  'return\\"string\\"==typeof t?t:t.code',
]) {
  if (!embeddedAssetSource.includes(marker)) {
    fail(`offline-ocr-assets.js is missing marker: ${marker}`);
  }
}

const assetContext = vm.createContext({ window: {} });
vm.runInContext(embeddedAssetSource, assetContext, {
  filename: "offline-ocr-assets.js",
  timeout: 30_000,
});
const embedded = assetContext.window.ScanScribeAssets;
const embeddedChecks = [
  [
    "patched Tesseract worker",
    Buffer.from(embedded.tesseractWorkerSource, "utf8"),
    manifest.patches.find((patch) => patch.asset === "tesseractWorker")?.patchedSha256,
  ],
  [
    "Tesseract core",
    Buffer.from(embedded.tesseractCoreSource, "utf8"),
    manifest.assets.tesseractCore.sha256,
  ],
  ["Japanese model", Buffer.from(embedded.models.jpn, "base64"), manifest.assets.japaneseModel.sha256],
  ["English model", Buffer.from(embedded.models.eng, "base64"), manifest.assets.englishModel.sha256],
];
for (const [label, bytes, expectedHash] of embeddedChecks) {
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (!expectedHash || actualHash !== expectedHash) {
    fail(`${label} does not match vendor/MANIFEST.json.`);
  }
}

if (!index.includes("完全オフライン版")) {
  fail("The UI does not identify the complete-offline build.");
}

const cspIndex = index.indexOf("http-equiv=\"Content-Security-Policy\"");
const firstResourceIndex = Math.min(
  index.indexOf("<link rel=\"stylesheet\""),
  index.indexOf("<script defer"),
);
if (cspIndex < 0 || cspIndex > firstResourceIndex) {
  fail("The CSP must appear before all scripts and stylesheets.");
}
for (const directive of [
  "connect-src 'none'",
  "worker-src blob:",
  "img-src data: blob:",
  "font-src data: blob:",
  "script-src file: 'wasm-unsafe-eval'",
  "object-src 'none'",
]) {
  if (!index.includes(directive)) fail(`The CSP is missing: ${directive}`);
}
if (index.includes("'unsafe-inline'") || /(?:^|\s)'unsafe-eval'(?:\s|;|$)/.test(index)) {
  fail("The CSP must not permit general inline/eval script execution.");
}

for (const marker of [
  "ScanScribeNetworkGuard?.installed !== true",
  "ScanScribeBrowserCompat",
  "readBlobAsArrayBuffer",
  "isOffscreenCanvasSupported: false",
  "ScanScribeNetworkGuard.captureWorkers",
  "assets.tesseractCoreSource",
  "assets.tesseractWorkerSource",
  "scope.importScripts = blocked",
  '"WebSocket"',
  '"EventSource"',
  '"WebTransport"',
  '"SharedWorker"',
]) {
  if (!appSource.includes(marker)) fail(`app.js is missing offline marker: ${marker}`);
}
if (
  appSource.indexOf("assets.tesseractCoreSource")
  > appSource.indexOf("assets.tesseractWorkerSource")
) {
  fail("The embedded OCR core must precede the Tesseract worker source.");
}
if (appSource.includes("const coreBlob") || appSource.includes("URL.createObjectURL(coreBlob)")) {
  fail("The OCR core must share the worker Blob for file:// compatibility.");
}

for (const marker of ["combinedText:", "combinedTextEdited:", "resultTextDirty"]) {
  if (!appSource.includes(marker)) fail(`Edited-result export marker is missing: ${marker}`);
}
for (const marker of [
  'id="historyImportPanel"',
  'id="historyFile"',
  'id="historySelectButton"',
]) {
  if (!index.includes(marker)) fail(`History import UI marker is missing: ${marker}`);
}
for (const marker of [
  "MAX_HISTORY_BYTES",
  "normalizeResultHistory",
  "sourceNameChanged",
  "enhanceRgbaPercentilesInPlace",
]) {
  if (!appSource.includes(marker)) fail(`History or preprocessing marker is missing: ${marker}`);
}

for (const marker of [
  'id="selectionSurface"',
  'id="selectionBox"',
  'id="pageSelect"',
  'id="selectFullPageButton"',
  'value="4.167" selected',
  'value="6" selected',
]) {
  if (!index.includes(marker)) fail(`Region OCR UI marker is missing: ${marker}`);
}
if (index.includes('id="pageRange"')) {
  fail("Legacy batch page-range UI must not return.");
}
for (const forbidden of [
  'addEventListener("pointerdown"',
  'addEventListener("pointermove"',
  'addEventListener("pointerup"',
  'addEventListener("touchstart"',
  'addEventListener("touchmove"',
  'addEventListener("touchend"',
]) {
  if (appSource.includes(forbidden)) {
    fail(`Touch or pen interaction is outside the mouse-only requirement: ${forbidden}`);
  }
}
for (const marker of [
  'addEventListener("mousedown", beginMouseSelection)',
  'addEventListener("mousemove", updateMouseSelection)',
  'addEventListener("mouseup", finishMouseSelection)',
  "state.results.push",
  "selectOcrCandidate",
  "regionToPixels",
  "user_defined_dpi: String(settings.actualDpi)",
  "OCR_MAX_PIXELS = VARIANT.ocrMaxPixels",
  "renderPdfRegionForOcr",
  "thresholding_method",
  "PREVIEW_MAX_PIXELS = 2_500_000",
  "MAX_PDF_PAGES = 20",
  "maxImageSize: PDF_MAX_IMAGE_PIXELS",
  "canvasMaxAreaInBytes: PDF_CANVAS_MAX_AREA_BYTES",
]) {
  if (!appSource.includes(marker)) fail(`Region OCR implementation marker is missing: ${marker}`);
}
for (const marker of [
  "function normalizeRegion",
  "function regionToPixels",
  "function selectOcrCandidate",
  "function createImagePdfBytes",
]) {
  if (!coreSource.includes(marker)) fail(`OCR core marker is missing: ${marker}`);
}
if (coreSource.includes("const glyphs =")) {
  fail("The obsolete 5x7 block-glyph sample must not return.");
}

for (const marker of [
  "OCR_STARTUP_TIMEOUT_MS",
  "OCR_RECOGNITION_TIMEOUT_MS",
  "abortController",
  "resources.nativeWorkers",
  "state.activeRun !== run",
  "run.workerResources !== resources",
  "terminatedApiWorkers",
  "activeRun?.workerResources === resources",
]) {
  if (!appSource.includes(marker)) fail(`Run-lifecycle safety marker is missing: ${marker}`);
}

console.log("Static offline checks passed.");
