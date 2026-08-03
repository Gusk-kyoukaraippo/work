"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const core = require("../ocr-core.js");

function createHistoryResult(overrides = {}) {
  const candidate = {
    variant: "original-psm6",
    label: "原画像（PSM 6）",
    text: "本文",
    confidence: 88.5,
    preprocessor: "original",
    pageSegmentationMode: "6",
    thresholdingMethod: "0",
  };
  return {
    sequence: 1,
    page: 1,
    region: { x: 0.1, y: 0.2, width: 0.5, height: 0.3 },
    status: "success",
    text: "本文",
    rawText: "本文",
    confidence: 89,
    selectedVariant: "original-psm6",
    selectedPassLabel: "原画像（PSM 6）",
    comparedCandidates: 1,
    agreement: 0.8,
    consensusApplied: false,
    disagreementCount: 0,
    candidates: [candidate],
    actualDpi: 300,
    renderScale: 4.167,
    renderMode: "direct-region",
    cropPixels: {
      x: 10,
      y: 20,
      width: 500,
      height: 300,
      padding: 16,
      sourceMargin: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
    },
    deskew: {
      angle: 0.3,
      correctionAngle: -0.3,
      confidence: 0.4,
      applied: true,
      outputScale: 1,
    },
    replacements: 0,
    correctionErrorCode: null,
    errorCode: null,
    durationMs: 1200,
    settings: {
      variantId: "precision",
      variantLabel: "高精度版",
      modelVariant: "tessdata_best_float",
      languages: ["jpn", "eng"],
      languageLabel: "日本語 ＋ 英語",
      qualityLabel: "標準（約300dpi）",
      requestedScale: 4.167,
      layout: "ひとつの文章ブロック",
      pageSegmentationMode: "6",
      compareVariants: true,
      autoRotate: false,
    },
    ...overrides,
  };
}

function buildHistoryCombinedText(results) {
  return core.buildTextOutput(results
    .filter((result) => result.status === "success" && String(result.text ?? "").trim())
    .map((result) => ({
      sequence: result.sequence,
      pageNumber: result.page,
      status: result.status,
      text: result.text,
      errorCode: result.errorCode,
    })));
}

function createHistoryPayload(options = {}) {
  const results = options.results || [createHistoryResult()];
  return {
    format: "scanscribe-region-ocr-result",
    version: 3,
    applicationVariant: {
      id: "precision",
      label: "高精度版",
      modelVariant: "tessdata_best_float",
    },
    createdAt: "2026-07-18T00:00:00.000Z",
    offline: true,
    coordinateSystem: "normalized-top-left",
    combinedText: buildHistoryCombinedText(results),
    combinedTextEdited: false,
    source: {
      name: "原稿.pdf",
      bytes: 123456,
      totalPages: 2,
    },
    dictionary: {
      name: "業務辞書",
      entries: 12,
      sourceFile: "dictionary.json",
    },
    results,
    ...options.overrides,
  };
}

const currentHistorySource = Object.freeze({
  name: "原稿.pdf",
  bytes: 123456,
  totalPages: 2,
});

test("parsePageRange accepts all-page keywords and normalizes ranges", () => {
  assert.deepEqual(core.parsePageRange("すべて", 5), {
    pages: [1, 2, 3, 4, 5],
    normalized: "1-5",
  });
  assert.deepEqual(core.parsePageRange("ＡＬＬ", 3).pages, [1, 2, 3]);
  assert.deepEqual(core.parsePageRange("１〜３、 3, 5", 6), {
    pages: [1, 2, 3, 5],
    normalized: "1-3, 5",
  });
});

test("parsePageRange rejects malformed, reversed, and out-of-bounds input", () => {
  assert.throws(
    () => core.parsePageRange("   ", 5),
    (error) => error.code === "PAGE_RANGE_EMPTY",
  );
  assert.throws(
    () => core.parsePageRange("1,,3", 5),
    (error) => error.code === "PAGE_RANGE_EMPTY_ITEM",
  );
  assert.throws(
    () => core.parsePageRange("4-2", 5),
    (error) => error.code === "PAGE_RANGE_REVERSED",
  );
  assert.throws(
    () => core.parsePageRange("0,2", 5),
    (error) => error.code === "PAGE_RANGE_OUT_OF_BOUNDS",
  );
  assert.throws(
    () => core.parsePageRange("1-a", 5),
    (error) => error.code === "PAGE_RANGE_SYNTAX",
  );
});

