#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const outputDirectory = join(projectDirectory, "vendor-precision");
const baseBundlePath = join(projectDirectory, "vendor", "offline-ocr-assets.js");
const baseManifestPath = join(projectDirectory, "vendor", "MANIFEST.json");

// Immutable upstream revision. Do not replace this with a branch or tag URL.
const TESSDATA_BEST_COMMIT = "e12c65a915945e4c28e237a9b52bc4a8f39a0cec";
const TESSDATA_BEST_REPOSITORY = "https://github.com/tesseract-ocr/tessdata_best";
const RAW_PREFIX = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/${TESSDATA_BEST_COMMIT}/`;

const models = Object.freeze({
  eng: Object.freeze({
    sourceSha256: "8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba",
    sourceBytes: 15_400_601,
  }),
  jpn: Object.freeze({
    sourceSha256: "36bdf9ac823f5911e624c30d0553e890b8abc7c31a65b3ef14da943658c40b79",
    sourceBytes: 14_330_109,
  }),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quoteForScript(value) {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

async function downloadModel(language, expected) {
  const sourceFile = `${language}.traineddata`;
  const url = `${RAW_PREFIX}${sourceFile}`;
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "raw.githubusercontent.com") {
    throw new Error(`Refusing non-GitHub-raw model URL: ${url}`);
  }

  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  if (response.url !== url) {
    throw new Error(`Unexpected model response URL: ${response.url}`);
  }

  const source = Buffer.from(await response.arrayBuffer());
  const actualSourceHash = sha256(source);
  if (source.length !== expected.sourceBytes || actualSourceHash !== expected.sourceSha256) {
    throw new Error(
      `Pinned model verification failed for ${language}\n`
      + `expected bytes/hash: ${expected.sourceBytes} ${expected.sourceSha256}\n`
      + `actual bytes/hash:   ${source.length} ${actualSourceHash}`,
    );
  }

  // Node emits a zero mtime gzip header. Supplying mtime documents the reproducibility intent.
  const gzip = gzipSync(source, { level: 9, mtime: 0 });
  if (!gzip.subarray(4, 8).equals(Buffer.alloc(4))) {
    throw new Error(`Non-deterministic gzip mtime header for ${language}`);
  }

  return {
    language,
    sourceFile,
    sourceUrl: url,
    source,
    gzip,
    gzipFile: `${sourceFile}.gz`,
  };
}

async function loadPinnedRuntime() {
  const [bundleSource, manifestSource] = await Promise.all([
    readFile(baseBundlePath, "utf8"),
    readFile(baseManifestPath, "utf8"),
  ]);
  const baseManifest = JSON.parse(manifestSource);
  const bundleHash = sha256(bundleSource);
  if (bundleHash !== baseManifest.bundle?.sha256) {
    throw new Error(
      `Base OCR bundle SHA-256 mismatch\n`
      + `expected: ${baseManifest.bundle?.sha256}\nactual:   ${bundleHash}`,
    );
  }

  const context = vm.createContext({ window: {} });
  vm.runInContext(bundleSource, context, {
    filename: relative(projectDirectory, baseBundlePath),
    timeout: 30_000,
  });
  const assets = context.window.ScanScribeAssets;
  if (!assets?.tesseractWorkerSource || !assets?.tesseractCoreSource) {
    throw new Error("Base OCR bundle does not expose the pinned worker/core sources.");
  }
  if (assets.versions?.tesseract !== "7.0.0" || assets.versions?.tesseractCore !== "7.0.0") {
    throw new Error("Precision assets require the existing Tesseract.js/core 7.0.0 runtime.");
  }

  const patchedWorker = baseManifest.patches?.find(
    (patch) => patch.asset === "tesseractWorker",
  );
  const workerHash = sha256(assets.tesseractWorkerSource);
  const coreHash = sha256(assets.tesseractCoreSource);
  if (workerHash !== patchedWorker?.patchedSha256) {
    throw new Error("Pinned patched Tesseract worker SHA-256 mismatch.");
  }
  if (coreHash !== baseManifest.assets?.tesseractCore?.sha256) {
    throw new Error("Pinned Tesseract core SHA-256 mismatch.");
  }

  return {
    assets,
    bundleHash,
    workerHash,
    coreHash,
  };
}

const [runtime, downloadedEntries] = await Promise.all([
  loadPinnedRuntime(),
  Promise.all(
    Object.entries(models).map(([language, expected]) => downloadModel(language, expected)),
  ),
]);

const downloaded = Object.fromEntries(
  downloadedEntries.map((entry) => [entry.language, entry]),
);

const modelMetadata = Object.fromEntries(
  Object.keys(models).map((language) => {
    const entry = downloaded[language];
    return [language, Object.freeze({
      family: "tessdata_best",
      upstreamCommit: TESSDATA_BEST_COMMIT,
      sourceSha256: models[language].sourceSha256,
      gzipSha256: sha256(entry.gzip),
      gzipBytes: entry.gzip.length,
    })];
  }),
);

const bundleSource = `/*
 * Generated by scripts/vendor-precision-models.mjs.
 * Precision OCR runtime for a completely offline file:// deployment.
 * Models are official tessdata_best files pinned to an immutable Git commit.
 */
