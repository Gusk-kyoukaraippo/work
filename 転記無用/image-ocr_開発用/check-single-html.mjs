#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const sharedProjectDirectory = join(projectDirectory, "../PDF-OCR_開発用");
const outputPath = join(projectDirectory, "ScanScribe-Image.html");
const html = await readFile(outputPath, "utf8");
const outputStat = await stat(outputPath);
const markupOnly = html
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[\s\S]*?<\/style>/gi, "")
  .replace(/<!--[\s\S]*?-->/g, "");
const sha256Hex = (source) => createHash("sha256").update(source).digest("hex");

function stripSourceMapReference(source) {
  return source.replace(/^[ \t]*\/\/[#@]\s*sourceMappingURL=.*?(?:\r?\n|$)/gm, "");
}

assert.ok(outputStat.size > 30 * 1024 * 1024, "precision single HTML should include OCR models");
assert.match(html, /<html lang="ja" data-single-file="true" data-variant="image-precision">/);
assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i, "runtime script references must be embedded");
assert.doesNotMatch(html, /<link\b[^>]*rel="stylesheet"/i, "stylesheet must be embedded");
assert.doesNotMatch(
  markupOnly,
  /<(?:img|audio|video|source|iframe)\b[^>]*\bsrc\s*=/i,
  "external media references are forbidden",
);
assert.doesNotMatch(markupOnly, /\b(?:srcset|poster)\s*=/i, "external media attributes are forbidden");
assert.doesNotMatch(
  markupOnly,
  /<meta\b[^>]*http-equiv=["']?refresh/i,
  "meta refresh is forbidden",
);
assert.doesNotMatch(html, /pdf\.min\.js|pdf\.worker|pdfjsLib/, "image build must not bundle PDF.js");
assert.match(html, /connect-src 'none'/);
assert.match(html, /worker-src blob:/);
assert.match(html, /img-src data: blob:/);
assert.match(html, /object-src 'none'/);
assert.match(html, /base-uri 'none'/);

const scriptMatches = [...html.matchAll(/<script data-bundled-source="([^"]+)">([\s\S]*?)<\/script>/g)];
assert.equal(scriptMatches.length, 8, "expected eight embedded runtime scripts");
assert.equal((html.match(/<script\b/gi) || []).length, 8, "markerless inline scripts are forbidden");
const expectedMarkers = [
  "../PDF-OCR_開発用/offline-guard.js",
  "../PDF-OCR_開発用/browser-compat.js",
  "../PDF-OCR_開発用/vendor/tesseract.min.js",
  "../PDF-OCR_開発用/vendor-precision/offline-ocr-assets.js",
  "../PDF-OCR_開発用/ocr-core.js",
  "../PDF-OCR_開発用/accuracy-core.js",
  "./image-core.js",
  "./app.js",
];
assert.deepEqual(scriptMatches.map((match) => match[1]), expectedMarkers);
for (const match of scriptMatches) {
  const sharedPrefix = "../PDF-OCR_開発用/";
  const sourcePath = match[1].startsWith(sharedPrefix)
    ? join(sharedProjectDirectory, match[1].slice(sharedPrefix.length))
    : join(projectDirectory, match[1]);
  const source = stripSourceMapReference(
    await readFile(sourcePath, "utf8"),
  ).trimEnd();
  assert.equal(match[2], `\n${source}\n    `, `embedded ${match[1]} is stale or modified`);
}
const firstPartyRuntime = scriptMatches
  .filter((match) => match[1] === "./image-core.js" || match[1] === "./app.js")
  .map((match) => match[2])
  .join("\n");
assert.doesNotMatch(
  firstPartyRuntime,
  /localStorage|sessionStorage|indexedDB/i,
  "first-party runtime must not persist user data",
);
new Script(firstPartyRuntime, { filename: "first-party-runtime.js" });
for (const match of scriptMatches) {
  new Script(match[2], { filename: match[1] });
}

const styleMatch = html.match(/<style data-bundled-source="\.\/styles\.css">([\s\S]*?)<\/style>/);
assert.ok(styleMatch, "embedded stylesheet marker is required");
assert.equal((html.match(/<style\b/gi) || []).length, 1, "unexpected inline style block");
const stylesheetSource = (await readFile(join(projectDirectory, "styles.css"), "utf8")).trimEnd();
assert.equal(styleMatch[1], `\n${stylesheetSource}\n    `, "embedded stylesheet is stale or modified");
const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
assert.ok(cspMatch, "CSP meta tag is required");
const csp = cspMatch[1];
const hash = (source) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
const directives = csp.split(";").map((entry) => entry.trim()).filter(Boolean);
assert.deepEqual(
  directives.map((entry) => entry.split(/\s+/, 1)[0]),
  [
    "default-src",
    "script-src",
    "style-src",
    "worker-src",
    "child-src",
    "connect-src",
    "img-src",
    "font-src",
    "media-src",
    "object-src",
    "frame-src",
    "manifest-src",
    "base-uri",
    "form-action",
  ],
  "CSP directive set must remain exact",
);
for (const exactDirective of [
  "default-src 'none'",
  "worker-src blob:",
  "child-src blob:",
  "connect-src 'none'",
  "img-src data: blob:",
  "font-src data: blob:",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]) {
  assert.ok(directives.includes(exactDirective), `CSP must contain exactly: ${exactDirective}`);
}
for (const match of scriptMatches) {
  assert.ok(csp.includes(hash(match[2])), `CSP hash missing for ${match[1]}`);
}
assert.ok(csp.includes(hash(styleMatch[1])), "CSP hash missing for stylesheet");
assert.ok(
  directives.includes(`script-src ${scriptMatches.map((match) => hash(match[2])).join(" ")} 'wasm-unsafe-eval'`),
  "script-src may contain only the eight embedded script hashes and WebAssembly allowance",
);
assert.ok(
  directives.includes(`style-src ${hash(styleMatch[1])}`),
  "style-src may contain only the embedded stylesheet hash",
);
assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/, "unsafe CSP allowances are forbidden");
assert.match(csp, /'wasm-unsafe-eval'/, "WebAssembly allowance is required for OCR");

for (const match of markupOnly.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
  assert.ok(match[2].startsWith("#"), `only same-document hrefs are allowed: ${match[2]}`);
}

const [vendorManifest, precisionManifest, tesseractBytes, modelBundleBytes] = await Promise.all([
  readFile(join(sharedProjectDirectory, "vendor/MANIFEST.json"), "utf8").then(JSON.parse),
  readFile(join(sharedProjectDirectory, "vendor-precision/MANIFEST.json"), "utf8").then(JSON.parse),
  readFile(join(sharedProjectDirectory, "vendor/tesseract.min.js")),
  readFile(join(sharedProjectDirectory, "vendor-precision/offline-ocr-assets.js")),
]);
assert.equal(tesseractBytes.length, vendorManifest.assets.tesseractMain.bytes);
assert.equal(sha256Hex(tesseractBytes), vendorManifest.assets.tesseractMain.sha256);
assert.equal(modelBundleBytes.length, precisionManifest.bundle.bytes);
assert.equal(sha256Hex(modelBundleBytes), precisionManifest.bundle.sha256);
assert.deepEqual(Object.keys(precisionManifest.models).sort(), ["eng", "jpn"]);

assert.match(html, /ScanScribeNetworkGuard/);
assert.match(html, /scanscribe-image-ocr-result/);
assert.match(html, /clipboardData/);
assert.match(html, /navigator\.clipboard/);
assert.match(html, /PNG・JPEG・WebP/);
assert.match(html, /Bundled third-party notices:/);

console.log("Single HTML verification passed.");
console.log(`Verified size: ${(outputStat.size / 1024 / 1024).toFixed(1)} MiB`);