test("calculateRenderScale respects requested scale, pixel cap, and dimension cap", () => {
  assert.equal(core.calculateRenderScale(600, 800, 2), 2);
  const pixelLimited = core.calculateRenderScale(4000, 4000, 3, 8_000_000, 20_000);
  assert.ok(pixelLimited < 1);
  assert.ok(4000 * pixelLimited * 4000 * pixelLimited <= 8_010_000);
  const dimensionLimited = core.calculateRenderScale(10_000, 100, 2, 100_000_000, 8192);
  assert.equal(dimensionLimited, 0.819);
  const extreme = core.calculateRenderScale(10_000_000, 10_000_000, 5, 1_000_000, 4096);
  assert.ok(extreme < 0.001, "extreme pages do not bypass the configured caps");
});

test("normalizeRegion accepts every drag direction and clamps to the page", () => {
  const expected = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
  assert.deepEqual(core.normalizeRegion(0.2, 0.1, 0.8, 0.9), expected);
  assert.deepEqual(core.normalizeRegion(0.8, 0.9, 0.2, 0.1), expected);
  assert.deepEqual(core.normalizeRegion(-1, -2, 2, 3), {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  assert.equal(core.normalizeRegion(0.2, 0.2, 0.2, 0.8), null);
});

test("regionToPixels rounds outward and never leaves the source canvas", () => {
  assert.deepEqual(
    core.regionToPixels({ x: 0.1, y: 0.2, width: 0.25, height: 0.3 }, 100, 80),
    { x: 10, y: 16, width: 25, height: 24 },
  );
  assert.deepEqual(
    core.regionToPixels({ x: -0.2, y: 0.99, width: 1.5, height: 0.5 }, 100, 80),
    { x: 0, y: 79, width: 100, height: 1 },
  );
});

test("selectOcrCandidate avoids empty output and keeps original on a tie", () => {
  const winner = core.selectOcrCandidate([
    { text: "", confidence: 99, variant: "original" },
    { text: "文書番号 12345", confidence: 88, variant: "enhanced" },
  ]);
  assert.equal(winner.variant, "enhanced");

  const tie = core.selectOcrCandidate([
    { text: "SAME", confidence: 90, variant: "original" },
    { text: "SAME", confidence: 90, variant: "enhanced" },
  ]);
  assert.equal(tie.variant, "original");

  const confidenceFirst = core.selectOcrCandidate([
    { text: "正解", confidence: 82, variant: "original" },
    { text: "長いが誤った文字列を大量に並べた候補です", confidence: 80, variant: "enhanced" },
  ]);
  assert.equal(confidenceFirst.variant, "original");
});

test("dictionary validation rejects unsafe shapes and duplicate keys", () => {
  assert.throws(
    () => core.normalizeDictionary({ version: 2, entries: [] }),
    (error) => error.code === "DICTIONARY_VERSION",
  );
  assert.throws(
    () => core.normalizeDictionary({
      version: 1,
      entries: Array.from({ length: 201 }, (_, index) => ({
        from: `${String(index).padStart(3, "0")}${"x".repeat(497)}`,
        to: "x",
      })),
    }),
    (error) => error.code === "DICTIONARY_TOO_COMPLEX",
  );
  assert.throws(
    () => core.normalizeDictionary({
      version: 1,
      entries: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ],
    }),
    (error) => error.code === "DICTIONARY_DUPLICATE",
  );
});

test("compiled dictionary applies the longest literal match without cascading", () => {
  const apply = core.compileDictionary({
    version: 1,
    name: "test",
    entries: [
      { from: "東", to: "X" },
      { from: "東京", to: "TOKYO" },
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ],
  });

  assert.deepEqual(apply("東京 東 A"), {
    text: "TOKYO X B",
    replacements: 3,
  });
});

test("compiled dictionary caps pathological replacement expansion", () => {
  const apply = core.compileDictionary({
    version: 1,
    entries: [{ from: "a", to: "x".repeat(2000) }],
  });
  assert.throws(
    () => apply("a".repeat(60)),
    (error) => error.code === "DICTIONARY_OUTPUT_TOO_LARGE",
  );
});

test("buildTextOutput preserves OCR action order and multiple regions on one page", () => {
  const output = core.buildTextOutput([
    { sequence: 3, pageNumber: 1, status: "warning", text: "" },
    { sequence: 1, pageNumber: 2, status: "success", text: "  二ページを先に  " },
    { sequence: 4, pageNumber: 1, status: "failed", text: "", errorCode: "OCR_WORKER_ERROR" },
    { sequence: 2, pageNumber: 2, status: "success", text: "同じページの二つ目" },
  ]);

  assert.match(output, /^===== 読み取り1・2ページ =====\n二ページを先に/);
  assert.ok(output.indexOf("読み取り1") < output.indexOf("読み取り2"));
  assert.ok(output.indexOf("読み取り2") < output.indexOf("読み取り3"));
  assert.match(output, /===== 読み取り3・1ページ（文字なし） =====/);
  assert.match(output, /\[認識できませんでした: OCR_WORKER_ERROR\]/);
});

test("normalizeResultHistory maps v3 export fields, sorts results, and picks known data", () => {
  const second = createHistoryResult({
    sequence: 2,
    page: 2,
    text: "二番目",
    rawText: "二番目",
    durationMs: 800,
    plannedPassCount: 8,
    attemptedPassCount: 5,
    successfulCandidateCount: 1,
    failedPassCount: 4,
  });
  const first = createHistoryResult({
    sequence: 1,
    page: 1,
    text: "一番目",
    rawText: "一番目",
    durationMs: 400,
    unknownResultField: "discard me",
    settings: {
      ...createHistoryResult().settings,
      unknownSettingField: "discard me",
    },
  });
  first.candidates[0] = { ...first.candidates[0], unknownCandidateField: "discard me" };
  const payload = createHistoryPayload({
    results: [second, first],
    overrides: { unknownTopLevelField: "discard me" },
  });
  const normalized = core.normalizeResultHistory(payload, currentHistorySource, 4096);

  assert.equal(core.MAX_HISTORY_BYTES, 20 * 1024 * 1024);
  assert.deepEqual(normalized.results.map((result) => result.sequence), [1, 2]);
  assert.equal(normalized.results[0].pageNumber, 1);
  assert.equal(normalized.results[0].variant, "original-psm6");
  assert.equal(normalized.results[0].candidateCount, 1);
  assert.equal(normalized.results[0].plannedPassCount, 1);
  assert.equal(normalized.results[0].attemptedPassCount, 1);
  assert.equal(normalized.results[0].successfulCandidateCount, 1);
  assert.equal(normalized.results[0].failedPassCount, 0);
  assert.equal(normalized.results[1].plannedPassCount, 8);
  assert.equal(normalized.results[1].attemptedPassCount, 5);
  assert.equal(normalized.results[1].failedPassCount, 4);
  assert.equal(normalized.results[0].comparisonScore, null);
  assert.equal(normalized.results[0].settings.languages[1], "eng");
  assert.equal(normalized.results[0].candidates[0].thresholdingMethod, "0");
  assert.equal(Object.hasOwn(normalized.results[0], "page"), false);
  assert.equal(Object.hasOwn(normalized.results[0], "unknownResultField"), false);
  assert.equal(Object.hasOwn(normalized.results[0].settings, "unknownSettingField"), false);
  assert.equal(Object.hasOwn(normalized.results[0].candidates[0], "unknownCandidateField"), false);
  assert.equal(Object.hasOwn(normalized, "unknownTopLevelField"), false);
  assert.equal(normalized.totalElapsedMs, 1200);
  assert.equal(normalized.nextSequence, 3);
  assert.equal(normalized.sourceNameChanged, false);
  assert.equal(normalized.combinedTextEdited, false);
  assert.deepEqual(normalized.dictionary, {
    name: "業務辞書",
    entries: 12,
    sourceFile: "dictionary.json",
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.results[0]), true);
});

test("normalizeResultHistory preserves edited text and detects undeclared text changes", () => {
  const changed = createHistoryPayload({
    overrides: {
      combinedText: "利用者が直した全文",
      combinedTextEdited: false,
    },
  });
  const normalizedChanged = core.normalizeResultHistory(changed, currentHistorySource, 1000);
  assert.equal(normalizedChanged.combinedText, "利用者が直した全文");
  assert.equal(normalizedChanged.combinedTextEdited, true);

  const declared = createHistoryPayload({
    overrides: { combinedTextEdited: true },
  });
  const normalizedDeclared = core.normalizeResultHistory(declared, currentHistorySource, 1000);
  assert.equal(normalizedDeclared.combinedTextEdited, true);

  const aggregateText = "a".repeat(core.MAX_CORRECTED_TEXT_CHARS + 1);
  const aggregate = createHistoryPayload({
    overrides: { combinedText: aggregateText, combinedTextEdited: true },
  });
  const normalizedAggregate = core.normalizeResultHistory(
    aggregate,
    currentHistorySource,
    core.MAX_HISTORY_BYTES,
  );
  assert.equal(normalizedAggregate.combinedText.length, aggregateText.length);
});

test("normalizeResultHistory reports only a PDF name mismatch and normalizes Unicode names", () => {
  const renamed = createHistoryPayload();
  const normalizedRenamed = core.normalizeResultHistory(renamed, {
    ...currentHistorySource,
    name: "名称変更.pdf",
  }, 1000);
  assert.equal(normalizedRenamed.sourceNameChanged, true);

  const canonicallyEquivalent = createHistoryPayload({
    overrides: {
      source: { ...currentHistorySource, name: "e\u0301.pdf" },
    },
  });
  const normalizedEquivalent = core.normalizeResultHistory(canonicallyEquivalent, {
    ...currentHistorySource,
    name: "é.pdf",
  }, 1000);
  assert.equal(normalizedEquivalent.sourceNameChanged, false);
});

test("normalizeResultHistory rejects oversized and incompatible v3 envelopes", () => {
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload(),
      currentHistorySource,
      core.MAX_HISTORY_BYTES + 1,
    ),
    (error) => error instanceof core.OcrInputError && error.code === "HISTORY_TOO_LARGE",
  );

  for (const [field, value, code] of [
    ["format", "other-format", "HISTORY_FORMAT"],
    ["version", 4, "HISTORY_VERSION"],
    ["coordinateSystem", "bottom-left", "HISTORY_COORDINATE_SYSTEM"],
    ["offline", false, "HISTORY_OFFLINE"],
  ]) {
    const payload = createHistoryPayload({ overrides: { [field]: value } });
    assert.throws(
      () => core.normalizeResultHistory(payload, currentHistorySource, 1000),
      (error) => error instanceof core.OcrInputError && error.code === code,
    );
  }
  assert.throws(
    () => core.normalizeResultHistory(null, currentHistorySource, 1000),
    (error) => error instanceof core.OcrInputError && error.code === "HISTORY_SHAPE",
  );
});

