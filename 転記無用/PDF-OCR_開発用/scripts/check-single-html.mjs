#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { getVariantProfile, VARIANT_PROFILES } from "./variant-profiles.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");

function fail(profileId, message) {
  throw new Error(`[${profileId}] ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stripSourceMapReference(source) {
  return source.replace(/^[ \t]*\/\/[#@]\s*sourceMappingURL=.*?(?:\r?\n|$)/gm, "");
}

async function checkProfile(profileId, { compatibilityAlias = false } = {}) {
  const profile = getVariantProfile(profileId);
  const outputName = compatibilityAlias ? "ScanScribe.html" : profile.output;
  const outputPath = join(projectDirectory, outputName);
  const assetPath = join(projectDirectory, profile.assetBundle);
  const manifestPath = join(dirname(assetPath), "MANIFEST.json");
  const [html, outputStats, assetSource, manifestSource] = await Promise.all([
    readFile(outputPath, "utf8"),
    stat(outputPath),
    readFile(assetPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  if (sha256(assetSource) !== manifest.bundle?.sha256) {
    fail(profileId, `${profile.assetBundle} does not match its manifest SHA-256.`);
  }

  if (outputStats.size < 8 * 1024 * 1024) {
    fail(profileId, `${outputName} is unexpectedly small; OCR assets may be missing.`);
  }
  if (!html.includes(
    `<html lang="ja" data-single-file="true" data-variant="${profileId}">`,
  )) {
    fail(profileId, "The single-file runtime marker is missing or incorrect.");
  }
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) fail(profileId, "An external script reference remains.");
  if (/<link\b[^>]*\brel=["']stylesheet["']/i.test(html)) {
    fail(profileId, "An external stylesheet reference remains.");
  }
  if (/<(?:img|audio|video|source|iframe)\b[^>]*\bsrc=["'](?!data:|blob:)/i.test(html)) {
    fail(profileId, "An external media reference remains.");
  }

  for (const source of [
    "./styles.css",
    "./offline-guard.js",
    "./browser-compat.js",
    "./vendor/pdf.min.js",
    "./vendor/pdf.worker.min.js",
    "./vendor/tesseract.min.js",
    profile.assetBundle,
    `[variant:${profileId}]`,
    "./ocr-core.js",
    "./accuracy-core.js",
    "./app.js",
  ]) {
    if (!html.includes(`data-bundled-source="${source}"`)) {
      fail(profileId, `Embedded source marker is missing: ${source}`);
    }
  }

  for (const marker of [
    "ScanScribeNetworkGuard",
    "ScanScribeBrowserCompat",
    "WorkerMessageHandler",
    "Tesseract",
    "tesseractWorkerSource",
    "tesseractCoreSource",
    "jpn:",
    "eng:",
    "initializeOcrCore",
    "initializeAccuracyCore",
    "initializeScanScribe",
    "if (!IS_SINGLE_FILE_BUILD)",
    `\"id\":\"${profileId}\"`,
    "Bundled third-party notices:",
    "PDF.js 3.11.174",
    "Tesseract.js 7.0.0",
  ]) {
    if (!html.includes(marker)) fail(profileId, `Runtime marker is missing: ${marker}`);
  }
  for (const model of profile.config.requiredModels) {
    if (!html.includes(`${model}:`)) fail(profileId, `Required OCR model is missing: ${model}`);
  }

  const assetOpenTag = `<script data-bundled-source="${profile.assetBundle}">`;
  const assetStart = html.indexOf(assetOpenTag);
  const assetContentStart = assetStart + assetOpenTag.length;
  const assetContentEnd = html.indexOf("</script>", assetContentStart);
  if (assetStart < 0 || assetContentEnd < 0) {
    fail(profileId, "The embedded OCR asset script could not be located.");
  }
  const embeddedAssetSource = html.slice(assetContentStart, assetContentEnd);
  const expectedAssetSource = `\n${stripSourceMapReference(assetSource).trimEnd()}\n    `;
  if (embeddedAssetSource !== expectedAssetSource) {
    fail(profileId, "The embedded OCR asset script differs from the pinned source file.");
  }
  const assetContext = vm.createContext({ window: {} });
  new vm.Script(embeddedAssetSource, { filename: `${outputName}:ocr-assets` })
    .runInContext(assetContext, { timeout: 30_000 });
  const embeddedModels = Object.keys(assetContext.window.ScanScribeAssets?.models || {}).sort();
  const expectedModels = [...profile.config.requiredModels].sort();
  if (JSON.stringify(embeddedModels) !== JSON.stringify(expectedModels)) {
    fail(
      profileId,
      `Embedded OCR model keys must be exactly ${expectedModels.join(", ")}; received ${embeddedModels.join(", ") || "none"}.`,
    );
  }

  const cspMatch = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/,
  );
  if (!cspMatch) fail(profileId, "The generated HTML has no CSP.");
  const csp = cspMatch[1];
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "worker-src blob:",
    "img-src data: blob:",
    "object-src 'none'",
    "'wasm-unsafe-eval'",
  ]) {
    if (!csp.includes(directive)) fail(profileId, `Generated CSP is missing: ${directive}`);
  }
  if (csp.includes("'unsafe-inline'") || /(?:^|\s)'unsafe-eval'(?:\s|;|$)/.test(csp)) {
    fail(profileId, "Generated CSP must not allow general inline or eval execution.");
  }

  const styleMatch = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) fail(profileId, "Embedded stylesheet was not found.");
  const expectedStyleHash = createHash("sha256")
    .update(styleMatch[1], "utf8")
    .digest("base64");
  if (!csp.includes(`'sha256-${expectedStyleHash}'`)) {
    fail(profileId, "Embedded stylesheet does not match its CSP hash.");
  }

  const scriptMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (scriptMatches.length !== 10) {
    fail(profileId, `Expected 10 embedded scripts, found ${scriptMatches.length}.`);
  }
  for (const [index, match] of scriptMatches.entries()) {
    const hash = createHash("sha256").update(match[1], "utf8").digest("base64");
    if (!csp.includes(`'sha256-${hash}'`)) {
      fail(profileId, "An embedded script does not match its CSP hash.");
    }
    try {
      new vm.Script(match[1], {
        filename: `${outputName}:embedded-script-${index + 1}`,
      });
    } catch (error) {
      fail(profileId, `Embedded script ${index + 1} has invalid JavaScript: ${error.message}`);
    }
  }

  console.log(
    `${profile.config.label} checks passed (${(outputStats.size / 1024 / 1024).toFixed(1)} MiB, 10 scripts).`,
  );
}

const requested = process.argv[2] || "light";
if (requested === "all") {
  for (const profileId of Object.keys(VARIANT_PROFILES)) await checkProfile(profileId);
  await checkProfile("light", { compatibilityAlias: true });
} else {
  await checkProfile(requested, { compatibilityAlias: requested === "light" });
}

if (requested === "all" || requested === "light") {
  const [light, alias] = await Promise.all([
    readFile(join(projectDirectory, VARIANT_PROFILES.light.output)),
    readFile(join(projectDirectory, "ScanScribe.html")),
  ]);
  if (!light.equals(alias)) fail("light", "ScanScribe.html must be byte-identical to ScanScribe-light.html.");
}
