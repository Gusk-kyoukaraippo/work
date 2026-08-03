#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const precisionDirectory = join(projectDirectory, "vendor-precision");
const require = createRequire(import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const [assetBundleSource, manifestSource] = await Promise.all([
  readFile(join(precisionDirectory, "offline-ocr-assets.js"), "utf8"),
  readFile(join(precisionDirectory, "MANIFEST.json"), "utf8"),
]);
const manifest = JSON.parse(manifestSource);
assert.equal(
  sha256(assetBundleSource),
  manifest.bundle.sha256,
  "precision asset bundle matches its manifest",
);

const bundleContext = vm.createContext({ window: {} });
vm.runInContext(assetBundleSource, bundleContext, {
  filename: "vendor-precision/offline-ocr-assets.js",
  timeout: 30_000,
});
const assets = bundleContext.window.ScanScribeAssets;
assert.equal(assets?.versions?.tesseract, "7.0.0", "Tesseract.js 7 runtime is selected");
assert.equal(assets?.versions?.tesseractCore, "7.0.0", "Tesseract core 7 wrapper is selected");
assert.ok(assets?.tesseractWorkerSource, "embedded Tesseract.js worker is present");
assert.ok(assets?.tesseractCoreSource, "embedded Tesseract core is present");
assert.deepEqual(
  Object.keys(assets?.models || {}).sort(),
  ["eng", "jpn"],
  "precision bundle contains only the horizontal English and Japanese models",
);

const trainedData = {};
for (const language of ["eng", "jpn"]) {
  const gzip = Buffer.from(assets.models?.[language] || "", "base64");
  const metadata = manifest.models[language];
  assert.equal(gzip.length, metadata.gzipBytes, `${language} gzip byte count matches`);
  assert.equal(sha256(gzip), metadata.gzipSha256, `${language} gzip SHA-256 matches`);
  const source = gunzipSync(gzip);
  assert.equal(source.length, metadata.sourceBytes, `${language} source byte count matches`);
  assert.equal(sha256(source), metadata.sourceSha256, `${language} source SHA-256 matches`);
  trainedData[language] = source;
}

const coreContext = vm.createContext({
  Buffer,
  URL,
  WebAssembly,
  TextDecoder,
  TextEncoder,
  atob,
  btoa,
  clearInterval,
  clearTimeout,
  console,
  fetch,
  global: null,
  performance,
  process,
  require,
  setInterval,
  setTimeout,
  __filename: join(precisionDirectory, "tesseract-core-lstm.wasm.js"),
});
coreContext.global = coreContext;
vm.runInContext(assets.tesseractCoreSource, coreContext, {
  filename: "tesseract-core-lstm.wasm.js",
  timeout: 30_000,
});

const TessModule = await coreContext.TesseractCore({});
for (const [language, source] of Object.entries(trainedData)) {
  TessModule.FS.writeFile(`/${language}.traineddata`, source);
}

const multilingualApi = new TessModule.TessBaseAPI();
const coreVersion = typeof multilingualApi.Version === "function"
  ? String(multilingualApi.Version())
  : "";
assert.equal(
  coreVersion,
  manifest.runtime.embeddedTesseract,
  "embedded Tesseract engine version matches the precision manifest",
);
assert.equal(
  multilingualApi.Init(null, "jpn+eng", 1),
  0,
  "float tessdata_best jpn+eng initializes with the bundled LSTM core",
);

async function readFixture(name) {
  const base64 = await readFile(join(projectDirectory, "tests", "fixtures", name), "utf8");
  return gunzipSync(Buffer.from(base64.trim(), "base64"));
}

function recognizeLine(api, image, label) {
  TessModule.FS.writeFile("/input", image);
  assert.equal(api.SetImageFile(1, 0), 0, `${label} PGM fixture loads`);
  api.SetVariable("user_defined_dpi", "300");
  api.SetVariable("preserve_interword_spaces", "1");
  api.SetPageSegMode(7);
  assert.equal(api.Recognize(null), 0, `${label} fixture is recognized`);
  return {
    text: String(api.GetUTF8Text() || "").trim(),
    confidence: api.MeanTextConf(),
  };
}

const english = recognizeLine(
  multilingualApi,
  await readFixture("ocr-line.pgm.gz.base64"),
  "English",
);
const normalizedEnglish = english.text.replace(/\s+/g, " ").toUpperCase();
assert.match(normalizedEnglish, /LOCAL OCR SAMPLE/, "English representative words are recognized");
assert.match(normalizedEnglish, /12345/, "English representative digits are recognized");
assert.ok(
  english.confidence >= 80,
  `English confidence is at least 80%, received ${english.confidence}%`,
);

const japanese = recognizeLine(
  multilingualApi,
  await readFixture("ocr-japanese-line.pgm.gz.base64"),
  "Japanese",
);
const normalizedJapanese = japanese.text.replace(/\s+/g, " ");
assert.match(normalizedJapanese, /完全オフライン文字認識/, "Japanese phrase is recognized");
assert.match(normalizedJapanese, /文書番号 12345/, "Japanese label and digits are recognized");
assert.ok(
  japanese.confidence >= 80,
  `Japanese confidence is at least 80%, received ${japanese.confidence}%`,
);

multilingualApi.End();
if (typeof multilingualApi.delete === "function") multilingualApi.delete();

console.log(
  "Precision model smoke test passed: "
  + `${JSON.stringify(english.text)} (${english.confidence}%), `
  + `${JSON.stringify(japanese.text)} (${japanese.confidence}%); `
  + `horizontal jpn+eng initialization passed on core ${coreVersion}.`,
);