test("normalizeResultHistory requires the same PDF size and page count", () => {
  assert.throws(
    () => core.normalizeResultHistory(createHistoryPayload(), {
      ...currentHistorySource,
      bytes: currentHistorySource.bytes + 1,
    }, 1000),
    (error) => error.code === "HISTORY_SOURCE_BYTES_MISMATCH",
  );
  assert.throws(
    () => core.normalizeResultHistory(createHistoryPayload(), {
      ...currentHistorySource,
      totalPages: 3,
    }, 1000),
    (error) => error.code === "HISTORY_SOURCE_PAGES_MISMATCH",
  );
  assert.throws(
    () => core.normalizeResultHistory(createHistoryPayload(), null, 1000),
    (error) => error.code === "HISTORY_CURRENT_SOURCE",
  );
});

test("normalizeResultHistory enforces result and candidate limits", () => {
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_RESULTS_EMPTY",
  );

  const tooManyResults = Array.from({ length: 1001 }, (_, index) => (
    createHistoryResult({ sequence: index + 1 })
  ));
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: tooManyResults }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_TOO_MANY_RESULTS",
  );

  const candidate = createHistoryResult().candidates[0];
  const tooManyCandidates = createHistoryResult({
    comparedCandidates: 25,
    candidates: Array.from({ length: 25 }, () => ({ ...candidate })),
  });
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [tooManyCandidates] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_TOO_MANY_CANDIDATES",
  );

  const mismatchedCount = createHistoryResult({ comparedCandidates: 0 });
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [mismatchedCount] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_CANDIDATE_COUNT",
  );
});