(function exposeScanScribeAssets(root) {
  "use strict";
  const assets = {
    versions: Object.freeze({
      pdfjs: ${quoteForScript(runtime.assets.versions.pdfjs)},
      tesseract: "7.0.0",
      tesseractCore: "7.0.0",
      languageData: ${quoteForScript(`tessdata_best@${TESSDATA_BEST_COMMIT}`)},
    }),
    tesseractWorkerSource: ${quoteForScript(runtime.assets.tesseractWorkerSource)},
    tesseractCoreSource: ${quoteForScript(runtime.assets.tesseractCoreSource)},
    models: Object.freeze({
      jpn: ${quoteForScript(downloaded.jpn.gzip.toString("base64"))},
      eng: ${quoteForScript(downloaded.eng.gzip.toString("base64"))},
    }),
    modelMetadata: Object.freeze(${JSON.stringify(modelMetadata)}),
  };
  root.ScanScribeAssets = Object.freeze(assets);
})(window);
`;

const manifest = {
  schemaVersion: 1,
  purpose: "Pinned float tessdata_best models for maximum-accuracy offline OCR",
  upstream: {
    repository: TESSDATA_BEST_REPOSITORY,
    commit: TESSDATA_BEST_COMMIT,
    retrievalPolicy: "Immutable raw.githubusercontent.com URLs only; redirects rejected",
  },
  compression: {
    format: "gzip",
    level: 9,
    mtime: 0,
    implementation: "node:zlib gzipSync",
  },
  runtime: {
    derivedFrom: "vendor/offline-ocr-assets.js",
    derivedBundleSha256: runtime.bundleHash,
    tesseractJs: "7.0.0",
    tesseractCore: "7.0.0",
    embeddedTesseract: "5.1.0-288-g2a9c1",
    oem: "LSTM_ONLY (1)",
    workerSha256: runtime.workerHash,
    coreSha256: runtime.coreHash,
    smokeCommand: "node scripts/smoke-precision-models.mjs",
  },
  bundle: {
    file: "offline-ocr-assets.js",
    sha256: sha256(bundleSource),
    bytes: Buffer.byteLength(bundleSource, "utf8"),
  },
  models: Object.fromEntries(
    Object.keys(models).map((language) => {
      const entry = downloaded[language];
      const base64Bytes = Buffer.byteLength(entry.gzip.toString("base64"), "ascii");
      return [language, {
        sourceFile: entry.sourceFile,
        sourceUrl: entry.sourceUrl,
        sourceSha256: models[language].sourceSha256,
        sourceBytes: entry.source.length,
        gzipFile: entry.gzipFile,
        gzipSha256: sha256(entry.gzip),
        gzipBytes: entry.gzip.length,
        base64Bytes,
      }];
    }),
  ),
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  ...Object.values(downloaded).map((entry) => (
    writeFile(join(outputDirectory, entry.gzipFile), entry.gzip)
  )),
  writeFile(join(outputDirectory, "offline-ocr-assets.js"), bundleSource, "utf8"),
  writeFile(
    join(outputDirectory, "MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  ),
]);

const compressedBytes = Object.values(downloaded)
  .reduce((total, entry) => total + entry.gzip.length, 0);
console.log(
  `Precision OCR assets created: ${Object.keys(models).join(", ")} `
  + `(${(compressedBytes / 1024 / 1024).toFixed(2)} MiB gzip; `
  + `${(manifest.bundle.bytes / 1024 / 1024).toFixed(2)} MiB embeddable bundle).`,
);
