#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const require = createRequire(import.meta.url);

const assetBundleSource = await readFile(
  join(projectDirectory, "vendor", "offline-ocr-assets.js"),
  "utf8",
);
const bundleContext = vm.createContext({ window: {} });
vm.runInContext(assetBundleSource, bundleContext, {
  filename: "offline-ocr-assets.js",
  timeout: 30_000,
});
const assets = bundleContext.window.ScanScribeAssets;
assert.ok(assets?.tesseractCoreSource, "embedded OCR core is present");
assert.ok(assets?.models?.eng, "embedded English model is present");
assert.ok(assets?.models?.jpn, "embedded Japanese model is present");

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
  __filename: join(projectDirectory, "vendor", "tesseract-core-lstm.wasm.js"),
});
coreContext.global = coreContext;
vm.runInContext(assets.tesseractCoreSource, coreContext, {
  filename: "tesseract-core-lstm.wasm.js",
  timeout: 30_000,
});

const TessModule = await coreContext.TesseractCore({});
const trainedData = gunzipSync(Buffer.from(assets.models.eng, "base64"));
const japaneseTrainedData = gunzipSync(Buffer.from(assets.models.jpn, "base64"));
TessModule.FS.writeFile("/eng.traineddata", trainedData);
TessModule.FS.writeFile("/jpn.traineddata", japaneseTrainedData);

const api = new TessModule.TessBaseAPI();
const initStatus = api.Init(null, "jpn+eng", 1);
assert.equal(initStatus, 0, "embedded Japanese and English models initialize together");

const fixtureBase64 = await readFile(
  join(projectDirectory, "tests", "fixtures", "ocr-line.pgm.gz.base64"),
  "utf8",
);
const image = gunzipSync(Buffer.from(fixtureBase64.trim(), "base64"));
TessModule.FS.writeFile("/input", image);
assert.equal(api.SetImageFile(1, 0), 0, "real-font PGM fixture loads");
api.SetVariable("user_defined_dpi", "300");
api.SetVariable("preserve_interword_spaces", "1");
assert.equal(
  api.SetVariable("thresholding_method", "1"),
  true,
  "embedded OCR core supports Adaptive Otsu",
);
assert.equal(
  api.SetVariable("thresholding_method", "2"),
  true,
  "embedded OCR core supports Sauvola",
);
api.SetVariable("thresholding_method", "0");
api.SetPageSegMode(7);
assert.equal(api.Recognize(null), 0, "OCR core recognizes the fixture");

const text = String(api.GetUTF8Text() || "").trim();
const normalized = text.replace(/\s+/g, " ").toUpperCase();
const confidence = api.MeanTextConf();
assert.match(normalized, /LOCAL OCR SAMPLE/, "representative words are recognized");
assert.match(normalized, /12345/, "representative digits are recognized");
assert.ok(confidence >= 80, `confidence is at least 80%, received ${confidence}%`);

const japaneseFixtureBase64 = await readFile(
  join(projectDirectory, "tests", "fixtures", "ocr-japanese-line.pgm.gz.base64"),
  "utf8",
);
const japaneseImage = gunzipSync(Buffer.from(japaneseFixtureBase64.trim(), "base64"));
TessModule.FS.writeFile("/input", japaneseImage);
assert.equal(api.SetImageFile(1, 0), 0, "real-font Japanese PGM fixture loads");
api.SetPageSegMode(7);
assert.equal(api.Recognize(null), 0, "OCR core recognizes the Japanese fixture");

const japaneseText = String(api.GetUTF8Text() || "").trim();
const normalizedJapanese = japaneseText.replace(/\s+/g, " ");
const japaneseConfidence = api.MeanTextConf();
assert.match(
  normalizedJapanese,
  /完全オフライン文字認識/,
  "representative Japanese words are recognized",
);
assert.match(normalizedJapanese, /文書番号 12345/, "Japanese label and digits are recognized");
assert.ok(
  japaneseConfidence >= 80,
  `Japanese confidence is at least 80%, received ${japaneseConfidence}%`,
);

api.End();
if (typeof api.delete === "function") api.delete();

console.log(
  `Embedded OCR quality smoke test passed: ${JSON.stringify(text)} (${confidence}%), `
  + `${JSON.stringify(japaneseText)} (${japaneseConfidence}%).`,
);