test("normalizeResultHistory rejects duplicate sequences and invalid result coordinates", () => {
  const duplicateResults = [
    createHistoryResult({ sequence: 1 }),
    createHistoryResult({ sequence: 1, page: 2 }),
  ];
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: duplicateResults }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_DUPLICATE_SEQUENCE",
  );

  for (const invalidResult of [
    createHistoryResult({ sequence: 0 }),
    createHistoryResult({ page: 3 }),
    createHistoryResult({ region: { x: 0.8, y: 0.2, width: 0.3, height: 0.3 } }),
    createHistoryResult({ status: "cancelled" }),
  ]) {
    assert.throws(
      () => core.normalizeResultHistory(
        createHistoryPayload({ results: [invalidResult] }),
        currentHistorySource,
        1000,
      ),
      (error) => error instanceof core.OcrInputError,
    );
  }
});

test("normalizeResultHistory rejects non-string and non-finite result metadata", () => {
  const invalidText = createHistoryResult({ text: 42 });
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [invalidText] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_STRING",
  );

  const invalidConfidence = createHistoryResult({ confidence: Number.NaN });
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [invalidConfidence] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_NUMBER",
  );

  const outOfRangeConfidence = createHistoryResult({ confidence: 101 });
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [outOfRangeConfidence] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_NUMBER",
  );

  const invalidCandidateConfidence = createHistoryResult();
  invalidCandidateConfidence.candidates[0].confidence = -1;
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [invalidCandidateConfidence] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_NUMBER",
  );

  const invalidSetting = createHistoryResult({
    settings: { ...createHistoryResult().settings, compareVariants: "yes" },
  });
  assert.throws(
    () => core.normalizeResultHistory(
      createHistoryPayload({ results: [invalidSetting] }),
      currentHistorySource,
      1000,
    ),
    (error) => error.code === "HISTORY_BOOLEAN",
  );
});

