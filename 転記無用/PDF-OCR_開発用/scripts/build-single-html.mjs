#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getVariantProfile, VARIANT_PROFILES } from "./variant-profiles.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const stylesheetPath = "./styles.css";

function sha256Source(source) {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

function assertRawTextSafe(source, tagName, sourceName) {
  if (new RegExp(`</${tagName}`, "i").test(source)) {
    throw new Error(`${sourceName} contains a closing ${tagName} tag and cannot be embedded safely.`);
  }
}

function stripSourceMapReference(source) {
  return source.replace(/^[ \t]*\/\/[#@]\s*sourceMappingURL=.*?(?:\r?\n|$)/gm, "");
}

function replaceExactlyOnce(source, searchValue, replacement, label) {
  const firstIndex = source.indexOf(searchValue);
  if (firstIndex < 0 || source.indexOf(searchValue, firstIndex + searchValue.length) >= 0) {
    throw new Error(`Expected exactly one ${label} in index.html.`);
  }
  return source.replace(searchValue, replacement);
}

function quoteForScript(value) {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function variantConfigSource(profile) {
  return `(function exposeScanScribeVariant(root) {\n  "use strict";\n  root.ScanScribeVariant = Object.freeze(${quoteForScript(profile.config)});\n})(window);`;
}

async function buildProfile(profileId, { writeCompatibilityAlias = false } = {}) {
  const profile = getVariantProfile(profileId);
  let html = await readFile(join(projectDirectory, "index.html"), "utf8");
  const [cssSource, thirdPartyNotices] = await Promise.all([
    readFile(join(projectDirectory, stylesheetPath), "utf8"),
    readFile(join(projectDirectory, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ]);
  const css = cssSource.trimEnd();
  html = replaceExactlyOnce(
    html,
    '<html lang="ja">',
    `<html lang="ja" data-single-file="true" data-variant="${profileId}">`,
    "root html tag",
  );
  assertRawTextSafe(css, "style", stylesheetPath);

  const styleContent = `\n${css}\n    `;
  const styleTag = `    <style data-bundled-source="${stylesheetPath}">${styleContent}</style>`;
  html = replaceExactlyOnce(
    html,
    `    <link rel="stylesheet" href="${stylesheetPath}">`,
    styleTag,
    "stylesheet reference",
  );

  const scriptEntries = [
    { htmlPath: "./offline-guard.js" },
    { htmlPath: "./browser-compat.js" },
    { htmlPath: "./vendor/pdf.min.js" },
    { htmlPath: "./vendor/pdf.worker.min.js" },
    { htmlPath: "./vendor/tesseract.min.js" },
    {
      htmlPath: "./vendor/offline-ocr-assets.js",
      diskPath: profile.assetBundle,
      marker: profile.assetBundle,
    },
    {
      marker: `[variant:${profileId}]`,
      source: variantConfigSource(profile),
    },
    { htmlPath: "./ocr-core.js" },
    { htmlPath: "./accuracy-core.js" },
    { htmlPath: "./app.js" },
  ];

  const embeddedScripts = [];
  const scriptHashes = [];
  for (const entry of scriptEntries) {
    const relativePath = entry.diskPath || entry.htmlPath;
    const source = stripSourceMapReference(
      entry.source ?? await readFile(join(projectDirectory, relativePath), "utf8"),
    ).trimEnd();
    assertRawTextSafe(source, "script", entry.marker || relativePath);

    const scriptContent = `\n${source}\n    `;
    scriptHashes.push(sha256Source(scriptContent));
    embeddedScripts.push(
      `    <script data-bundled-source="${entry.marker || relativePath}">${scriptContent}</script>`,
    );

    if (entry.htmlPath) {
      html = replaceExactlyOnce(
        html,
        `    <script defer src="${entry.htmlPath}"></script>\n`,
        "",
        `script reference for ${entry.htmlPath}`,
      );
    }
  }

  const styleHash = sha256Source(styleContent);
  const csp = [
    "default-src 'none'",
    `script-src ${scriptHashes.join(" ")} 'wasm-unsafe-eval'`,
    `style-src ${styleHash}`,
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
  ].join("; ");

  const cspPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*("\s*>)/;
  if (!cspPattern.test(html)) throw new Error("Content-Security-Policy meta tag was not found.");
  html = html.replace(cspPattern, `$1${csp}$2`);
  html = html.replace(
    "<title>ScanScribe — ローカルPDF文字起こし</title>",
    `<title>ScanScribe ${profile.config.label} — ローカルPDF文字起こし</title>`,
  );

  html = replaceExactlyOnce(
    html,
    "  </body>",
    `${embeddedScripts.join("\n")}\n  </body>`,
    "closing body tag",
  );
  const safeNotices = thirdPartyNotices.trim().replaceAll("--", "- -");
  html = replaceExactlyOnce(
    html,
    "</html>",
    `<!--\nBundled third-party notices:\n\n${safeNotices}\n-->\n</html>`,
    "closing html tag",
  );
  html = html.replace(
    "<!doctype html>",
    `<!doctype html>\n<!-- Generated ${profile.config.label} by scripts/build-single-html.mjs. All runtime assets are embedded below. -->`,
  );

  const outputPath = join(projectDirectory, profile.output);
  await writeFile(outputPath, html, "utf8");
  if (writeCompatibilityAlias) {
    await writeFile(join(projectDirectory, "ScanScribe.html"), html, "utf8");
  }

  const outputBytes = Buffer.byteLength(html, "utf8");
  const outputHash = createHash("sha256").update(html, "utf8").digest("hex");
  console.log(`Created ${outputPath}`);
  if (writeCompatibilityAlias) console.log("Updated ScanScribe.html compatibility alias.");
  console.log(`Size: ${(outputBytes / 1024 / 1024).toFixed(1)} MiB`);
  console.log(`SHA-256: ${outputHash}`);
}

const requested = process.argv[2] || "light";
if (requested === "all") {
  for (const profileId of Object.keys(VARIANT_PROFILES)) {
    await buildProfile(profileId, { writeCompatibilityAlias: profileId === "light" });
  }
} else {
  await buildProfile(requested, { writeCompatibilityAlias: requested === "light" });
}
