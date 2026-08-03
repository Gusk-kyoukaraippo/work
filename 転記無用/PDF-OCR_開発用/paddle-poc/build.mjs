#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const assets = Object.freeze({
  paddleWorker: {
    version: "@paddleocr/paddleocr-js@0.4.2",
    url: "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/assets/worker-entry-C9UNuyOJ.js",
    sha256: "477db3f009c118823a5f9ebe15f1e96c1c464165715ba28a9884290f61addf52",
  },
  ortWasm: {
    version: "onnxruntime-web@1.22.0",
    url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm",
    sha256: "b45970d0632383a057c27ca5b660b216f8e00c17cf8db9f6207b5e4abc839368",
  },
  paddleDet: {
    version: "PP-OCRv6_small_det (2026-06-09)",
    url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_det_onnx_infer.tar",
    sha256: "d218f6fbf0f1c23d2161bd6ac7f5eaa6104fa89955c09290497e31008e2618e4",
  },
  paddleRec: {
    version: "PP-OCRv6_small_rec (2026-06-09)",
    url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar",
    sha256: "d267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1",
  },
});

async function download(spec, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(spec.url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== spec.sha256) {
        throw new Error(`SHA-256 mismatch: expected ${spec.sha256}, received ${digest}`);
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`Unable to download ${spec.url}: ${lastError}`);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function pgmToPng(pgm) {
  let offset = 0;
  const tokens = [];
  while (tokens.length < 4) {
    while (offset < pgm.length && /\s/.test(String.fromCharCode(pgm[offset]))) offset += 1;
    if (pgm[offset] === 35) {
      while (offset < pgm.length && pgm[offset] !== 10) offset += 1;
      continue;
    }
    const start = offset;
    while (offset < pgm.length && !/\s/.test(String.fromCharCode(pgm[offset]))) offset += 1;
    tokens.push(pgm.subarray(start, offset).toString("ascii"));
  }
  if (tokens[0] !== "P5" || Number(tokens[3]) !== 255) {
    throw new Error(`Unsupported PGM header: ${tokens.join(" ")}`);
  }
  while (offset < pgm.length && /\s/.test(String.fromCharCode(pgm[offset]))) offset += 1;
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const pixels = pgm.subarray(offset, offset + width * height);
  if (pixels.length !== width * height) throw new Error("PGM pixel payload is truncated.");
  const scanlines = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (width + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, row * width, (row + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function escapeScriptEnd(source) {
  if (/<\/script/i.test(source)) {
    throw new Error("Embedded worker unexpectedly contains a closing script tag.");
  }
  return source;
}

function patchWorkerForFileProtocol(workerBytes) {
  const source = workerBytes.toString("utf8");
  const matches = source.match(/import\.meta\.url/g) || [];
  if (matches.length !== 11) {
    throw new Error(`Expected 11 import.meta.url expressions, received ${matches.length}.`);
  }
  // The published bundle is otherwise self-contained. A classic blob worker is
  // allowed from file:, while Chrome refuses the same opaque blob URL as a
  // top-level module worker. Dynamic import expressions remain syntactically
  // valid; the embedded ORT glue avoids that fallback path in this build.
  return Buffer.from(source.replaceAll("import.meta.url", "self.location.href"), "utf8");
}

function htmlDocument({ runtime, worker, ort, det, rec, sample, lock }) {
  const nonce = "paddle-poc-v1";
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' 'unsafe-eval' blob:; worker-src blob:; connect-src blob:; img-src data: blob:; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PP-OCRv6 small — single-file offline PoC</title>
  <style nonce="${nonce}">
    :root{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;color:#19202a;background:#f3f5f8}body{max-width:980px;margin:0 auto;padding:32px}main{display:grid;gap:20px}.card{background:#fff;border:1px solid #dce1e8;border-radius:14px;padding:20px;box-shadow:0 5px 18px #1420330d}.badge{display:inline-block;padding:5px 10px;border-radius:999px;background:#e7f6ee;color:#17663d;font-weight:700}h1{margin:.4em 0;font-size:clamp(1.7rem,4vw,2.5rem)}button,input{font:inherit}button{padding:10px 16px;border:0;border-radius:9px;background:#155eef;color:#fff;font-weight:700;cursor:pointer}button:disabled{opacity:.55}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.status{font-size:1.15rem;font-weight:800}.detail{color:#596579}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media(max-width:760px){.grid{grid-template-columns:1fr}}img{display:block;max-width:100%;max-height:300px;border:1px solid #dce1e8;background:#fff}textarea,pre{box-sizing:border-box;width:100%;min-height:130px;border:1px solid #cfd6df;border-radius:9px;padding:12px;background:#fbfcfe;white-space:pre-wrap;overflow:auto}details pre{max-height:280px;font-size:.8rem}.small{font-size:.85rem;color:#596579}code{word-break:break-all}
  </style>
</head>
<body>
<main>
  <header><span class="badge">file://・通信なし・単一HTML</span><h1>PP-OCRv6 small オフラインPoC</h1><p>公式PaddleOCR.js Worker、ONNX Runtime WASM、検出・認識モデルをすべてこのHTML内に固定しています。</p></header>
  <section class="card"><div id="status" class="status">起動準備中</div><p id="detail" class="detail">HTMLを解析しています</p><div class="controls"><button id="runSample" type="button">固定サンプルを再実行</button><label>画像を選択 <input id="imageFile" type="file" accept="image/png,image/jpeg,image/webp"></label></div></section>
  <section class="grid"><div class="card"><h2>入力</h2><img id="preview" alt="OCR入力" hidden></div><div class="card"><h2>認識文字列</h2><textarea id="output" spellcheck="false"></textarea></div></section>
  <section class="card"><h2>実行ログ</h2><div id="log" class="small"></div><details><summary>認識座標・時間</summary><pre id="metrics"></pre></details></section>
  <section class="card small"><h2>固定資産</h2><pre>${escapeHtml(JSON.stringify(lock, null, 2))}</pre><p>Licenses: PaddleOCR/PaddleOCR.js/OpenCV.js = Apache-2.0; ONNX Runtime/js-yaml = MIT; clipper-lib = Boost-1.0. 詳細は生成元フォルダのTHIRD_PARTY_NOTICES.mdを参照してください。</p></section>
</main>
<script nonce="${nonce}" type="application/octet-stream" id="asset-ort-wasm">${ort.toString("base64")}</script>
<script nonce="${nonce}" type="application/octet-stream" id="asset-paddle-det">${det.toString("base64")}</script>
<script nonce="${nonce}" type="application/octet-stream" id="asset-paddle-rec">${rec.toString("base64")}</script>
<script nonce="${nonce}" type="application/octet-stream" id="asset-sample">${sample.toString("base64")}</script>
<script nonce="${nonce}" type="text/plain" id="asset-paddle-worker">${escapeScriptEnd(worker.toString("utf8"))}</script>
<script nonce="${nonce}">${runtime}</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[character]);
}

const downloaded = {};
for (const [name, spec] of Object.entries(assets)) {
  process.stdout.write(`Fetching ${name}... `);
  downloaded[name] = await download(spec);
  console.log(`${downloaded[name].length} bytes, SHA-256 OK`);
}

const fixtureText = await readFile(
  join(root, "tests", "fixtures", "ocr-japanese-line.pgm.gz.base64"),
  "utf8",
);
const samplePng = pgmToPng(gunzipSync(Buffer.from(fixtureText.trim(), "base64")));
const runtime = await readFile(join(here, "runtime.js"), "utf8");
if (/<\/script/i.test(runtime)) throw new Error("runtime.js contains a closing script tag.");

const lock = Object.fromEntries(Object.entries(assets).map(([name, spec]) => [name, {
  version: spec.version,
  url: spec.url,
  sha256: spec.sha256,
  bytes: downloaded[name].length,
}]));
const patchedWorker = patchWorkerForFileProtocol(downloaded.paddleWorker);
lock.paddleWorker.patchedSha256 = createHash("sha256").update(patchedWorker).digest("hex");
lock.paddleWorker.patch = "11 x import.meta.url -> self.location.href for classic blob Worker on file:";
lock.sample = {
  source: "tests/fixtures/ocr-japanese-line.pgm.gz.base64",
  sha256: createHash("sha256").update(samplePng).digest("hex"),
  bytes: samplePng.length,
};

await writeFile(join(here, "assets.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
await writeFile(join(here, "index.html"), htmlDocument({
  runtime,
  worker: patchedWorker,
  ort: downloaded.ortWasm,
  det: downloaded.paddleDet,
  rec: downloaded.paddleRec,
  sample: samplePng,
  lock,
}));
const stat = await import("node:fs/promises").then(({ stat }) => stat(join(here, "index.html")));
console.log(`Wrote ${join(here, "index.html")} (${(stat.size / 1024 / 1024).toFixed(1)} MiB)`);