test("sanitizeBaseName removes unsafe path characters and keeps Japanese", () => {
  assert.equal(core.sanitizeBaseName(" 診療/記録:2026.pdf "), "診療_記録_2026");
  assert.equal(core.sanitizeBaseName("...pdf"), "document");
});

test("base64ToBytes decodes embedded binary data", () => {
  assert.deepEqual([...core.base64ToBytes("AAECA/8=")], [0, 1, 2, 3, 255]);
});

test("createImagePdfBytes embeds a raster image in a valid one-page PDF", async () => {
  const pdfjs = require("../vendor/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(
    __dirname,
    "..",
    "vendor",
    "pdf.worker.min.js",
  );
  const jpeg = core.base64ToBytes(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD7LooooA//2Q==",
  );
  const documentTask = pdfjs.getDocument({
    data: core.createImagePdfBytes(jpeg, 8, 8),
    isEvalSupported: false,
  });
  const pdf = await documentTask.promise;
  assert.equal(pdf.numPages, 1);
  const page = await pdf.getPage(1);
  const text = await page.getTextContent();
  assert.equal(text.items.length, 0, "raster sample intentionally has no text layer");
  const operators = await page.getOperatorList();
  assert.ok(operators.fnArray.length > 0, "sample contains a visible image operation");
  await pdf.destroy();
});
