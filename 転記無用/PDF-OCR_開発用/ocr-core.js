(function initializeOcrCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.OcrCore = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createOcrCore() {
  "use strict";

  const ALL_PAGE_WORDS = new Set(["*", "all", "すべて", "全て", "全部"]);
  const RESULT_STATUSES = new Set(["success", "warning", "failed", "cancelled"]);
  const MAX_DICTIONARY_ENTRIES = 5000;
  const MAX_DICTIONARY_BYTES = 5 * 1024 * 1024;
  const MAX_DICTIONARY_TOTAL_FROM_CHARS = 100_000;
  const MAX_CORRECTED_TEXT_CHARS = 5_000_000;
  const MAX_HISTORY_BYTES = 20 * 1024 * 1024;
  const MAX_HISTORY_RESULTS = 1000;
  const MAX_HISTORY_CANDIDATES = 24;
  const MAX_HISTORY_METADATA_CHARS = 2000;
  const MAX_HISTORY_COMBINED_TEXT_CHARS = 20_000_000;
  const HISTORY_RESULT_STATUSES = new Set(["success", "warning", "failed"]);

  class OcrInputError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "OcrInputError";
      this.code = code;
    }
  }

  function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
  }

  function pageList(totalPages) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  function parsePageRange(input, totalPages) {
    assertPositiveInteger(totalPages, "totalPages");

    const raw = String(input ?? "").trim();
    const normalizedKeyword = raw.normalize("NFKC").toLocaleLowerCase("ja-JP");
    if (ALL_PAGE_WORDS.has(normalizedKeyword)) {
      const pages = pageList(totalPages);
      return { pages, normalized: totalPages === 1 ? "1" : `1-${totalPages}` };
    }

    const normalizedInput = raw
      .normalize("NFKC")
      .replace(/[、，;；]/g, ",")
      .replace(/[‐‑‒–—−ー〜～~]/g, "-")
      .replace(/\s*-\s*/g, "-");

    if (
      normalizedInput.startsWith(",")
      || normalizedInput.endsWith(",")
      || /,{2,}/.test(normalizedInput)
    ) {
      throw new OcrInputError("ページ指定に空の項目があります。", "PAGE_RANGE_EMPTY_ITEM");
    }

    const tokens = normalizedInput.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) {
      throw new OcrInputError("対象ページを入力してください。", "PAGE_RANGE_EMPTY");
    }

    const selected = new Set();
    for (const token of tokens) {
      const singleMatch = token.match(/^(\d+)$/);
      const rangeMatch = token.match(/^(\d+)-(\d+)$/);

      if (singleMatch) {
        const page = Number(singleMatch[1]);
        validatePageNumber(page, totalPages);
        selected.add(page);
        continue;
      }

      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        validatePageNumber(start, totalPages);
        validatePageNumber(end, totalPages);
        if (start > end) {
          throw new OcrInputError(
            `${token} は開始ページが終了ページより後になっています。`,
            "PAGE_RANGE_REVERSED",
          );
        }
        for (let page = start; page <= end; page += 1) {
          selected.add(page);
        }
        continue;
      }

      throw new OcrInputError(
        `「${token}」を読み取れません。1-3, 5 のように入力してください。`,
        "PAGE_RANGE_SYNTAX",
      );
    }

    const pages = [...selected].sort((left, right) => left - right);
    return { pages, normalized: collapsePageList(pages) };
  }

  function validatePageNumber(page, totalPages) {
    if (!Number.isSafeInteger(page) || page < 1 || page > totalPages) {
      throw new OcrInputError(
        `ページ番号は1〜${totalPages}の範囲で指定してください。`,
        "PAGE_RANGE_OUT_OF_BOUNDS",
      );
    }
  }

  function collapsePageList(pages) {
    if (!Array.isArray(pages) || pages.length === 0) return "";

    const ranges = [];
    let start = pages[0];
    let previous = pages[0];

    for (let index = 1; index <= pages.length; index += 1) {
      const current = pages[index];
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      ranges.push(start === previous ? String(start) : `${start}-${previous}`);
      start = current;
      previous = current;
    }
    return ranges.join(", ");
  }

  function calculateRenderScale(
    width,
    height,
    requestedScale,
    maxPixels = 8_000_000,
    maxDimension = 8192,
  ) {
    for (const [value, name] of [
      [width, "width"],
      [height, "height"],
      [requestedScale, "requestedScale"],
      [maxPixels, "maxPixels"],
      [maxDimension, "maxDimension"],
    ]) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive finite number.`);
      }
    }

    const pixelLimitedScale = Math.sqrt(maxPixels / (width * height));
    const dimensionLimitedScale = maxDimension / Math.max(width, height);
    const scale = Math.min(requestedScale, pixelLimitedScale, dimensionLimitedScale);
    const floored = Math.floor(scale * 1000) / 1000;
    return floored > 0 ? floored : scale;
  }

  function normalizeRegion(startX, startY, endX, endY) {
    const values = [startX, startY, endX, endY].map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError("Region coordinates must be finite numbers.");
    }
    const [rawStartX, rawStartY, rawEndX, rawEndY] = values;
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const left = clamp(Math.min(rawStartX, rawEndX));
    const top = clamp(Math.min(rawStartY, rawEndY));
    const right = clamp(Math.max(rawStartX, rawEndX));
    const bottom = clamp(Math.max(rawStartY, rawEndY));
    if (right <= left || bottom <= top) return null;
    const stable = (value) => Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
    return Object.freeze({
      x: stable(left),
      y: stable(top),
      width: stable(right - left),
      height: stable(bottom - top),
    });
  }

  function regionToPixels(region, canvasWidth, canvasHeight) {
    assertPositiveInteger(canvasWidth, "canvasWidth");
    assertPositiveInteger(canvasHeight, "canvasHeight");
    if (!region || typeof region !== "object") {
      throw new TypeError("region must be an object.");
    }
    const normalized = normalizeRegion(
      region.x,
      region.y,
      Number(region.x) + Number(region.width),
      Number(region.y) + Number(region.height),
    );
    if (!normalized) {
      throw new OcrInputError("選択範囲が空です。", "REGION_EMPTY");
    }
    const left = Math.max(0, Math.min(canvasWidth - 1, Math.floor(normalized.x * canvasWidth)));
    const top = Math.max(0, Math.min(canvasHeight - 1, Math.floor(normalized.y * canvasHeight)));
    const right = Math.max(left + 1, Math.min(canvasWidth, Math.ceil(
      (normalized.x + normalized.width) * canvasWidth,
    )));
    const bottom = Math.max(top + 1, Math.min(canvasHeight, Math.ceil(
      (normalized.y + normalized.height) * canvasHeight,
    )));
    return Object.freeze({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }

  function selectOcrCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new TypeError("candidates must be a non-empty array.");
    }
    const evaluated = candidates.map((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        throw new TypeError("Each OCR candidate must be an object.");
      }
      const text = String(candidate.text ?? "");
      const meaningfulCharacters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
      const suspiciousCharacters = (
        text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g) || []
      ).length;
      const confidence = Number.isFinite(Number(candidate.confidence))
        ? Math.max(0, Math.min(100, Number(candidate.confidence)))
        : 0;
      const score = confidence
        + Math.min(meaningfulCharacters, 40) * 0.02
        - suspiciousCharacters * 8;
      return { candidate, meaningfulCharacters, score };
    });
    const hasMeaningfulText = evaluated.some((entry) => entry.meaningfulCharacters > 0);
    let winner = null;
    let winningScore = -Infinity;
    for (const entry of evaluated) {
      if (hasMeaningfulText && entry.meaningfulCharacters === 0) continue;
      if (entry.score > winningScore) {
        winner = entry.candidate;
        winningScore = entry.score;
      }
    }
    return Object.freeze({
      ...winner,
      comparisonScore: Math.round(winningScore * 1000) / 1000,
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return `${Math.round(bytes)} B`;

    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder === 0 ? `${minutes}分` : `${minutes}分${remainder}秒`;
  }

  function sanitizeBaseName(fileName) {
    const withoutExtension = String(fileName ?? "")
      .trim()
      .replace(/\.pdf$/i, "")
      .normalize("NFC");
    const safe = withoutExtension
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80);
    return safe || "document";
  }

  function normalizeDictionary(value, sourceBytes = 0) {
    if (sourceBytes > MAX_DICTIONARY_BYTES) {
      throw new OcrInputError(
        `辞書は${formatBytes(MAX_DICTIONARY_BYTES)}以下にしてください。`,
        "DICTIONARY_TOO_LARGE",
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new OcrInputError("辞書JSONの最上位はオブジェクトにしてください。", "DICTIONARY_SHAPE");
    }
    if (value.version !== 1) {
      throw new OcrInputError("辞書のversionは1を指定してください。", "DICTIONARY_VERSION");
    }
    if (!Array.isArray(value.entries)) {
      throw new OcrInputError("辞書にentries配列が必要です。", "DICTIONARY_ENTRIES");
    }
    if (value.entries.length > MAX_DICTIONARY_ENTRIES) {
      throw new OcrInputError(
        `辞書は${MAX_DICTIONARY_ENTRIES.toLocaleString("ja-JP")}件以下にしてください。`,
        "DICTIONARY_TOO_MANY_ENTRIES",
      );
    }

    const seen = new Set();
    let totalFromCharacters = 0;
    const entries = value.entries.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new OcrInputError(
          `辞書の${index + 1}件目はオブジェクトにしてください。`,
          "DICTIONARY_ENTRY_SHAPE",
        );
      }
      if (typeof entry.from !== "string" || entry.from.length === 0) {
        throw new OcrInputError(
          `辞書の${index + 1}件目に空でないfromが必要です。`,
          "DICTIONARY_FROM",
        );
      }
      if (typeof entry.to !== "string") {
        throw new OcrInputError(
          `辞書の${index + 1}件目に文字列のtoが必要です。`,
          "DICTIONARY_TO",
        );
      }
      if (entry.from.length > 500 || entry.to.length > 2000) {
        throw new OcrInputError(
          `辞書の${index + 1}件目が長すぎます。`,
          "DICTIONARY_ENTRY_TOO_LONG",
        );
      }
      totalFromCharacters += entry.from.length;
      if (totalFromCharacters > MAX_DICTIONARY_TOTAL_FROM_CHARS) {
        throw new OcrInputError(
          "辞書のfromの合計が大きすぎます。短い語に分けるか、不要な項目を減らしてください。",
          "DICTIONARY_TOO_COMPLEX",
        );
      }
      if (seen.has(entry.from)) {
        throw new OcrInputError(
          `辞書のfrom「${entry.from.slice(0, 30)}」が重複しています。`,
          "DICTIONARY_DUPLICATE",
        );
      }
      seen.add(entry.from);
      return Object.freeze({ from: entry.from, to: entry.to });
    });

    const name = typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 100)
      : "補正辞書";

    return Object.freeze({
      version: 1,
      name,
      entries: Object.freeze(entries),
    });
  }

  function compileDictionary(dictionary) {
    const normalized = normalizeDictionary(dictionary);
    const root = new Map();

    for (const entry of normalized.entries) {
      let node = root;
      for (let index = 0; index < entry.from.length; index += 1) {
        const character = entry.from[index];
        if (!node.has(character)) node.set(character, new Map());
        node = node.get(character);
      }
      node.replacement = entry.to;
    }

    return function applyCompiledDictionary(input) {
      const source = String(input ?? "");
      const output = [];
      let outputCharacters = 0;
      const outputLimit = Math.min(
        MAX_CORRECTED_TEXT_CHARS,
        Math.max(source.length + 100_000, source.length * 20),
      );
      let replacements = 0;
      let index = 0;

      const append = (value) => {
        outputCharacters += value.length;
        if (outputCharacters > outputLimit) {
          throw new OcrInputError(
            "辞書補正後の文字数が大きすぎるため、補正を中止しました。",
            "DICTIONARY_OUTPUT_TOO_LARGE",
          );
        }
        output.push(value);
      };

      while (index < source.length) {
        let node = root;
        let cursor = index;
        let matchEnd = -1;
        let replacement = "";

        while (cursor < source.length && node.has(source[cursor])) {
          node = node.get(source[cursor]);
          cursor += 1;
          if (Object.hasOwn(node, "replacement")) {
            matchEnd = cursor;
            replacement = node.replacement;
          }
        }

        if (matchEnd >= 0) {
          append(replacement);
          index = matchEnd;
          replacements += 1;
        } else {
          append(source[index]);
          index += 1;
        }
      }

      return { text: output.join(""), replacements };
    };
  }

  function buildTextOutput(results, options = {}) {
    if (!Array.isArray(results)) throw new TypeError("results must be an array.");
    const includePageHeaders = options.includePageHeaders !== false;
    const hasSequences = results.every(
      (result) => Number.isInteger(Number(result.sequence)) && Number(result.sequence) > 0,
    );
    const ordered = [...results].sort((left, right) => (
      hasSequences
        ? Number(left.sequence) - Number(right.sequence)
        : Number(left.pageNumber) - Number(right.pageNumber)
    ));

    return ordered.map((result) => {
      const pageNumber = Number(result.pageNumber);
      assertPositiveInteger(pageNumber, "result.pageNumber");
      if (!RESULT_STATUSES.has(result.status)) {
        throw new TypeError(`Unknown result status: ${result.status}`);
      }

      let body;
      let suffix = "";
      if (result.status === "failed") {
        suffix = "（認識失敗）";
        body = `[認識できませんでした: ${result.errorCode || "OCR_ERROR"}]`;
      } else if (result.status === "cancelled") {
        suffix = "（未処理）";
        body = "[処理を中止しました]";
      } else if (!String(result.text ?? "").trim()) {
        suffix = "（文字なし）";
        body = "[文字を検出できませんでした]";
      } else {
        body = String(result.text).trim();
      }

      if (!includePageHeaders) return body;
      const readingLabel = hasSequences ? `読み取り${Number(result.sequence)}・` : "";
      return `===== ${readingLabel}${pageNumber}ページ${suffix} =====\n${body}`;
    }).join("\n\n");
  }

  function normalizeResultHistory(value, currentSource, sourceBytes) {
    const fail = (message, code) => {
      throw new OcrInputError(message, code);
    };
    const isRecord = (entry) => (
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
    );
    const requireRecord = (entry, label, code = "HISTORY_FIELD") => {
      if (!isRecord(entry)) fail(`${label}はオブジェクトにしてください。`, code);
      return entry;
    };
    const requireString = (
      entry,
      label,
      { allowEmpty = true, maximum = MAX_HISTORY_METADATA_CHARS } = {},
    ) => {
      if (
        typeof entry !== "string"
        || (!allowEmpty && entry.length === 0)
        || entry.length > maximum
      ) {
        fail(`${label}は${allowEmpty ? "" : "空でない"}文字列にしてください。`, "HISTORY_STRING");
      }
      return entry;
    };
    const optionalString = (entry, label, options) => (
      entry === null || entry === undefined ? null : requireString(entry, label, options)
    );
    const requireBoolean = (entry, label) => {
      if (typeof entry !== "boolean") {
        fail(`${label}は真偽値にしてください。`, "HISTORY_BOOLEAN");
      }
      return entry;
    };
    const requireFinite = (
      entry,
      label,
      { minimum = -Infinity, maximum = Infinity, integer = false } = {},
    ) => {
      if (
        typeof entry !== "number"
        || !Number.isFinite(entry)
        || entry < minimum
        || entry > maximum
        || (integer && !Number.isSafeInteger(entry))
      ) {
        fail(`${label}の数値が正しくありません。`, "HISTORY_NUMBER");
      }
      return entry;
    };
    const optionalFinite = (entry, label, options) => (
      entry === null || entry === undefined ? null : requireFinite(entry, label, options)
    );

    requireFinite(sourceBytes, "履歴ファイルのサイズ", { minimum: 0, integer: true });
    if (sourceBytes > MAX_HISTORY_BYTES) {
      fail(
        `履歴JSONは${formatBytes(MAX_HISTORY_BYTES)}以下にしてください。`,
        "HISTORY_TOO_LARGE",
      );
    }
    const rootValue = requireRecord(value, "履歴JSONの最上位", "HISTORY_SHAPE");
    if (rootValue.format !== "scanscribe-region-ocr-result") {
      fail("ScanScribeの読み取り履歴JSONを選んでください。", "HISTORY_FORMAT");
    }
    if (rootValue.version !== 3) {
      fail("読み取り履歴のversionは3にしてください。", "HISTORY_VERSION");
    }
    if (rootValue.coordinateSystem !== "normalized-top-left") {
      fail("読み取り履歴の座標形式に対応していません。", "HISTORY_COORDINATE_SYSTEM");
    }
    if (rootValue.offline !== true) {
      fail("オフライン版の読み取り履歴ではありません。", "HISTORY_OFFLINE");
    }

    const current = requireRecord(
      currentSource,
      "現在のPDF情報",
      "HISTORY_CURRENT_SOURCE",
    );
    const currentName = requireString(current.name, "現在のPDF名", {
      allowEmpty: false,
      maximum: MAX_HISTORY_METADATA_CHARS,
    });
    const currentBytes = requireFinite(current.bytes, "現在のPDFサイズ", {
      minimum: 0,
      integer: true,
    });
    const currentTotalPages = requireFinite(current.totalPages, "現在のPDFページ数", {
      minimum: 1,
      integer: true,
    });

    const source = requireRecord(rootValue.source, "履歴のPDF情報", "HISTORY_SOURCE");
    const sourceName = requireString(source.name, "履歴のPDF名", {
      allowEmpty: false,
      maximum: MAX_HISTORY_METADATA_CHARS,
    });
    const historyPdfBytes = requireFinite(source.bytes, "履歴のPDFサイズ", {
      minimum: 0,
      integer: true,
    });
    const historyTotalPages = requireFinite(source.totalPages, "履歴のPDFページ数", {
      minimum: 1,
      integer: true,
    });
    if (historyPdfBytes !== currentBytes) {
      fail("履歴JSONと現在のPDFのファイルサイズが一致しません。", "HISTORY_SOURCE_BYTES_MISMATCH");
    }
    if (historyTotalPages !== currentTotalPages) {
      fail("履歴JSONと現在のPDFのページ数が一致しません。", "HISTORY_SOURCE_PAGES_MISMATCH");
    }
    const sourceNameChanged = sourceName.normalize("NFC") !== currentName.normalize("NFC");

    const applicationVariantSource = requireRecord(
      rootValue.applicationVariant,
      "履歴のアプリ版情報",
      "HISTORY_APPLICATION_VARIANT",
    );
    const applicationVariant = Object.freeze({
      id: requireString(applicationVariantSource.id, "アプリ版ID", { allowEmpty: false }),
      label: requireString(applicationVariantSource.label, "アプリ版名", { allowEmpty: false }),
      modelVariant: requireString(
        applicationVariantSource.modelVariant,
        "OCRモデル版",
        { allowEmpty: false },
      ),
    });
    const createdAt = requireString(rootValue.createdAt, "履歴の作成日時", {
      allowEmpty: false,
      maximum: 100,
    });
    const combinedText = requireString(rootValue.combinedText, "履歴の全文", {
      maximum: MAX_HISTORY_COMBINED_TEXT_CHARS,
    });
    const declaredCombinedTextEdited = requireBoolean(
      rootValue.combinedTextEdited,
      "履歴の編集状態",
    );

    let dictionary = null;
    if (rootValue.dictionary !== null && rootValue.dictionary !== undefined) {
      const dictionarySource = requireRecord(
        rootValue.dictionary,
        "履歴の辞書情報",
        "HISTORY_DICTIONARY",
      );
      dictionary = Object.freeze({
        name: requireString(dictionarySource.name, "履歴の辞書名", { allowEmpty: false }),
        entries: requireFinite(dictionarySource.entries, "履歴の辞書件数", {
          minimum: 0,
          integer: true,
        }),
        sourceFile: optionalString(dictionarySource.sourceFile, "履歴の辞書ファイル名", {
          allowEmpty: false,
        }),
      });
    }

    if (!Array.isArray(rootValue.results)) {
      fail("読み取り履歴にresults配列が必要です。", "HISTORY_RESULTS");
    }
    if (rootValue.results.length === 0) {
      fail("読み取り履歴に1件以上の結果が必要です。", "HISTORY_RESULTS_EMPTY");
    }
    if (rootValue.results.length > MAX_HISTORY_RESULTS) {
      fail(
        `読み取り履歴は${MAX_HISTORY_RESULTS.toLocaleString("ja-JP")}件以下にしてください。`,
        "HISTORY_TOO_MANY_RESULTS",
      );
    }

    const normalizeMargins = (entry, label) => {
      if (entry === null || entry === undefined) return null;
      const margins = requireRecord(entry, label);
      return Object.freeze({
        top: requireFinite(margins.top, `${label}の上`, { minimum: 0 }),
        right: requireFinite(margins.right, `${label}の右`, { minimum: 0 }),
        bottom: requireFinite(margins.bottom, `${label}の下`, { minimum: 0 }),
        left: requireFinite(margins.left, `${label}の左`, { minimum: 0 }),
      });
    };
    const normalizeCandidate = (entry, resultIndex, candidateIndex) => {
      const label = `${resultIndex + 1}件目の候補${candidateIndex + 1}`;
      const candidate = requireRecord(entry, label, "HISTORY_CANDIDATE");
      return Object.freeze({
        variant: requireString(candidate.variant, `${label}のvariant`, { allowEmpty: false }),
        label: requireString(candidate.label, `${label}のlabel`, { allowEmpty: false }),
        text: requireString(candidate.text, `${label}のtext`, {
          maximum: MAX_CORRECTED_TEXT_CHARS,
        }),
        confidence: requireFinite(candidate.confidence, `${label}のconfidence`, {
          minimum: 0,
          maximum: 100,
        }),
        preprocessor: requireString(candidate.preprocessor, `${label}のpreprocessor`, {
          allowEmpty: false,
        }),
        pageSegmentationMode: optionalString(
          candidate.pageSegmentationMode,
          `${label}のpageSegmentationMode`,
        ),
        thresholdingMethod: optionalString(
          candidate.thresholdingMethod,
          `${label}のthresholdingMethod`,
        ),
      });
    };
    const normalizeSettings = (entry, resultIndex) => {
      const label = `${resultIndex + 1}件目の設定`;
      const settings = requireRecord(entry, label, "HISTORY_SETTINGS");
      if (!Array.isArray(settings.languages) || settings.languages.length === 0) {
        fail(`${label}のlanguagesが正しくありません。`, "HISTORY_SETTINGS");
      }
      const languages = settings.languages.map((language) => requireString(
        language,
        `${label}の言語`,
        { allowEmpty: false, maximum: 20 },
      ));
      return Object.freeze({
        variantId: requireString(settings.variantId, `${label}のvariantId`, { allowEmpty: false }),
        variantLabel: requireString(settings.variantLabel, `${label}のvariantLabel`, {
          allowEmpty: false,
        }),
        modelVariant: requireString(settings.modelVariant, `${label}のmodelVariant`, {
          allowEmpty: false,
        }),
        languages: Object.freeze(languages),
        languageLabel: requireString(settings.languageLabel, `${label}のlanguageLabel`, {
          allowEmpty: false,
        }),
        qualityLabel: requireString(settings.qualityLabel, `${label}のqualityLabel`, {
          allowEmpty: false,
        }),
        requestedScale: requireFinite(settings.requestedScale, `${label}のrequestedScale`, {
          minimum: Number.MIN_VALUE,
        }),
        layout: requireString(settings.layout, `${label}のlayout`, { allowEmpty: false }),
        pageSegmentationMode: requireString(
          settings.pageSegmentationMode,
          `${label}のpageSegmentationMode`,
          { allowEmpty: false },
        ),
        compareVariants: requireBoolean(settings.compareVariants, `${label}のcompareVariants`),
        autoRotate: requireBoolean(settings.autoRotate, `${label}のautoRotate`),
      });
    };

    const seenSequences = new Set();
    const results = rootValue.results.map((entry, index) => {
      const label = `${index + 1}件目の読み取り結果`;
      const result = requireRecord(entry, label, "HISTORY_RESULT_SHAPE");
      const sequence = requireFinite(result.sequence, `${label}のsequence`, {
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER - 1,
        integer: true,
      });
      if (seenSequences.has(sequence)) {
        fail(`読み取り番号${sequence}が重複しています。`, "HISTORY_DUPLICATE_SEQUENCE");
      }
      seenSequences.add(sequence);
      const pageNumber = requireFinite(result.page, `${label}のpage`, {
        minimum: 1,
        maximum: currentTotalPages,
        integer: true,
      });
      const regionSource = requireRecord(result.region, `${label}のregion`, "HISTORY_REGION");
      const region = {
        x: requireFinite(regionSource.x, `${label}のregion.x`, { minimum: 0, maximum: 1 }),
        y: requireFinite(regionSource.y, `${label}のregion.y`, { minimum: 0, maximum: 1 }),
        width: requireFinite(regionSource.width, `${label}のregion.width`, {
          minimum: Number.MIN_VALUE,
          maximum: 1,
        }),
        height: requireFinite(regionSource.height, `${label}のregion.height`, {
          minimum: Number.MIN_VALUE,
          maximum: 1,
        }),
      };
      if (region.x + region.width > 1 || region.y + region.height > 1) {
        fail(`${label}の選択範囲がページ外です。`, "HISTORY_REGION");
      }
      Object.freeze(region);
      if (!HISTORY_RESULT_STATUSES.has(result.status)) {
        fail(`${label}のstatusに対応していません。`, "HISTORY_STATUS");
      }
      if (!Array.isArray(result.candidates)) {
        fail(`${label}のcandidatesは配列にしてください。`, "HISTORY_CANDIDATES");
      }
      if (result.candidates.length > MAX_HISTORY_CANDIDATES) {
        fail(
          `${label}の候補は${MAX_HISTORY_CANDIDATES}件以下にしてください。`,
          "HISTORY_TOO_MANY_CANDIDATES",
        );
      }
      const candidateCount = requireFinite(result.comparedCandidates, `${label}のcomparedCandidates`, {
        minimum: 0,
        maximum: MAX_HISTORY_CANDIDATES,
        integer: true,
      });
      if (candidateCount !== result.candidates.length) {
        fail(`${label}の候補件数が一致しません。`, "HISTORY_CANDIDATE_COUNT");
      }
      const candidates = Object.freeze(
        result.candidates.map((candidate, candidateIndex) => (
          normalizeCandidate(candidate, index, candidateIndex)
        )),
      );
      const plannedPassCount = result.plannedPassCount === null
        || result.plannedPassCount === undefined
        ? candidateCount
        : requireFinite(result.plannedPassCount, `${label}のplannedPassCount`, {
          minimum: 0,
          integer: true,
        });
      const attemptedPassCount = result.attemptedPassCount === null
        || result.attemptedPassCount === undefined
        ? candidateCount
        : requireFinite(result.attemptedPassCount, `${label}のattemptedPassCount`, {
          minimum: 0,
          integer: true,
        });
      const successfulCandidateCount = result.successfulCandidateCount === null
        || result.successfulCandidateCount === undefined
        ? candidateCount
        : requireFinite(
          result.successfulCandidateCount,
          `${label}のsuccessfulCandidateCount`,
          { minimum: 0, maximum: MAX_HISTORY_CANDIDATES, integer: true },
        );
      const failedPassCount = result.failedPassCount === null
        || result.failedPassCount === undefined
        ? Math.max(0, plannedPassCount - successfulCandidateCount)
        : requireFinite(result.failedPassCount, `${label}のfailedPassCount`, {
          minimum: 0,
          integer: true,
        });
      if (
        successfulCandidateCount !== candidateCount
        || attemptedPassCount < successfulCandidateCount
        || plannedPassCount < attemptedPassCount
        || plannedPassCount < successfulCandidateCount + failedPassCount
      ) {
        fail(`${label}の認識条件件数が一致しません。`, "HISTORY_PASS_COUNTS");
      }

      let cropPixels = null;
      if (result.cropPixels !== null && result.cropPixels !== undefined) {
        const crop = requireRecord(result.cropPixels, `${label}のcropPixels`);
        cropPixels = Object.freeze({
          x: requireFinite(crop.x, `${label}のcropPixels.x`, { minimum: 0, integer: true }),
          y: requireFinite(crop.y, `${label}のcropPixels.y`, { minimum: 0, integer: true }),
          width: requireFinite(crop.width, `${label}のcropPixels.width`, {
            minimum: 1,
            integer: true,
          }),
          height: requireFinite(crop.height, `${label}のcropPixels.height`, {
            minimum: 1,
            integer: true,
          }),
          padding: requireFinite(crop.padding, `${label}のcropPixels.padding`, {
            minimum: 0,
            integer: true,
          }),
          sourceMargin: normalizeMargins(crop.sourceMargin, `${label}のsourceMargin`),
        });
      }

      let deskew = null;
      if (result.deskew !== null && result.deskew !== undefined) {
        const deskewSource = requireRecord(result.deskew, `${label}のdeskew`);
        deskew = Object.freeze({
          angle: requireFinite(deskewSource.angle, `${label}のdeskew.angle`),
          correctionAngle: requireFinite(
            deskewSource.correctionAngle,
            `${label}のdeskew.correctionAngle`,
          ),
          confidence: requireFinite(deskewSource.confidence, `${label}のdeskew.confidence`),
          applied: requireBoolean(deskewSource.applied, `${label}のdeskew.applied`),
          outputScale: requireFinite(deskewSource.outputScale, `${label}のdeskew.outputScale`, {
            minimum: Number.MIN_VALUE,
          }),
        });
      }

      return Object.freeze({
        sequence,
        pageNumber,
        region,
        status: result.status,
        text: requireString(result.text, `${label}のtext`, {
          maximum: MAX_CORRECTED_TEXT_CHARS,
        }),
        rawText: requireString(result.rawText, `${label}のrawText`, {
          maximum: MAX_CORRECTED_TEXT_CHARS,
        }),
        confidence: optionalFinite(result.confidence, `${label}のconfidence`, {
          minimum: 0,
          maximum: 100,
        }),
        variant: optionalString(result.selectedVariant, `${label}のselectedVariant`),
        selectedPassLabel: optionalString(
          result.selectedPassLabel,
          `${label}のselectedPassLabel`,
        ),
        comparisonScore: null,
        agreement: optionalFinite(result.agreement, `${label}のagreement`, {
          minimum: 0,
          maximum: 1,
        }),
        consensusApplied: requireBoolean(result.consensusApplied, `${label}のconsensusApplied`),
        disagreementCount: optionalFinite(
          result.disagreementCount,
          `${label}のdisagreementCount`,
          { minimum: 0, integer: true },
        ),
        candidateCount,
        plannedPassCount,
        attemptedPassCount,
        successfulCandidateCount,
        failedPassCount,
        candidates,
        actualDpi: optionalFinite(result.actualDpi, `${label}のactualDpi`, {
          minimum: Number.MIN_VALUE,
        }),
        renderScale: optionalFinite(result.renderScale, `${label}のrenderScale`, {
          minimum: Number.MIN_VALUE,
        }),
        renderMode: optionalString(result.renderMode, `${label}のrenderMode`),
        cropPixels,
        deskew,
        replacements: requireFinite(result.replacements, `${label}のreplacements`, {
          minimum: 0,
          integer: true,
        }),
        correctionErrorCode: optionalString(
          result.correctionErrorCode,
          `${label}のcorrectionErrorCode`,
        ),
        errorCode: optionalString(result.errorCode, `${label}のerrorCode`),
        durationMs: requireFinite(result.durationMs, `${label}のdurationMs`, {
          minimum: 0,
          integer: true,
        }),
        settings: normalizeSettings(result.settings, index),
      });
    }).sort((left, right) => left.sequence - right.sequence);

    const totalElapsedMs = results.reduce((sum, result) => sum + result.durationMs, 0);
    if (!Number.isSafeInteger(totalElapsedMs)) {
      fail("読み取り履歴の合計処理時間が大きすぎます。", "HISTORY_DURATION");
    }
    const nextSequence = results.length === 0
      ? 1
      : results[results.length - 1].sequence + 1;
    const rebuiltCombinedText = buildTextOutput(results.filter((result) => (
      result.status === "success" && String(result.text).trim()
    )));
    const combinedTextEdited = declaredCombinedTextEdited
      || combinedText !== rebuiltCombinedText;

    return Object.freeze({
      format: "scanscribe-region-ocr-result",
      version: 3,
      coordinateSystem: "normalized-top-left",
      applicationVariant,
      createdAt,
      offline: true,
      source: Object.freeze({
        name: sourceName,
        bytes: historyPdfBytes,
        totalPages: historyTotalPages,
      }),
      sourceNameChanged,
      dictionary,
      combinedText,
      combinedTextEdited,
      results: Object.freeze(results),
      totalElapsedMs,
      nextSequence,
    });
  }

  function mapOcrStatus(status) {
    const stableLabels = {
      "loading tesseract core": "OCRエンジンを準備しています",
      "initializing tesseract": "OCRエンジンを初期化しています",
      "loading language traineddata": "同梱の言語モデルを読み込んでいます",
      "initializing api": "文字認識を準備しています",
      "recognizing text": "文字を認識しています",
    };
    return stableLabels[String(status ?? "").toLowerCase()] || "文字認識を処理しています";
  }

  function base64ToBytes(base64) {
    if (typeof base64 !== "string") throw new TypeError("base64 must be a string.");
    if (typeof atob === "function") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  function createImagePdfBytes(jpegBytes, pixelWidth, pixelHeight) {
    const image = jpegBytes instanceof Uint8Array
      ? jpegBytes
      : new Uint8Array(jpegBytes || []);
    assertPositiveInteger(pixelWidth, "pixelWidth");
    assertPositiveInteger(pixelHeight, "pixelHeight");
    if (image.length === 0) {
      throw new TypeError("jpegBytes must not be empty.");
    }

    const encoder = new TextEncoder();
    const ascii = (value) => encoder.encode(String(value));
    const concatenate = (parts) => {
      const length = parts.reduce((sum, part) => sum + part.length, 0);
      const output = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
      }
      return output;
    };
    const content = ascii("q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ");
    const objects = [
      ascii("<< /Type /Catalog /Pages 2 0 R >>"),
      ascii("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      ascii(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        + "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
      ),
      concatenate([
        ascii(`<< /Length ${content.length} >>\nstream\n`),
        content,
        ascii("\nendstream"),
      ]),
      concatenate([
        ascii(
          `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} `
          + `/Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 `
          + `/Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
        ),
        image,
        ascii("\nendstream"),
      ]),
    ];

    const chunks = [ascii("%PDF-1.4\n%SCAN\n")];
    const offsets = [0];
    let byteLength = chunks[0].length;
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(byteLength);
      const object = concatenate([
        ascii(`${index + 1} 0 obj\n`),
        objects[index],
        ascii("\nendobj\n"),
      ]);
      chunks.push(object);
      byteLength += object.length;
    }
    const xrefOffset = byteLength;
    const xref = [
      `xref\n0 ${objects.length + 1}\n`,
      "0000000000 65535 f \n",
      ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
      `startxref\n${xrefOffset}\n%%EOF\n`,
    ].join("");
    chunks.push(ascii(xref));
    return concatenate(chunks);
  }

  return Object.freeze({
    MAX_DICTIONARY_BYTES,
    MAX_DICTIONARY_ENTRIES,
    MAX_DICTIONARY_TOTAL_FROM_CHARS,
    MAX_CORRECTED_TEXT_CHARS,
    MAX_HISTORY_BYTES,
    OcrInputError,
    base64ToBytes,
    buildTextOutput,
    calculateRenderScale,
    collapsePageList,
    compileDictionary,
    createImagePdfBytes,
    formatBytes,
    formatDuration,
    mapOcrStatus,
    normalizeRegion,
    normalizeDictionary,
    normalizeResultHistory,
    parsePageRange,
    regionToPixels,
    sanitizeBaseName,
    selectOcrCandidate,
  });
});
