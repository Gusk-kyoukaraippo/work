(function initializeScanScribe(root, document) {
  "use strict";

  const core = root.OcrCore;
  const accuracy = root.AccuracyCore;
  const browserCompat = root.ScanScribeBrowserCompat;
  const DEFAULT_VARIANT = Object.freeze({
    id: "light",
    label: "軽量版",
    description: "従来相当の処理量で認識します。",
    modelVariant: "4.0.0_best_int",
    requiredModels: Object.freeze(["jpn", "eng"]),
    directRegionRendering: false,
    sourceMarginPoints: 0,
    ocrMaxPixels: 12_000_000,
    ocrMaxDimension: 10_000,
    pdfMaxImagePixels: 25_000_000,
    pdfCanvasMaxAreaBytes: 96 * 1024 * 1024,
    defaultScale: 4.167,
    qualityOptions: Object.freeze([
      Object.freeze({ value: 2.5, label: "軽量（約180dpi）" }),
      Object.freeze({ value: 4.167, label: "標準（約300dpi）" }),
      Object.freeze({ value: 5, label: "高精細（最大約360dpi）" }),
    ]),
    preprocessors: Object.freeze(["original", "contrast"]),
    psmEnsembleSize: 1,
    autoDeskew: false,
    characterConsensus: false,
  });
  const VARIANT = Object.freeze({
    ...DEFAULT_VARIANT,
    ...(root.ScanScribeVariant && typeof root.ScanScribeVariant === "object"
      ? root.ScanScribeVariant
      : {}),
  });
  const MAX_PDF_BYTES = 128 * 1024 * 1024;
  const LARGE_PDF_BYTES = 40 * 1024 * 1024;
  const MAX_PDF_PAGES = 20;
  const PDF_MAX_IMAGE_PIXELS = VARIANT.pdfMaxImagePixels;
  const PDF_CANVAS_MAX_AREA_BYTES = VARIANT.pdfCanvasMaxAreaBytes;
  const PDF_WORKER_PATH = "./vendor/pdf.worker.min.js";
  const IS_SINGLE_FILE_BUILD = document.documentElement.dataset.singleFile === "true";
  const PREVIEW_MAX_WIDTH = 1100;
  const PREVIEW_MAX_HEIGHT = 1600;
  const PREVIEW_MAX_PIXELS = 2_500_000;
  const PREVIEW_MAX_DIMENSION = 4096;
  const OCR_MAX_PIXELS = VARIANT.ocrMaxPixels;
  const OCR_MAX_DIMENSION = VARIANT.ocrMaxDimension;
  const MIN_SELECTION_CSS_PIXELS = 10;
  const OCR_STARTUP_TIMEOUT_MS = 180_000;
  const OCR_CONFIG_TIMEOUT_MS = 30_000;
  const OCR_RECOGNITION_TIMEOUT_MS = 300_000;
  const CONSENSUS_TEXT_SAMPLE_CHARS = 800;
  const PDF_PAGE_TIMEOUT_MS = 30_000;
  const PDF_RENDER_TIMEOUT_MS = 120_000;
  const WORKER_TERMINATION_TIMEOUT_MS = 2_000;

  const elementIds = [
    "variantBadge",
    "protocolBadge",
    "compatibilityNotice",
    "compatibilityMessage",
    "dropZone",
    "pdfFile",
    "pdfSelectButton",
    "sampleButton",
    "fileSummary",
    "fileName",
    "fileMeta",
    "removeFileButton",
    "historyImportPanel",
    "historyFile",
    "historySelectButton",
    "historyError",
    "passwordForm",
    "pdfPassword",
    "passwordError",
    "settingsPanel",
    "settingsHeading",
    "previousPageButton",
    "pageSelect",
    "pageCountLabel",
    "nextPageButton",
    "previewFigure",
    "selectionSurface",
    "pageCanvas",
    "selectionBox",
    "previewCaption",
    "selectFullPageButton",
    "clearSelectionButton",
    "selectionSummary",
    "ocrLanguage",
    "renderQuality",
    "pageLayout",
    "enhanceScan",
    "autoRotate",
    "dictionaryFile",
    "dictionarySelectButton",
    "dictionarySummary",
    "dictionaryName",
    "dictionaryMeta",
    "dictionaryError",
    "removeDictionaryButton",
    "startButton",
    "progressPanel",
    "progressHeading",
    "cancelButton",
    "progressStage",
    "progressDetail",
    "progressPercent",
    "overallProgress",
    "resultPanel",
    "resultHeading",
    "resultStatusBadge",
    "resultStats",
    "resultText",
    "characterCount",
    "pageResultList",
    "copyButton",
    "downloadTextButton",
    "downloadJsonButton",
    "newDocumentButton",
    "liveRegion",
    "toast",
    "buildFooter",
  ];

  const elements = Object.fromEntries(
    elementIds.map((id) => [id, document.getElementById(id)]),
  );

  const state = {
    mode: "booting",
    compatible: false,
    controlsLocked: false,
    sampleCreating: false,
    documentToken: 0,
    previewToken: 0,
    runToken: 0,
    file: null,
    pdfDocument: null,
    loadingTask: null,
    passwordCallback: null,
    previewRenderTask: null,
    previewLoading: false,
    previewReady: false,
    currentPageNumber: 1,
    selection: null,
    selectionDrag: null,
    dictionary: null,
    dictionaryMatcher: null,
    dictionaryFileName: null,
    dictionaryLoadToken: 0,
    dictionaryLoading: false,
    historyLoadToken: 0,
    historyLoading: false,
    activeRun: null,
    ocrSession: null,
    results: [],
    nextSequence: 1,
    resultTextDirty: false,
    resultTextEdited: false,
    resultDictionary: null,
    totalElapsedMs: 0,
    latestProgress: 0,
  };

  let toastTimer = null;

  class RunCancelledError extends Error {
    constructor() {
      super("The OCR run was cancelled.");
      this.name = "RunCancelledError";
    }
  }

  class OperationTimeoutError extends Error {
    constructor(label) {
      super(`${label} timed out.`);
      this.name = "OperationTimeoutError";
      this.code = "OPERATION_TIMEOUT";
      this.label = label;
    }
  }

  start();

  function start() {
    applyVariantUi();
    bindEvents();
    state.compatible = checkCompatibility();
    state.mode = state.compatible ? "idle" : "unsupported";
    updateSelectionUi();
  }

  function applyVariantUi() {
    elements.variantBadge.textContent = VARIANT.label;
    elements.variantBadge.title = VARIANT.description;
    document.title = `ScanScribe ${VARIANT.label} — ローカルPDF文字起こし`;
    elements.buildFooter.textContent =
      `単一HTML・完全オフライン ${VARIANT.label}`
      + `${browserCompat?.usingStructuredCloneFallback ? " / PDF互換モード" : ""}`
      + " — PDF.js 3.11.174 / Tesseract.js 7.0.0";

    const qualityOptions = Array.isArray(VARIANT.qualityOptions)
      ? VARIANT.qualityOptions
      : DEFAULT_VARIANT.qualityOptions;
    elements.renderQuality.replaceChildren(...qualityOptions.map((entry) => {
      const option = document.createElement("option");
      option.value = String(entry.value);
      option.textContent = String(entry.label);
      option.selected = Number(entry.value) === Number(VARIANT.defaultScale);
      return option;
    }));

  }

  function bindEvents() {
    elements.pdfSelectButton.addEventListener("click", () => elements.pdfFile.click());
    elements.pdfFile.addEventListener("change", () => {
      const [file] = elements.pdfFile.files || [];
      if (file) void loadPdfFile(file);
      elements.pdfFile.value = "";
    });
    elements.sampleButton.addEventListener("click", () => void loadSamplePdf());
    elements.removeFileButton.addEventListener("click", () => void resetDocument({ focusPicker: true }));
    elements.newDocumentButton.addEventListener("click", () => void resetDocument({ focusPicker: true }));
    elements.historyFile.addEventListener("change", () => {
      const [file] = elements.historyFile.files || [];
      if (file) void loadHistoryFile(file);
      elements.historyFile.value = "";
    });
    elements.historySelectButton.addEventListener("click", () => elements.historyFile.click());

    let dragDepth = 0;
    elements.dropZone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      if (isBusy()) return;
      dragDepth += 1;
      elements.dropZone.dataset.state = "dragging";
    });
    elements.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    elements.dropZone.addEventListener("dragleave", (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) elements.dropZone.dataset.state = "empty";
    });
    elements.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      elements.dropZone.dataset.state = "empty";
      if (isBusy()) return;
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length !== 1) {
        showToast("PDFを1ファイルだけ選んでください。", "error");
        return;
      }
      void loadPdfFile(files[0]);
    });

    elements.passwordForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitPdfPassword();
    });

    elements.previousPageButton.addEventListener("click", () => {
      if (state.currentPageNumber > 1) {
        void loadPreviewPage(state.currentPageNumber - 1);
      }
    });
    elements.nextPageButton.addEventListener("click", () => {
      if (state.pdfDocument && state.currentPageNumber < state.pdfDocument.numPages) {
        void loadPreviewPage(state.currentPageNumber + 1);
      }
    });
    elements.pageSelect.addEventListener("change", () => {
      void loadPreviewPage(Number(elements.pageSelect.value));
    });

    elements.selectionSurface.addEventListener("mousedown", beginMouseSelection);
    root.addEventListener("mousemove", updateMouseSelection);
    root.addEventListener("mouseup", finishMouseSelection);
    root.addEventListener("blur", cancelMouseSelection);
    elements.selectFullPageButton.addEventListener("click", selectFullPage);
    elements.clearSelectionButton.addEventListener("click", () => clearSelection());

    for (const control of [
      elements.ocrLanguage,
      elements.renderQuality,
      elements.pageLayout,
      elements.enhanceScan,
      elements.autoRotate,
    ]) {
      control.addEventListener("change", updateSelectionUi);
    }

    elements.dictionaryFile.addEventListener("change", () => {
      const [file] = elements.dictionaryFile.files || [];
      if (file) void loadDictionaryFile(file);
      elements.dictionaryFile.value = "";
    });
    elements.dictionarySelectButton.addEventListener("click", () => elements.dictionaryFile.click());
    elements.removeDictionaryButton.addEventListener("click", removeDictionary);

    elements.startButton.addEventListener("click", () => void startRegionOcr());
    elements.cancelButton.addEventListener("click", () => void cancelOcrRun());
    elements.resultText.addEventListener("input", () => {
      state.resultTextDirty = true;
      state.resultTextEdited = true;
      updateCharacterCount();
      updateOutputLengthStat();
    });
    elements.copyButton.addEventListener("click", () => void copyResult());
    elements.downloadTextButton.addEventListener("click", downloadTextResult);
    elements.downloadJsonButton.addEventListener("click", downloadJsonResult);

    root.addEventListener("beforeunload", (event) => {
      if (!isBusy() && !state.resultTextDirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function checkCompatibility() {
    const missing = [];
    if (!core) missing.push("アプリ本体");
    if (!accuracy) missing.push("高精度画像処理機能");
    if (
      !browserCompat
      || browserCompat.installed !== true
      || browserCompat.version !== 1
      || typeof browserCompat.readBlobAsArrayBuffer !== "function"
    ) {
      missing.push("PDF互換機能");
    }
    if (!root.pdfjsLib) missing.push("PDF解析機能");
    if (!root.pdfjsWorker?.WorkerMessageHandler) missing.push("PDF処理機能");
    if (!root.Tesseract?.createWorker) missing.push("OCR機能");
    if (
      root.ScanScribeNetworkGuard?.installed !== true
      || root.ScanScribeNetworkGuard?.version !== 1
      || !root.ScanScribeNetworkGuard?.captureWorkers
    ) {
      missing.push("オフライン保護機能");
    }
    const missingModels = (VARIANT.requiredModels || DEFAULT_VARIANT.requiredModels)
      .filter((code) => !root.ScanScribeAssets?.models?.[code]);
    if (missingModels.length > 0) {
      missing.push("言語モデル");
    }
    if (typeof root.Worker !== "function") missing.push("Web Worker");
    if (typeof root.WebAssembly !== "object") missing.push("WebAssembly");
    if (typeof root.Blob !== "function") missing.push("Blob API");
    if (typeof root.structuredClone !== "function") missing.push("PDFデータ複製機能");
    if (typeof root.AbortController !== "function") missing.push("中止制御機能");
    if (typeof root.HTMLCanvasElement !== "function") missing.push("画像処理機能");

    elements.protocolBadge.textContent = root.location.protocol === "file:"
      ? "file:// 実行中"
      : "オフライン構成";

    if (missing.length > 0) {
      elements.compatibilityMessage.textContent =
        `${missing.join("・")}を読み込めませんでした。単一HTMLを対応ブラウザで開き直してください。`;
      elements.compatibilityNotice.hidden = false;
      elements.startButton.disabled = true;
      return false;
    }

    if (!IS_SINGLE_FILE_BUILD) {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        PDF_WORKER_PATH,
        root.location.href,
      ).href;
    }
    return true;
  }

  function isBusy() {
    return state.sampleCreating
      || state.historyLoading
      || state.dictionaryLoading
      || state.mode === "loadingPdf"
      || state.mode === "running"
      || state.mode === "cancelling";
  }

  async function loadSamplePdf() {
    if (!state.compatible || isBusy()) return;
    state.sampleCreating = true;
    setControlsLocked(true);
    try {
      const bytes = await createSamplePdfBytes();
      const file = createSamplePdfFile(bytes);
      elements.ocrLanguage.value = "jpn+eng";
      elements.renderQuality.value = String(VARIANT.defaultScale);
      elements.pageLayout.value = "6";
      elements.enhanceScan.checked = true;
      elements.autoRotate.checked = false;
      state.sampleCreating = false;
      await loadPdfFile(file, {
        initialSelection: { x: 0.065, y: 0.055, width: 0.87, height: 0.62 },
      });
    } catch (error) {
      showToast(toUserError(error, "サンプルPDFを作成できませんでした。"), "error", 5200);
    } finally {
      state.sampleCreating = false;
      setControlsLocked(isBusy());
    }
  }

  async function createSamplePdfBytes() {
    const canvas = document.createElement("canvas");
    canvas.width = 1700;
    canvas.height = 2200;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new core.OcrInputError(
        "この端末では動作確認用の画像を作成できませんでした。",
        "SAMPLE_CANVAS_UNAVAILABLE",
      );
    }
    const fontFamily = 'system-ui, -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif';

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#d7dcda";
    context.lineWidth = 4;
    context.strokeRect(110, 105, 1480, 1370);

    context.fillStyle = "#172421";
    context.font = `700 76px ${fontFamily}`;
    context.fillText("完全オフライン文字認識", 190, 265);
    context.font = `500 60px ${fontFamily}`;
    context.fillText("文書番号 12345", 190, 390);
    context.fillText("請求金額 123,450円", 190, 510);

    context.strokeStyle = "#2f7772";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(190, 620);
    context.lineTo(1510, 620);
    context.stroke();

    context.fillStyle = "#172421";
    context.font = `700 82px ${fontFamily}`;
    context.fillText("LOCAL OCR SAMPLE", 190, 800);
    context.font = `500 58px ${fontFamily}`;
    context.fillText("Document No. 2026-0717", 190, 930);
    context.fillText("Total: JPY 123,450", 190, 1045);
    context.font = `400 48px ${fontFamily}`;
    context.fillStyle = "#485653";
    context.fillText("The quick brown fox jumps over the lazy dog.", 190, 1190);

    context.fillStyle = "#edf3f1";
    context.fillRect(110, 1570, 1480, 390);
    context.fillStyle = "#4f5e5a";
    context.font = `500 42px ${fontFamily}`;
    context.fillText("このページは通常フォントを画像化したOCR確認用サンプルです。", 180, 1725);
    context.fillText("上の枠を囲み直して、複数回の追記も試せます。", 180, 1825);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (created) => created ? resolve(created) : reject(new Error("SAMPLE_IMAGE_FAILED")),
        "image/jpeg",
        0.96,
      );
    });
    const jpegBytes = new Uint8Array(await browserCompat.readBlobAsArrayBuffer(blob));
    canvas.width = 1;
    canvas.height = 1;
    return core.createImagePdfBytes(jpegBytes, 1700, 2200);
  }

  function createSamplePdfFile(bytes) {
    const options = {
      type: "application/pdf",
      lastModified: Date.now(),
    };
    if (typeof root.File === "function") {
      try {
        return new root.File([bytes], "scanscribe_offline_sample.pdf", options);
      } catch {
        // Some managed browsers expose File but block direct construction.
      }
    }
    const blob = new Blob([bytes], { type: options.type });
    Object.defineProperties(blob, {
      name: {
        configurable: true,
        enumerable: true,
        value: "scanscribe_offline_sample.pdf",
      },
      lastModified: {
        configurable: true,
        enumerable: true,
        value: options.lastModified,
      },
    });
    return blob;
  }

  async function loadPdfFile(file, options = {}) {
    if (!state.compatible || isBusy()) return;
    const token = ++state.documentToken;
    let diagnosticStage = "PDF_VALIDATE";

    try {
      validatePdfFile(file);
      state.mode = "loadingPdf";
      state.file = file;
      showFileLoading(file);
      setControlsLocked(true);
      clearPasswordUi();

      diagnosticStage = "PDF_HEADER_READ";
      const headerBytes = new Uint8Array(
        await browserCompat.readBlobAsArrayBuffer(file.slice(0, 1024)),
      );
      const header = String.fromCharCode(...headerBytes);
      if (!header.includes("%PDF-")) {
        throw new core.OcrInputError(
          "PDFの内容を確認できませんでした。拡張子だけでなく、実際のPDFを選んでください。",
          "NOT_A_PDF",
        );
      }
      if (token !== state.documentToken) return;

      clearDocumentResults();
      cancelPreviewRender();
      await disposeOcrWorker(null, state.ocrSession?.resources);
      await disposePdfDocument();
      if (token !== state.documentToken) return;

      diagnosticStage = "PDF_FILE_READ";
      const data = new Uint8Array(await browserCompat.readBlobAsArrayBuffer(file));
      if (token !== state.documentToken) return;

      diagnosticStage = "PDF_PARSE";
      const loadingTask = root.pdfjsLib.getDocument({
        data,
        maxImageSize: PDF_MAX_IMAGE_PIXELS,
        canvasMaxAreaInBytes: PDF_CANVAS_MAX_AREA_BYTES,
        isEvalSupported: false,
        stopAtErrors: false,
        useSystemFonts: true,
        isOffscreenCanvasSupported: false,
      });
      state.loadingTask = loadingTask;
      loadingTask.onPassword = (updatePassword, reason) => {
        if (token !== state.documentToken) return;
        setPasswordPending(false);
        state.passwordCallback = updatePassword;
        elements.passwordForm.hidden = false;
        const incorrect = reason === root.pdfjsLib.PasswordResponses?.INCORRECT_PASSWORD;
        elements.pdfPassword.toggleAttribute("aria-invalid", incorrect);
        elements.passwordError.textContent = incorrect
          ? "パスワードが正しくありません。もう一度入力してください。"
          : "";
        elements.pdfPassword.value = "";
        elements.pdfPassword.focus();
      };

      const pdfDocument = await loadingTask.promise;
      if (token !== state.documentToken) {
        await pdfDocument.destroy();
        return;
      }
      if (
        !Number.isSafeInteger(pdfDocument.numPages)
        || pdfDocument.numPages < 1
        || pdfDocument.numPages > MAX_PDF_PAGES
      ) {
        await pdfDocument.destroy();
        throw new core.OcrInputError(
          `PDFは1〜${MAX_PDF_PAGES}ページの範囲にしてください。`,
          "PDF_PAGE_COUNT_UNSUPPORTED",
        );
      }

      state.pdfDocument = pdfDocument;
      state.loadingTask = null;
      state.currentPageNumber = 1;
      clearPasswordUi();
      state.mode = "ready";
      showFileReady(file, pdfDocument.numPages);
      elements.settingsPanel.hidden = false;
      populatePageSelect(pdfDocument.numPages);
      setControlsLocked(false);
      await loadPreviewPage(1, options.initialSelection || null);
      if (token !== state.documentToken) return;

      if (pdfDocument.numPages > 5) {
        showToast("この操作は5ページ程度の文書を想定しています。必要なページを一つずつ選んでください。", "warning", 5400);
      } else if (file.size > LARGE_PDF_BYTES) {
        showToast("大きなPDFです。高精細設定では処理に時間がかかることがあります。", "warning");
      }
      announce(`${file.name}、${pdfDocument.numPages}ページを読み込みました。文字の範囲を囲んでください。`);
    } catch (error) {
      if (token !== state.documentToken) return;
      if (error && typeof error === "object" && !error.scanScribeDiagnosticStage) {
        try {
          error.scanScribeDiagnosticStage = diagnosticStage;
        } catch {
          // A frozen browser error can still be shown without a diagnostic stage.
        }
      }
      state.previewToken += 1;
      cancelPreviewRender();
      await disposePdfDocument();
      if (token !== state.documentToken) return;
      state.mode = "idle";
      state.file = null;
      state.previewReady = false;
      state.previewLoading = false;
      state.selection = null;
      state.selectionDrag = null;
      clearPasswordUi();
      clearCanvas();
      clearDocumentResults();
      showEmptyFilePicker();
      setControlsLocked(false);
      showToast(toUserError(error, "PDFを開けませんでした。"), "error", 5200);
    }
  }

  function validatePdfFile(file) {
    if (
      !(file instanceof Blob)
      || typeof file.name !== "string"
      || !file.name
    ) {
      throw new core.OcrInputError("PDFファイルを選んでください。", "FILE_REQUIRED");
    }
    if (file.size === 0) {
      throw new core.OcrInputError("空のファイルは読み取れません。", "EMPTY_FILE");
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new core.OcrInputError(
        `${core.formatBytes(MAX_PDF_BYTES)}以下のPDFを選んでください。`,
        "PDF_TOO_LARGE",
      );
    }
    const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!looksLikePdf) {
      throw new core.OcrInputError("PDF形式のファイルを選んでください。", "NOT_A_PDF");
    }
  }

  function submitPdfPassword() {
    if (!state.passwordCallback) return;
    const password = elements.pdfPassword.value;
    if (!password) {
      elements.passwordError.textContent = "パスワードを入力してください。";
      elements.pdfPassword.setAttribute("aria-invalid", "true");
      return;
    }
    const updatePassword = state.passwordCallback;
    state.passwordCallback = null;
    elements.passwordError.textContent = "";
    elements.pdfPassword.removeAttribute("aria-invalid");
    setPasswordPending(true);
    updatePassword(password);
    elements.pdfPassword.value = "";
  }

  function clearPasswordUi() {
    state.passwordCallback = null;
    elements.passwordForm.hidden = true;
    elements.pdfPassword.value = "";
    elements.passwordError.textContent = "";
    elements.pdfPassword.removeAttribute("aria-invalid");
    setPasswordPending(false);
  }

  function setPasswordPending(pending) {
    elements.pdfPassword.disabled = pending;
    const submit = elements.passwordForm.querySelector('button[type="submit"]');
    if (submit) submit.disabled = pending;
    if (pending) elements.passwordError.textContent = "パスワードを確認しています…";
  }

  function showFileLoading(file) {
    elements.dropZone.hidden = true;
    elements.fileSummary.hidden = false;
    elements.historyImportPanel.hidden = true;
    elements.historyError.textContent = "";
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${core.formatBytes(file.size)} ・ PDFを確認しています…`;
    elements.settingsPanel.hidden = true;
    elements.resultPanel.hidden = true;
    elements.progressPanel.hidden = true;
  }

  function showFileReady(file, pages) {
    elements.dropZone.hidden = true;
    elements.fileSummary.hidden = false;
    elements.historyImportPanel.hidden = false;
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${core.formatBytes(file.size)} ・ ${pages.toLocaleString("ja-JP")}ページ`;
  }

  function showEmptyFilePicker() {
    elements.dropZone.hidden = false;
    elements.dropZone.dataset.state = "empty";
    elements.fileSummary.hidden = true;
    elements.historyImportPanel.hidden = true;
    elements.settingsPanel.hidden = true;
    elements.progressPanel.hidden = true;
    elements.resultPanel.hidden = true;
    elements.previewFigure.hidden = true;
    elements.fileName.textContent = "";
    elements.fileMeta.textContent = "";
    elements.historyError.textContent = "";
  }

  async function resetDocument(options = {}) {
    if (isBusy() && state.mode !== "loadingPdf") return;
    if (!confirmDocumentReset()) return;
    state.documentToken += 1;
    state.previewToken += 1;
    state.runToken += 1;
    const run = state.activeRun;
    cancelRunContext(run);
    cancelPreviewRender();
    clearPasswordUi();
    await disposeOcrWorker(run, run?.workerResources || state.ocrSession?.resources);
    await disposePdfDocument();
    if (state.activeRun === run) state.activeRun = null;
    state.mode = state.compatible ? "idle" : "unsupported";
    state.file = null;
    state.currentPageNumber = 1;
    state.previewReady = false;
    state.previewLoading = false;
    state.selection = null;
    state.selectionDrag = null;
    clearCanvas();
    clearDocumentResults();
    showEmptyFilePicker();
    setControlsLocked(false);
    if (options.focusPicker) elements.pdfSelectButton.focus();
  }

  async function disposePdfDocument() {
    const loadingTask = state.loadingTask;
    const pdfDocument = state.pdfDocument;
    state.loadingTask = null;
    state.pdfDocument = null;
    try {
      if (pdfDocument) {
        await pdfDocument.destroy();
      } else if (loadingTask?.destroy) {
        await loadingTask.destroy();
      }
    } catch {
      // Stale document and preview tokens prevent cleanup races from updating the UI.
    }
  }

  function populatePageSelect(totalPages) {
    const options = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const option = document.createElement("option");
      option.value = String(pageNumber);
      option.textContent = String(pageNumber);
      options.push(option);
    }
    elements.pageSelect.replaceChildren(...options);
    elements.pageSelect.value = "1";
    elements.pageCountLabel.textContent = `/ ${totalPages.toLocaleString("ja-JP")}`;
    updatePageControls();
  }

  async function loadPreviewPage(pageNumber, initialSelection = null) {
    if (!state.pdfDocument || isBusy()) return;
    const totalPages = state.pdfDocument.numPages;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) return;

    const token = ++state.previewToken;
    cancelPreviewRender();
    state.previewLoading = true;
    state.previewReady = false;
    state.currentPageNumber = pageNumber;
    state.selectionDrag = null;
    state.selection = null;
    renderSelectionBox();
    elements.pageSelect.value = String(pageNumber);
    elements.previewFigure.hidden = false;
    elements.previewCaption.textContent = `${pageNumber}ページを表示しています…`;
    updatePageControls();
    updateSelectionUi();
    let page = null;
    let renderTask = null;

    try {
      page = await state.pdfDocument.getPage(pageNumber);
      if (token !== state.previewToken || !state.pdfDocument) return;
      const unitViewport = page.getViewport({ scale: 1 });
      const requestedPreviewScale = Math.min(
        1.6,
        PREVIEW_MAX_WIDTH / unitViewport.width,
        PREVIEW_MAX_HEIGHT / unitViewport.height,
      );
      const scale = core.calculateRenderScale(
        unitViewport.width,
        unitViewport.height,
        requestedPreviewScale,
        PREVIEW_MAX_PIXELS,
        PREVIEW_MAX_DIMENSION,
      );
      const viewport = page.getViewport({ scale });
      const canvas = elements.pageCanvas;
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      renderTask = page.render({
        canvasContext: context,
        viewport,
        background: "rgb(255,255,255)",
      });
      state.previewRenderTask = renderTask;
      await renderTask.promise;
      if (token !== state.previewToken || !state.pdfDocument) return;

      state.previewReady = true;
      elements.previewCaption.textContent =
        `${pageNumber}ページ — マウスで読みたい文字を四角く囲んでください`;
      if (initialSelection) {
        state.selection = core.normalizeRegion(
          initialSelection.x,
          initialSelection.y,
          initialSelection.x + initialSelection.width,
          initialSelection.y + initialSelection.height,
        );
      }
      renderSelectionBox();
      announce(`${pageNumber}ページを表示しました。文字の範囲をマウスで囲んでください。`);
    } catch (error) {
      if (token !== state.previewToken || /RenderingCancelledException/i.test(String(error?.name))) return;
      state.previewReady = false;
      clearCanvas();
      elements.previewCaption.textContent = `${pageNumber}ページを表示できませんでした`;
      showToast(toUserError(error, "ページを表示できませんでした。"), "error");
    } finally {
      if (state.previewRenderTask === renderTask) state.previewRenderTask = null;
      if (token === state.previewToken) {
        state.previewLoading = false;
        updatePageControls();
        updateSelectionUi();
      }
      try {
        page?.cleanup();
      } catch {
        // Preview page cleanup is best-effort.
      }
    }
  }

  function cancelPreviewRender() {
    try {
      state.previewRenderTask?.cancel();
    } catch {
      // The preview may have completed immediately before cancellation.
    }
    state.previewRenderTask = null;
  }

  function updatePageControls() {
    const totalPages = state.pdfDocument?.numPages || 0;
    const locked = state.controlsLocked || state.previewLoading || !state.pdfDocument;
    elements.pageSelect.disabled = locked;
    elements.previousPageButton.disabled = locked || state.currentPageNumber <= 1;
    elements.nextPageButton.disabled = locked || state.currentPageNumber >= totalPages;
  }

  function beginMouseSelection(event) {
    if (
      event.button !== 0
      || state.controlsLocked
      || !state.previewReady
      || !state.pdfDocument
    ) return;
    event.preventDefault();
    const point = selectionPointFromMouse(event);
    state.selectionDrag = { start: point, current: point };
    state.selection = null;
    renderSelectionBox();
    updateSelectionUi();
  }

  function updateMouseSelection(event) {
    if (!state.selectionDrag) return;
    if (event.type === "mousemove" && (event.buttons & 1) === 0) {
      finishMouseSelection(event);
      return;
    }
    event.preventDefault();
    applyMouseSelectionPoint(event);
    renderSelectionBox();
  }

  function finishMouseSelection(event) {
    if (!state.selectionDrag) return;
    if (event) applyMouseSelectionPoint(event);
    const surfaceRect = elements.selectionSurface.getBoundingClientRect();
    const region = state.selection;
    state.selectionDrag = null;
    if (
      !region
      || region.width * surfaceRect.width < MIN_SELECTION_CSS_PIXELS
      || region.height * surfaceRect.height < MIN_SELECTION_CSS_PIXELS
    ) {
      state.selection = null;
      showToast("文字が入るように、もう少し大きく囲んでください。", "warning");
    }
    renderSelectionBox();
    updateSelectionUi();
  }

  function applyMouseSelectionPoint(event) {
    const point = selectionPointFromMouse(event);
    state.selectionDrag.current = point;
    state.selection = core.normalizeRegion(
      state.selectionDrag.start.x,
      state.selectionDrag.start.y,
      point.x,
      point.y,
    );
  }

  function cancelMouseSelection() {
    if (!state.selectionDrag) return;
    state.selectionDrag = null;
    state.selection = null;
    renderSelectionBox();
    updateSelectionUi();
  }

  function selectionPointFromMouse(event) {
    const rect = elements.selectionSurface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  }

  function selectFullPage() {
    if (!state.previewReady || state.controlsLocked) return;
    state.selection = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
    state.selectionDrag = null;
    renderSelectionBox();
    updateSelectionUi();
    announce("ページ全体を選択しました。");
  }

  function clearSelection(options = {}) {
    state.selection = null;
    state.selectionDrag = null;
    renderSelectionBox();
    updateSelectionUi();
    if (options.announce !== false) announce("選択範囲を消しました。");
  }

  function renderSelectionBox() {
    const region = state.selection;
    elements.selectionBox.hidden = !region;
    elements.selectionSurface.classList.toggle("has-selection", Boolean(region));
    if (!region) return;
    elements.selectionBox.style.left = `${region.x * 100}%`;
    elements.selectionBox.style.top = `${region.y * 100}%`;
    elements.selectionBox.style.width = `${region.width * 100}%`;
    elements.selectionBox.style.height = `${region.height * 100}%`;
  }

  function updateSelectionUi() {
    const canSelect = Boolean(state.pdfDocument && state.previewReady && !state.controlsLocked);
    elements.selectionSurface.classList.toggle("is-disabled", !canSelect);
    elements.selectFullPageButton.disabled = !canSelect;
    elements.clearSelectionButton.disabled = !canSelect || !state.selection;

    if (!state.pdfDocument) {
      elements.selectionSummary.textContent = "PDFを読み込むと範囲を選べます";
    } else if (state.previewLoading) {
      elements.selectionSummary.textContent = `${state.currentPageNumber}ページを表示しています…`;
    } else if (!state.previewReady) {
      elements.selectionSummary.textContent = "ページを表示できませんでした";
    } else if (!state.selection) {
      elements.selectionSummary.textContent =
        `${state.currentPageNumber}ページ：マウスで文字の範囲を囲んでください`;
    } else {
      const width = Math.round(state.selection.width * 100);
      const height = Math.round(state.selection.height * 100);
      elements.selectionSummary.textContent =
        `${state.currentPageNumber}ページの選択範囲（幅${width}% × 高さ${height}%）を読み取ります`;
    }

    elements.startButton.disabled = !(
      state.compatible
      && state.pdfDocument
      && state.previewReady
      && state.selection
      && !isBusy()
      && !state.controlsLocked
      && !state.dictionaryLoading
    );
    updatePageControls();
  }

  async function loadHistoryFile(file) {
    if (isBusy() || !state.file || !state.pdfDocument) return;
    const token = ++state.historyLoadToken;
    state.historyLoading = true;
    elements.historyError.textContent = "";
    elements.historyFile.removeAttribute("aria-invalid");
    elements.historySelectButton.removeAttribute("aria-invalid");
    setControlsLocked(true);
    setHistoryLoadingUi(true);

    try {
      if (!(file instanceof File)) {
        throw new core.OcrInputError("ScanScribeのJSON履歴を選んでください。", "HISTORY_FILE_REQUIRED");
      }
      if (file.size > core.MAX_HISTORY_BYTES) {
        throw new core.OcrInputError(
          `作業JSONは${core.formatBytes(core.MAX_HISTORY_BYTES)}以下にしてください。`,
          "HISTORY_TOO_LARGE",
        );
      }
      const parsed = JSON.parse(await file.text());
      if (token !== state.historyLoadToken) return;
      const history = core.normalizeResultHistory(
        parsed,
        {
          name: state.file.name,
          bytes: state.file.size,
          totalPages: state.pdfDocument.numPages,
        },
        file.size,
      );

      if (
        history.sourceNameChanged
        && !root.confirm(
          `履歴は「${history.source.name}」から保存されています。現在のPDF「${state.file.name}」は容量とページ数が一致していますが、ファイル名が異なります。読み込みますか？`,
        )
      ) {
        showToast("作業JSONの読み込みを取り消しました。", "info");
        return;
      }
      if (!confirmHistoryReplacement()) {
        showToast("現在の読み取り結果を残し、作業JSONの読み込みを取り消しました。", "info", 4200);
        return;
      }
      if (token !== state.historyLoadToken) return;

      const clearedActiveDictionary = Boolean(state.dictionary);
      clearDictionaryForHistoryImport();
      state.results = history.results.map((result) => ({ ...result }));
      state.nextSequence = history.nextSequence;
      state.totalElapsedMs = history.totalElapsedMs;
      state.resultDictionary = history.dictionary;
      state.resultTextEdited = history.combinedTextEdited;
      elements.resultText.value = history.combinedText;
      updateCharacterCount();
      renderResultView();
      state.resultTextDirty = false;
      elements.historyError.textContent = "";
      elements.historyFile.removeAttribute("aria-invalid");
      elements.historySelectButton.removeAttribute("aria-invalid");

      const dictionaryNote = history.dictionary || clearedActiveDictionary
        ? " 続きにも同じ補正を使う場合は、補正辞書を選び直してください。"
        : "";
      showToast(
        `${history.results.length.toLocaleString("ja-JP")}件の読み取り履歴を復元しました。${dictionaryNote}`,
        "success",
        dictionaryNote ? 6200 : 4200,
      );
      announce(`${history.results.length}件の読み取り履歴を復元しました。次の範囲から続けられます。`, true);
      root.requestAnimationFrame(() => elements.resultHeading.focus({ preventScroll: false }));
    } catch (error) {
      if (token !== state.historyLoadToken) return;
      elements.historyError.textContent = error instanceof SyntaxError
        ? "JSONの構文を確認してください。現在の読み取り結果は変更していません。"
        : `${toUserError(error, "作業JSONを読み込めませんでした。")} 現在の読み取り結果は変更していません。`;
      elements.historyFile.setAttribute("aria-invalid", "true");
      elements.historySelectButton.setAttribute("aria-invalid", "true");
    } finally {
      if (token === state.historyLoadToken) {
        state.historyLoading = false;
        setControlsLocked(false);
        setHistoryLoadingUi(false);
      }
    }
  }

  function confirmHistoryReplacement() {
    if (state.results.length === 0) return true;
    if (state.resultTextDirty) {
      return root.confirm(
        "現在の読み取り結果には、作業JSONへ保存していない変更があります。読み込んだ履歴で置き換えますか？",
      );
    }
    return root.confirm("現在表示している読み取り履歴を、選んだ作業JSONで置き換えますか？");
  }

  function setHistoryLoadingUi(loading) {
    elements.historySelectButton.textContent = loading ? "作業JSONを確認中…" : "作業JSONを読み込む";
    elements.historySelectButton.disabled = loading || state.controlsLocked;
    elements.historyFile.disabled = loading || state.controlsLocked;
  }

  async function loadDictionaryFile(file) {
    if (isBusy()) return;
    const token = ++state.dictionaryLoadToken;
    state.dictionaryLoading = true;
    setDictionaryLoadingUi(true);
    elements.dictionaryError.textContent = "";
    try {
      if (file.size > core.MAX_DICTIONARY_BYTES) {
        throw new core.OcrInputError(
          `辞書は${core.formatBytes(core.MAX_DICTIONARY_BYTES)}以下にしてください。`,
          "DICTIONARY_TOO_LARGE",
        );
      }
      const parsed = JSON.parse(await file.text());
      if (token !== state.dictionaryLoadToken) return;
      const dictionary = core.normalizeDictionary(parsed, file.size);
      const matcher = core.compileDictionary(dictionary);
      if (!confirmResultRegeneration("辞書を変更すると")) {
        showToast("辞書の変更を取り消しました。手編集した結果はそのままです。", "info", 4200);
        return;
      }
      if (token !== state.dictionaryLoadToken) return;
      const resultUpdates = prepareDictionaryResultUpdates(matcher);
      state.dictionary = dictionary;
      state.dictionaryMatcher = matcher;
      state.dictionaryFileName = file.name;

      elements.dictionaryFile.removeAttribute("aria-invalid");
      elements.dictionarySelectButton.removeAttribute("aria-invalid");
      elements.dictionarySummary.hidden = false;
      elements.dictionaryName.textContent = dictionary.name;
      elements.dictionaryMeta.textContent =
        `${dictionary.entries.length.toLocaleString("ja-JP")}件 ・ ${file.name} ・ 保存しません`;
      const skippedCorrections = commitDictionaryResultUpdates(
        resultUpdates,
        createDictionaryMetadata(dictionary, file.name),
      );
      if (skippedCorrections > 0) {
        showToast(
          `辞書を読み込みましたが、${skippedCorrections}件は置換結果が大きすぎるため補正を省略しました。`,
          "warning",
          6000,
        );
      } else {
        showToast(`補正辞書「${dictionary.name}」を読み込みました。`, "success");
      }
    } catch (error) {
      if (token !== state.dictionaryLoadToken) return;
      elements.dictionaryError.textContent = error instanceof SyntaxError
        ? "JSONの構文を確認してください。"
        : toUserError(error, "辞書を読み込めませんでした。");
      if (state.dictionary) {
        elements.dictionaryError.textContent += " 現在の辞書はそのまま使用します。";
      }
      elements.dictionaryFile.setAttribute("aria-invalid", "true");
      elements.dictionarySelectButton.setAttribute("aria-invalid", "true");
    } finally {
      if (token === state.dictionaryLoadToken) {
        state.dictionaryLoading = false;
        setDictionaryLoadingUi(false);
        updateSelectionUi();
      }
    }
  }

  function removeDictionary() {
    if (state.dictionaryLoading || isBusy()) return;
    if (!confirmResultRegeneration("辞書を外すと")) return;
    const restoreFocus = document.activeElement === elements.removeDictionaryButton;
    const resultUpdates = prepareDictionaryResultUpdates(null);
    state.dictionaryLoadToken += 1;
    state.dictionary = null;
    state.dictionaryMatcher = null;
    state.dictionaryFileName = null;
    elements.dictionarySummary.hidden = true;
    elements.dictionaryName.textContent = "";
    elements.dictionaryMeta.textContent = "";
    elements.dictionaryError.textContent = "";
    elements.dictionaryFile.removeAttribute("aria-invalid");
    elements.dictionarySelectButton.removeAttribute("aria-invalid");
    commitDictionaryResultUpdates(resultUpdates, null);
    if (restoreFocus) elements.dictionarySelectButton.focus();
    announce("補正辞書を外しました。");
  }

  function clearDictionaryForHistoryImport() {
    state.dictionaryLoadToken += 1;
    state.dictionary = null;
    state.dictionaryMatcher = null;
    state.dictionaryFileName = null;
    elements.dictionarySummary.hidden = true;
    elements.dictionaryName.textContent = "";
    elements.dictionaryMeta.textContent = "";
    elements.dictionaryError.textContent = "";
    elements.dictionaryFile.removeAttribute("aria-invalid");
    elements.dictionarySelectButton.removeAttribute("aria-invalid");
  }

  function prepareDictionaryResultUpdates(matcher) {
    const updates = [];
    for (const result of state.results) {
      if (typeof result.rawText !== "string") continue;
      const corrected = applyDictionarySafely(result.rawText, matcher);
      updates.push({ result, corrected });
    }
    return updates;
  }

  function commitDictionaryResultUpdates(updates, metadata) {
    state.resultDictionary = metadata;
    for (const { result, corrected } of updates) {
      result.text = corrected.text;
      result.replacements = corrected.replacements;
      result.correctionErrorCode = corrected.errorCode;
    }
    if (state.results.length > 0) {
      state.resultTextEdited = false;
      state.resultTextDirty = true;
      renderResultView({ syncText: true });
    }
    return updates.filter(({ corrected }) => corrected.errorCode).length;
  }

  function confirmResultRegeneration(action) {
    if (!state.resultTextEdited || elements.resultPanel.hidden) return true;
    return root.confirm(
      `認識結果を手で編集しています。${action}、手編集した内容をOCR結果から作り直します。続けますか？`,
    );
  }

  function confirmDocumentReset() {
    if (state.results.length === 0 || elements.resultPanel.hidden) return true;
    if (!state.resultTextDirty) return true;
    if (state.resultTextEdited) {
      return root.confirm(
        "認識結果を手で編集しています。別のPDFへ進むと、手編集した内容と読み取り履歴を破棄します。続けますか？",
      );
    }
    return root.confirm(
      "まだ保存していない読み取り結果があります。別のPDFへ進むと破棄します。続けますか？",
    );
  }

  function getCurrentDictionaryMetadata() {
    return createDictionaryMetadata(state.dictionary, state.dictionaryFileName);
  }

  function createDictionaryMetadata(dictionary, fileName) {
    return dictionary ? Object.freeze({
      name: dictionary.name,
      entries: dictionary.entries.length,
      sourceFile: fileName,
    }) : null;
  }

  function setDictionaryLoadingUi(loading) {
    elements.dictionarySelectButton.textContent = loading ? "読込中…" : "JSONを選択";
    elements.dictionarySelectButton.disabled = loading || state.controlsLocked;
    elements.dictionaryFile.disabled = loading || state.controlsLocked;
    elements.removeDictionaryButton.disabled = loading || state.controlsLocked || !state.dictionary;
  }

  function applyDictionarySafely(text, matcher) {
    const source = String(text ?? "");
    if (!matcher) return { text: source, replacements: 0, errorCode: null };
    try {
      return { ...matcher(source), errorCode: null };
    } catch (error) {
      if (error instanceof core.OcrInputError && error.code === "DICTIONARY_OUTPUT_TOO_LARGE") {
        return { text: source, replacements: 0, errorCode: error.code };
      }
      throw error;
    }
  }

  function captureSettings() {
    if (!state.selection || !state.pdfDocument || !state.previewReady) {
      throw new core.OcrInputError("文字の範囲を囲んでください。", "REGION_REQUIRED");
    }
    const pageSegmentationMode = elements.pageLayout.value;
    const selectedLanguages = elements.ocrLanguage.value.split("+");
    const languageLabel = elements.ocrLanguage.options[
      elements.ocrLanguage.selectedIndex
    ].textContent;
    return Object.freeze({
      variantId: VARIANT.id,
      variantLabel: VARIANT.label,
      pageNumber: state.currentPageNumber,
      region: Object.freeze({ ...state.selection }),
      languages: Object.freeze(selectedLanguages),
      languageLabel,
      requestedScale: Number(elements.renderQuality.value),
      qualityLabel: elements.renderQuality.options[elements.renderQuality.selectedIndex].textContent,
      pageSegmentationMode,
      layoutLabel: elements.pageLayout.options[elements.pageLayout.selectedIndex].textContent,
      compareVariants: elements.enhanceScan.checked,
      autoRotate: elements.autoRotate.checked,
      dictionaryMatcher: state.dictionaryMatcher,
      dictionary: getCurrentDictionaryMetadata(),
    });
  }

  async function startRegionOcr() {
    if (
      !state.compatible
      || isBusy()
      || state.dictionaryLoading
      || !state.pdfDocument
      || !state.selection
    ) return;

    let settings;
    try {
      settings = captureSettings();
    } catch (error) {
      showToast(toUserError(error, "範囲と設定を確認してください。"), "error");
      return;
    }

    const token = ++state.runToken;
    const run = createRunContext(token);
    state.activeRun = run;
    state.mode = "running";
    state.latestProgress = 0;
    const startedAt = performance.now();
    let nextFocus = "retry";

    elements.progressPanel.hidden = false;
    elements.cancelButton.disabled = false;
    elements.cancelButton.hidden = false;
    elements.cancelButton.textContent = "中止";
    setControlsLocked(true);
    setProgress(0, "選択範囲を準備しています", `${settings.pageNumber}ページの四角で囲んだ部分だけを処理します`);
    elements.progressHeading.focus({ preventScroll: true });
    announce("選択範囲の文字認識を開始しました。", true);

    try {
      const result = await processRegion(run, settings, startedAt);
      assertActiveRun(run);
      state.results.push(result);
      state.nextSequence += 1;
      state.totalElapsedMs += result.durationMs;
      state.resultDictionary = settings.dictionary;
      appendResultText(result);
      renderResultView();
      if (result.status === "success") {
        nextFocus = "selection";
        clearSelection({ announce: false });
        showToast(`読み取り${result.sequence}を結果へ追加しました。`, "success");
      } else {
        showToast("文字を検出できませんでした。四角を調整してもう一度試せます。", "warning", 5000);
      }
      announce(
        result.status === "success"
          ? `読み取り${result.sequence}を追加しました。次の範囲を囲んでください。`
          : "選択範囲に文字を検出できませんでした。範囲を調整できます。",
        true,
      );
    } catch (error) {
      if (error instanceof RunCancelledError || run.cancelled || state.activeRun !== run) return;
      const normalized = classifyRegionError(error);
      const failed = createFailedResult(settings, normalized.code, performance.now() - startedAt);
      state.results.push(failed);
      state.nextSequence += 1;
      state.totalElapsedMs += failed.durationMs;
      appendResultText(failed);
      renderResultView();
      showToast(normalized.message, "error", 6000);
      announce("この選択範囲を認識できませんでした。範囲を保ったまま再試行できます。", true);
    } finally {
      if (state.activeRun === run && !run.cancelled) state.activeRun = null;
      if (token === state.runToken && !run.cancelled) {
        state.mode = "ready";
        elements.progressPanel.hidden = true;
        setControlsLocked(false);
        updateSelectionUi();
        focusAfterRun(nextFocus);
      }
    }
  }

  function createRunContext(token) {
    return {
      token,
      cancelled: false,
      abortController: new root.AbortController(),
      workerResources: null,
      renderTask: null,
      pass: "preparing",
    };
  }

  function cancelRunContext(run) {
    if (!run || run.cancelled) return;
    run.cancelled = true;
    run.abortController.abort();
    try {
      run.renderTask?.cancel();
    } catch {
      // The render may have completed immediately before cancellation.
    }
    for (const worker of run.workerResources?.nativeWorkers || []) {
      try {
        worker.terminate();
      } catch {
        // Native worker cleanup is best-effort.
      }
    }
  }

  async function awaitRunOperation(run, operationFactory, timeoutMs, label, failureSource = null) {
    assertActiveRun(run);
    let timeoutId;
    let cancelListener;
    let failureListener;
    const operation = Promise.resolve().then(() => {
      assertActiveRun(run);
      return operationFactory();
    });
    const cancelled = new Promise((_, reject) => {
      cancelListener = () => reject(new RunCancelledError());
      run.abortController.signal.addEventListener("abort", cancelListener, { once: true });
    });
    const timeout = new Promise((_, reject) => {
      timeoutId = root.setTimeout(() => reject(new OperationTimeoutError(label)), timeoutMs);
    });
    const failure = failureSource ? new Promise((_, reject) => {
      if (failureSource.failureError) {
        reject(failureSource.failureError);
        return;
      }
      failureListener = (error) => reject(error);
      failureSource.failureListeners.add(failureListener);
    }) : null;

    try {
      return await Promise.race([
        operation,
        cancelled,
        timeout,
        ...(failure ? [failure] : []),
      ]);
    } finally {
      root.clearTimeout(timeoutId);
      run.abortController.signal.removeEventListener("abort", cancelListener);
      if (failureListener) failureSource.failureListeners.delete(failureListener);
    }
  }

  async function processRegion(run, settings, startedAt) {
    let page = null;
    let fullCanvas = null;
    let originalCanvas = null;
    let rendered = null;
    let cropped = null;
    let deskewInfo = null;
    try {
      setProgress(
        6,
        "PDFを高解像度で画像にしています",
        VARIANT.directRegionRendering
          ? `${settings.pageNumber}ページの選択範囲だけを直接描画します`
          : `${settings.pageNumber}ページをOCR向け解像度で描画します`,
      );
      page = await awaitRunOperation(
        run,
        () => state.pdfDocument.getPage(settings.pageNumber),
        PDF_PAGE_TIMEOUT_MS,
        "PDFページの読み込み",
      );
      assertActiveRun(run);
      if (VARIANT.directRegionRendering) {
        rendered = await renderPdfRegionForOcr(run, page, settings);
        originalCanvas = rendered.canvas;
        cropped = rendered.crop;
      } else {
        rendered = await renderPdfPageForOcr(run, page, settings);
        fullCanvas = rendered.canvas;
        assertActiveRun(run);

        setProgress(22, "四角の内側を切り抜いています", "文字端が欠けないよう白い余白も追加します");
        cropped = cropSelectedRegion(fullCanvas, settings.region);
        originalCanvas = cropped.canvas;
        fullCanvas.width = 1;
        fullCanvas.height = 1;
        fullCanvas = null;
      }

      let actualDpi = Math.max(1, Math.round(rendered.scale * 72));

      if (
        VARIANT.autoDeskew
      ) {
        setProgress(24, "文字の傾きを調べています", "小さな傾きが見つかった場合だけ補正します");
        const deskewed = tryDeskewCanvas(originalCanvas);
        deskewInfo = deskewed.info;
        if (deskewed.canvas) {
          const previousCanvas = originalCanvas;
          originalCanvas = deskewed.canvas;
          previousCanvas.width = 1;
          previousCanvas.height = 1;
          actualDpi = Math.max(
            1,
            Math.round(actualDpi * (Number(deskewInfo?.outputScale) || 1)),
          );
        }
      }

      const recognitionSettings = {
        ...settings,
        actualDpi,
      };

      const preprocessors = settings.compareVariants
        ? [...new Set(VARIANT.preprocessors || ["original", "contrast"])]
        : ["original"];
      const pageSegmentationModes = getPageSegmentationCandidates(
        settings.pageSegmentationMode,
        settings.compareVariants ? VARIANT.psmEnsembleSize : 1,
      );
      const passCount = preprocessors.length * pageSegmentationModes.length;
      const candidates = [];
      let lastRecognitionError = null;
      let passIndex = 0;
      let failedPassCount = 0;

      for (const preprocessor of preprocessors) {
        assertActiveRun(run);
        let candidateCanvas = originalCanvas;
        if (preprocessor === "contrast") {
          setProgress(null, "コントラスト補正版を準備しています", "薄い文字向けの候補を作ります");
          try {
            enhanceCanvas(originalCanvas);
          } catch (error) {
            lastRecognitionError = error;
            passIndex += pageSegmentationModes.length;
            failedPassCount += pageSegmentationModes.length;
            continue;
          }
        }

        for (const pageSegmentationMode of pageSegmentationModes) {
          passIndex += 1;
          const pass = createRecognitionPass(
            preprocessor,
            pageSegmentationMode,
            passIndex,
            passCount,
            deskewInfo?.applied === true,
          );
          run.pass = pass.id;
          run.passLabel = pass.label;
          run.passIndex = passIndex;
          run.passCount = passCount;
          setProgress(
            26 + ((passIndex - 1) / Math.max(1, passCount)) * 66,
            `${pass.label}を認識しています`,
            `${passIndex}/${passCount}条件を処理しています`,
          );
          try {
            const recognition = await recognizeWithRecovery(
              run,
              candidateCanvas,
              {
                ...recognitionSettings,
                pageSegmentationMode,
                thresholdingMethod: pass.thresholdingMethod,
              },
            );
            candidates.push(toOcrCandidate(recognition, pass.id, pass));
          } catch (error) {
            if (error instanceof RunCancelledError || run.cancelled) throw error;
            lastRecognitionError = error;
            failedPassCount += 1;
          }
        }
      }

      if (candidates.length === 0) {
        throw lastRecognitionError || new Error("OCR_ALL_PASSES_FAILED");
      }

      assertActiveRun(run);
      setProgress(96, `${candidates.length}候補を比較しています`, "候補間の一致度と信頼度を評価します");
      const selected = selectBestOcrCandidate(candidates);
      const rawText = String(selected.text ?? "");
      const corrected = applyDictionarySafely(rawText, settings.dictionaryMatcher);
      const status = rawText.trim() ? "success" : "warning";
      const sequence = state.nextSequence;
      setProgress(100, "結果へ追加しています", `読み取り${sequence}をまとめています`);
      return {
        sequence,
        pageNumber: settings.pageNumber,
        region: Object.freeze({ ...settings.region }),
        status,
        text: corrected.text,
        rawText,
        confidence: Number.isFinite(selected.confidence) ? Math.round(selected.confidence) : null,
        variant: selected.variant,
        selectedPassLabel: selected.label || selected.variant,
        comparisonScore: selected.comparisonScore,
        agreement: Number.isFinite(selected.agreement) ? selected.agreement : null,
        consensusApplied: selected.consensusApplied === true,
        disagreementCount: Number.isInteger(selected.disagreementCount)
          ? selected.disagreementCount
          : null,
        candidateCount: candidates.length,
        plannedPassCount: passCount,
        attemptedPassCount: passIndex,
        successfulCandidateCount: candidates.length,
        failedPassCount,
        candidates: Object.freeze(candidates.map((candidate) => Object.freeze({
          variant: candidate.variant,
          label: candidate.label,
          text: candidate.text,
          confidence: candidate.confidence,
          preprocessor: candidate.preprocessor,
          pageSegmentationMode: candidate.pageSegmentationMode,
          thresholdingMethod: candidate.thresholdingMethod,
        }))),
        replacements: corrected.replacements,
        correctionErrorCode: corrected.errorCode,
        errorCode: null,
        renderScale: rendered.scale,
        renderMode: VARIANT.directRegionRendering ? "direct-region" : "full-page-then-crop",
        deskew: deskewInfo,
        actualDpi,
        cropPixels: Object.freeze({
          x: cropped.source.x,
          y: cropped.source.y,
          width: cropped.source.width,
          height: cropped.source.height,
          padding: cropped.padding,
          sourceMargin: cropped.effectiveMargins || null,
        }),
        settings: snapshotResultSettings(settings),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    } finally {
      for (const canvas of [fullCanvas, originalCanvas]) {
        if (!canvas) continue;
        canvas.width = 1;
        canvas.height = 1;
      }
      try {
        page?.cleanup();
      } catch {
        // PDF page cleanup is best-effort.
      }
    }
  }

  function expandRegionForSource(region, unitViewport) {
    const marginPoints = Math.max(0, Number(VARIANT.sourceMarginPoints) || 0);
    if (marginPoints === 0) return Object.freeze({ ...region });
    const marginX = marginPoints / unitViewport.width;
    const marginY = marginPoints / unitViewport.height;
    return core.normalizeRegion(
      Number(region.x) - marginX,
      Number(region.y) - marginY,
      Number(region.x) + Number(region.width) + marginX,
      Number(region.y) + Number(region.height) + marginY,
    );
  }

  async function renderPdfRegionForOcr(run, page, settings) {
    const unitViewport = page.getViewport({ scale: 1 });
    const expandedRegion = expandRegionForSource(settings.region, unitViewport);
    const regionUnitWidth = Math.max(1, unitViewport.width * expandedRegion.width);
    const regionUnitHeight = Math.max(1, unitViewport.height * expandedRegion.height);
    const firstScale = core.calculateRenderScale(
      regionUnitWidth,
      regionUnitHeight,
      settings.requestedScale,
      OCR_MAX_PIXELS,
      OCR_MAX_DIMENSION,
    );
    const reducedScale = Math.floor(firstScale * 0.75 * 1000) / 1000;
    const fallbackScale = Math.max(
      Number.MIN_VALUE,
      Math.min(firstScale, reducedScale > 0 ? reducedScale : firstScale * 0.75),
    );
    const scales = [...new Set([firstScale, fallbackScale])];
    let lastError = null;

    for (let attempt = 0; attempt < scales.length; attempt += 1) {
      const scale = scales[attempt];
      let canvas = null;
      let renderTask = null;
      try {
        assertActiveRun(run);
        const viewport = page.getViewport({ scale });
        const pagePixelWidth = Math.max(1, Math.ceil(viewport.width));
        const pagePixelHeight = Math.max(1, Math.ceil(viewport.height));
        const sourceMarginPixels = Math.max(
          0,
          Math.round((Number(VARIANT.sourceMarginPoints) || 0) * scale),
        );
        const roiPlan = accuracy.calculateExpandedRoi(
          settings.region,
          pagePixelWidth,
          pagePixelHeight,
          { marginPixels: sourceMarginPixels },
        );
        const left = roiPlan.expanded.x;
        const top = roiPlan.expanded.y;
        const contentWidth = roiPlan.expanded.width;
        const contentHeight = roiPlan.expanded.height;
        const padding = Math.max(16, Math.min(64, Math.round(scale * 4)));
        canvas = document.createElement("canvas");
        canvas.width = contentWidth + padding * 2;
        canvas.height = contentHeight + padding * 2;
        const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: [1, 0, 0, 1, padding - left, padding - top],
          background: "rgb(255,255,255)",
        });
        run.renderTask = renderTask;
        try {
          await awaitRunOperation(
            run,
            () => renderTask.promise,
            PDF_RENDER_TIMEOUT_MS,
            "PDF選択範囲の画像化",
          );
        } finally {
          if (run.renderTask === renderTask) run.renderTask = null;
        }
        return {
          canvas,
          scale,
          crop: {
            source: Object.freeze({ x: left, y: top, width: contentWidth, height: contentHeight }),
            padding,
            expandedRegion: roiPlan.normalized,
            selection: roiPlan.selection,
            effectiveMargins: roiPlan.effectiveMargins,
          },
        };
      } catch (error) {
        try {
          renderTask?.cancel();
        } catch {
          // The render may have settled immediately before cancellation.
        }
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
        }
        if (run.cancelled || state.activeRun !== run || state.mode !== "running") {
          throw new RunCancelledError();
        }
        lastError = error;
        if (attempt === 0) {
          setProgress(8, "解像度を調整して再試行しています", "選択範囲を一段階低い解像度で描画します");
        }
      }
    }
    throw lastError || new Error("PDF_REGION_RENDER_FAILED");
  }

  async function renderPdfPageForOcr(run, page, settings) {
    const unitViewport = page.getViewport({ scale: 1 });
    const firstScale = core.calculateRenderScale(
      unitViewport.width,
      unitViewport.height,
      settings.requestedScale,
      OCR_MAX_PIXELS,
      OCR_MAX_DIMENSION,
    );
    const reducedScale = Math.floor(firstScale * 0.75 * 1000) / 1000;
    const fallbackScale = Math.max(
      Number.MIN_VALUE,
      Math.min(firstScale, reducedScale > 0 ? reducedScale : firstScale * 0.75),
    );
    const scales = [...new Set([firstScale, fallbackScale])];
    let lastError = null;

    for (let attempt = 0; attempt < scales.length; attempt += 1) {
      const scale = scales[attempt];
      let canvas = null;
      let renderTask = null;
      try {
        assertActiveRun(run);
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({
          canvasContext: context,
          viewport,
          background: "rgb(255,255,255)",
        });
        run.renderTask = renderTask;
        try {
          await awaitRunOperation(
            run,
            () => renderTask.promise,
            PDF_RENDER_TIMEOUT_MS,
            "PDFページの画像化",
          );
        } finally {
          if (run.renderTask === renderTask) run.renderTask = null;
        }
        return { canvas, scale };
      } catch (error) {
        try {
          renderTask?.cancel();
        } catch {
          // A timed-out render may already have settled.
        }
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
        }
        if (run.cancelled || state.activeRun !== run || state.mode !== "running") {
          throw new RunCancelledError();
        }
        lastError = error;
        if (attempt === 0) {
          setProgress(8, "解像度を調整して再試行しています", "メモリに収まる解像度へ一段階下げます");
        }
      }
    }
    throw lastError || new Error("PDF_RENDER_FAILED");
  }

  function cropSelectedRegion(sourceCanvas, region) {
    const source = core.regionToPixels(region, sourceCanvas.width, sourceCanvas.height);
    const padding = Math.max(
      16,
      Math.min(32, Math.round(Math.min(source.width, source.height) * 0.02)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = source.width + padding * 2;
    canvas.height = source.height + padding * 2;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      sourceCanvas,
      source.x,
      source.y,
      source.width,
      source.height,
      padding,
      padding,
      source.width,
      source.height,
    );
    return { canvas, source, padding };
  }

  function tryDeskewCanvas(sourceCanvas) {
    if (!accuracy?.estimateDeskewAngle || Math.min(sourceCanvas.width, sourceCanvas.height) < 48) {
      return { canvas: null, info: null };
    }
    let analysisCanvas = null;
    try {
      const maxAnalysisPixels = 1_200_000;
      const maxAnalysisDimension = 1800;
      const scale = Math.min(
        1,
        Math.sqrt(maxAnalysisPixels / (sourceCanvas.width * sourceCanvas.height)),
        maxAnalysisDimension / Math.max(sourceCanvas.width, sourceCanvas.height),
      );
      analysisCanvas = document.createElement("canvas");
      analysisCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
      analysisCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
      const context = analysisCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, analysisCanvas.width, analysisCanvas.height);
      context.imageSmoothingEnabled = true;
      context.drawImage(sourceCanvas, 0, 0, analysisCanvas.width, analysisCanvas.height);
      const grayscale = accuracy.readCanvasGrayscale(analysisCanvas);
      const estimate = accuracy.estimateDeskewAngle(
        grayscale.data,
        grayscale.width,
        grayscale.height,
        {
          minimumAngle: -4,
          maximumAngle: 4,
          coarseStep: 0.5,
          fineStep: 0.1,
          maxSamples: 120_000,
        },
      );
      const apply = Math.abs(estimate.correctionAngle) >= 0.15
        && estimate.confidence >= 0.02;
      const naturalBounds = accuracy.calculateRotatedBounds(
        sourceCanvas.width,
        sourceCanvas.height,
        estimate.correctionAngle,
      );
      const outputScale = Math.min(
        1,
        Math.sqrt(OCR_MAX_PIXELS / (naturalBounds.width * naturalBounds.height)),
        OCR_MAX_DIMENSION / naturalBounds.width,
        OCR_MAX_DIMENSION / naturalBounds.height,
      );
      const info = Object.freeze({
        angle: estimate.angle,
        correctionAngle: estimate.correctionAngle,
        confidence: Math.round(estimate.confidence * 10_000) / 10_000,
        applied: apply,
        outputScale: apply ? outputScale : 1,
      });
      if (!apply) return { canvas: null, info };
      const canvas = accuracy.rotateCanvas(sourceCanvas, estimate.correctionAngle, {
        canvasFactory: () => document.createElement("canvas"),
        background: "#ffffff",
        imageSmoothingEnabled: true,
        maximumPixels: OCR_MAX_PIXELS,
        maximumDimension: OCR_MAX_DIMENSION,
      });
      return { canvas, info };
    } catch {
      return { canvas: null, info: null };
    } finally {
      if (analysisCanvas) {
        analysisCanvas.width = 1;
        analysisCanvas.height = 1;
      }
    }
  }

  function enhanceCanvas(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    accuracy.enhanceRgbaPercentilesInPlace(
      image.data,
      canvas.width,
      canvas.height,
    );
    context.putImageData(image, 0, 0);
  }

  function getPageSegmentationCandidates(selectedMode, requestedSize) {
    const candidatesByMode = {
      3: ["3", "6", "11"],
      6: ["6", "3", "11"],
      7: ["7", "13", "6"],
      11: ["11", "3", "6"],
    };
    const candidates = candidatesByMode[selectedMode] || [String(selectedMode)];
    const size = Math.max(1, Math.min(3, Math.round(Number(requestedSize) || 1)));
    return candidates.slice(0, size);
  }

  function selectBestOcrCandidate(candidates) {
    if (VARIANT.id === "light" || candidates.length < 2 || !accuracy?.buildCandidateConsensus) {
      return core.selectOcrCandidate(candidates);
    }
    const requiresSampling = candidates.some(
      (candidate) => [...String(candidate.text ?? "")].length > CONSENSUS_TEXT_SAMPLE_CHARS,
    );
    const comparisonCandidates = requiresSampling
      ? candidates.map((candidate) => ({
        ...candidate,
        text: accuracy.sampleTextForAgreement(candidate.text, CONSENSUS_TEXT_SAMPLE_CHARS),
      }))
      : candidates;
    const consensus = accuracy.buildCandidateConsensus(comparisonCandidates, {
      agreementWeight: 0.85,
      confidenceWeight: 0.15,
      minimumVoteRatio: 0.5,
    });
    const selected = candidates[consensus.selectedIndex];
    const selectedEvaluation = consensus.evaluations.find(
      (evaluation) => evaluation.index === consensus.selectedIndex,
    );
    const hasComparableCandidates = consensus.activeCandidateCount >= 2;
    const useConsensus = VARIANT.characterConsensus
      && !requiresSampling
      && hasComparableCandidates
      && consensus.agreement >= 0.55
      && String(consensus.consensusText).trim();
    return Object.freeze({
      ...selected,
      text: useConsensus ? consensus.consensusText : selected.text,
      agreement: hasComparableCandidates ? consensus.agreement : null,
      comparisonScore: selectedEvaluation
        ? Math.round(selectedEvaluation.score * 100_000) / 1000
        : null,
      consensusApplied: Boolean(useConsensus),
      disagreementCount: hasComparableCandidates ? consensus.disagreements.length : null,
    });
  }

  function createRecognitionPass(
    preprocessor,
    pageSegmentationMode,
    index,
    count,
    deskewApplied = false,
  ) {
    const definitions = {
      original: { label: "原画像", thresholdingMethod: "0" },
      contrast: { label: "コントラスト補正版", thresholdingMethod: "0" },
      otsu: { label: "Adaptive Otsu版", thresholdingMethod: "1" },
      sauvola: { label: "Sauvola版", thresholdingMethod: "2" },
    };
    const definition = definitions[preprocessor] || definitions.original;
    return Object.freeze({
      id: `${preprocessor}-psm${pageSegmentationMode}`,
      label: `${definition.label}${deskewApplied ? "・傾き補正" : ""}（PSM ${pageSegmentationMode}）`,
      preprocessor,
      pageSegmentationMode,
      thresholdingMethod: definition.thresholdingMethod,
      index,
      count,
    });
  }

  function toOcrCandidate(recognition, variant, pass = null) {
    const reportedConfidence = Number(recognition.data?.confidence);
    return {
      text: String(recognition.data?.text ?? ""),
      confidence: Number.isFinite(reportedConfidence)
        ? Math.max(0, Math.min(100, reportedConfidence))
        : 0,
      variant,
      label: pass?.label || variant,
      preprocessor: pass?.preprocessor || variant,
      pageSegmentationMode: pass?.pageSegmentationMode || null,
      thresholdingMethod: pass?.thresholdingMethod || null,
    };
  }

  function snapshotResultSettings(settings) {
    return Object.freeze({
      variantId: settings.variantId,
      variantLabel: settings.variantLabel,
      modelVariant: VARIANT.modelVariant,
      languages: Object.freeze([...settings.languages]),
      languageLabel: settings.languageLabel,
      qualityLabel: settings.qualityLabel,
      requestedScale: settings.requestedScale,
      layout: settings.layoutLabel,
      pageSegmentationMode: settings.pageSegmentationMode,
      compareVariants: settings.compareVariants,
      autoRotate: settings.autoRotate,
    });
  }

  function createFailedResult(settings, errorCode, durationMs) {
    return {
      sequence: state.nextSequence,
      pageNumber: settings.pageNumber,
      region: Object.freeze({ ...settings.region }),
      status: "failed",
      text: "",
      rawText: "",
      confidence: null,
      variant: null,
      selectedPassLabel: null,
      comparisonScore: null,
      agreement: null,
      consensusApplied: false,
      disagreementCount: null,
      candidateCount: 0,
      plannedPassCount: 0,
      attemptedPassCount: 0,
      successfulCandidateCount: 0,
      failedPassCount: 0,
      candidates: Object.freeze([]),
      replacements: 0,
      correctionErrorCode: null,
      errorCode,
      renderScale: null,
      actualDpi: null,
      cropPixels: null,
      deskew: null,
      settings: snapshotResultSettings(settings),
      durationMs: Math.max(0, Math.round(durationMs)),
    };
  }

  async function acquireOcrWorker(run, settings) {
    const languageKey = settings.languages.join("+");
    const current = state.ocrSession;
    if (
      current
      && current.languageKey === languageKey
      && !current.resources.disposed
      && current.worker
    ) {
      run.workerResources = current.resources;
      return current.worker;
    }
    if (current) await disposeOcrWorker(null, current.resources);
    assertActiveRun(run);
    const worker = await createOcrWorker(run, settings);
    assertActiveRun(run);
    state.ocrSession = {
      languageKey,
      resources: run.workerResources,
      worker,
    };
    return worker;
  }

  async function createOcrWorker(run, settings) {
    assertActiveRun(run);
    const assets = root.ScanScribeAssets;
    const workerGuard = `
      (function enforceOfflineWorkerScope(scope) {
        "use strict";
        const blocked = () => {
          throw new DOMException("Network and dynamic script access are disabled.", "SecurityError");
        };
        scope.fetch = () => Promise.reject(
          new TypeError("Network access is disabled."),
        );
        if (scope.XMLHttpRequest && scope.XMLHttpRequest.prototype) {
          scope.XMLHttpRequest.prototype.open = blocked;
        }
        scope.importScripts = blocked;
        for (const name of [
          "WebSocket",
          "EventSource",
          "WebTransport",
          "Worker",
          "SharedWorker",
        ]) {
          if (name in scope) scope[name] = blocked;
        }
      })(self);
    `;

    const workerBlob = new Blob(
      [
        workerGuard,
        "\n",
        assets.tesseractCoreSource,
        "\n",
        assets.tesseractWorkerSource,
      ],
      { type: "application/javascript" },
    );
    const workerUrl = URL.createObjectURL(workerBlob);
    let failureReported = false;
    const resources = {
      url: workerUrl,
      nativeWorkers: new Set(),
      apiWorker: null,
      promise: null,
      failureError: null,
      failureListeners: new Set(),
      terminatedApiWorkers: new WeakSet(),
      disposed: false,
    };
    run.workerResources = resources;

    const reportFailure = (failure) => {
      if (failureReported || resources.disposed) return;
      failureReported = true;
      const detail = failure?.error || failure?.message || failure;
      resources.failureError = detail instanceof Error
        ? detail
        : new Error(String(detail || "OCR worker failed."));
      for (const listener of resources.failureListeners) listener(resources.failureError);
      resources.failureListeners.clear();
    };

    const languages = settings.languages.map((code) => ({
      code,
      data: core.base64ToBytes(assets.models[code]),
    }));

    let captured;
    try {
      captured = root.ScanScribeNetworkGuard.captureWorkers(() => (
        root.Tesseract.createWorker(
          languages,
          root.Tesseract.OEM.LSTM_ONLY,
          {
            workerPath: workerUrl,
            corePath: "inline-core.js",
            workerBlobURL: false,
            cacheMethod: "none",
            gzip: true,
            logger: (message) => {
              const activeRun = state.activeRun;
              if (activeRun?.workerResources === resources) {
                handleOcrProgress(activeRun, message);
              }
            },
            errorHandler: reportFailure,
          },
        )
      ));
      resources.nativeWorkers = captured.workers;
      for (const nativeWorker of resources.nativeWorkers) {
        nativeWorker.addEventListener?.("error", reportFailure);
        nativeWorker.addEventListener?.("messageerror", reportFailure);
      }
      resources.promise = Promise.resolve(captured.value);
      resources.promise.then(
        (worker) => {
          if (resources.disposed) {
            void terminateApiWorkerOnce(resources, worker);
          } else {
            resources.apiWorker = worker;
          }
        },
        () => {},
      );
    } catch (error) {
      await disposeOcrWorker(run, resources);
      throw error;
    }

    try {
      const worker = await awaitRunOperation(
        run,
        () => resources.promise,
        OCR_STARTUP_TIMEOUT_MS,
        "OCRエンジンの起動",
        resources,
      );
      assertActiveRun(run);
      if (run.workerResources !== resources || resources.disposed) throw new RunCancelledError();
      resources.apiWorker = worker;
      return worker;
    } catch (error) {
      await disposeOcrWorker(run, resources);
      throw error;
    }
  }

  async function configureOcrWorker(run, worker, settings) {
    const resources = run.workerResources;
    const parameters = {
      tessedit_pageseg_mode: settings.pageSegmentationMode,
      preserve_interword_spaces: "1",
      user_defined_dpi: String(settings.actualDpi),
    };
    if (settings.thresholdingMethod !== undefined) {
      parameters.thresholding_method = String(settings.thresholdingMethod);
    }
    await awaitRunOperation(
      run,
      () => worker.setParameters(parameters),
      OCR_CONFIG_TIMEOUT_MS,
      "OCR設定",
      resources,
    );
  }

  function handleOcrProgress(run, message) {
    if (state.activeRun !== run || run.cancelled || state.mode !== "running") return;
    const status = String(message?.status ?? "").toLowerCase();
    const stage = core.mapOcrStatus(status);
    if (status !== "recognizing text") {
      setProgress(null, stage, "同梱したOCRエンジンとモデルだけを使っています");
      return;
    }
    const pageProgress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    const passCount = Math.max(1, Number(run.passCount) || 1);
    const passIndex = Math.max(1, Number(run.passIndex) || 1);
    const passSpan = 66 / passCount;
    const start = 26 + (passIndex - 1) * passSpan;
    const end = start + passSpan;
    setProgress(
      start + pageProgress * (end - start),
      `${run.passLabel || "選択範囲"}を認識しています`,
      `${passIndex}/${passCount}条件を処理しています`,
    );
  }

  async function recognizeWithRecovery(run, canvas, settings) {
    const recognize = async () => {
      const worker = await acquireOcrWorker(run, settings);
      await configureOcrWorker(run, worker, settings);
      const resources = run.workerResources;
      return awaitRunOperation(
        run,
        () => worker.recognize(canvas, { rotateAuto: settings.autoRotate }),
        OCR_RECOGNITION_TIMEOUT_MS,
        "文字認識",
        resources,
      );
    };

    try {
      return await recognize();
    } catch (firstError) {
      assertActiveRun(run);
      setProgress(null, "OCRエンジンを再準備しています", "一度だけ自動で復旧を試みます");
      await disposeOcrWorker(run);
      assertActiveRun(run);
      try {
        return await recognize();
      } catch (secondError) {
        await disposeOcrWorker(run);
        if (secondError instanceof Error && secondError.cause === undefined) {
          try {
            secondError.cause = firstError;
          } catch {
            // Error.cause may be read-only in older browsers.
          }
        }
        throw secondError;
      }
    }
  }

  async function cancelOcrRun() {
    const run = state.activeRun;
    if (state.mode !== "running" || !run) return;
    state.mode = "cancelling";
    const expectedToken = state.runToken + 1;
    state.runToken = expectedToken;
    cancelRunContext(run);
    elements.cancelButton.disabled = true;
    elements.cancelButton.textContent = "中止中…";
    setProgress(null, "現在の範囲を中止しています", "追加済みの読み取り結果は残します");
    announce("現在の選択範囲の文字認識を中止しています。", true);

    await disposeOcrWorker(run);
    if (
      state.activeRun !== run
      || state.mode !== "cancelling"
      || state.runToken !== expectedToken
    ) return;

    state.activeRun = null;
    state.mode = "ready";
    elements.progressPanel.hidden = true;
    setControlsLocked(false);
    updateSelectionUi();
    focusAfterRun("retry");
    announce("現在の範囲の処理を中止しました。選択範囲は残しています。", true);
  }

  function terminateApiWorkerOnce(resources, worker) {
    if (!worker || resources.terminatedApiWorkers.has(worker)) return Promise.resolve();
    resources.terminatedApiWorkers.add(worker);
    return Promise.resolve()
      .then(() => worker.terminate())
      .catch(() => {});
  }

  async function disposeOcrWorker(run, selectedResources = run?.workerResources) {
    const resources = selectedResources;
    if (!resources || resources.disposed) return;
    resources.disposed = true;
    if (run?.workerResources === resources) run.workerResources = null;
    if (state.ocrSession?.resources === resources) state.ocrSession = null;

    const worker = resources.apiWorker;
    resources.apiWorker = null;
    resources.promise?.then(
      (lateWorker) => {
        if (lateWorker !== worker) void terminateApiWorkerOnce(resources, lateWorker);
      },
      () => {},
    );

    for (const nativeWorker of resources.nativeWorkers) {
      try {
        nativeWorker.terminate();
      } catch {
        // Native worker cleanup is best-effort.
      }
    }

    let timeoutId;
    try {
      const termination = worker
        ? terminateApiWorkerOnce(resources, worker)
        : Promise.resolve();
      const timeout = new Promise((resolve) => {
        timeoutId = root.setTimeout(resolve, WORKER_TERMINATION_TIMEOUT_MS);
      });
      await Promise.race([termination, timeout]);
    } catch {
      // Worker cleanup is best-effort; run identity rejects late callbacks.
    } finally {
      root.clearTimeout(timeoutId);
      URL.revokeObjectURL(resources.url);
    }
  }

  function assertActiveRun(run) {
    if (
      !run
      || run.cancelled
      || state.activeRun !== run
      || run.token !== state.runToken
      || state.mode !== "running"
    ) {
      throw new RunCancelledError();
    }
  }

  function appendResultText(result) {
    if (result.status === "success" && String(result.text).trim()) {
      const block = core.buildTextOutput([result]);
      if (state.resultTextEdited) {
        const current = elements.resultText.value;
        const separator = current && !current.endsWith("\n\n") ? "\n\n" : "";
        elements.resultText.value = `${current}${separator}${block}`;
      } else {
        elements.resultText.value = buildSuccessfulTextOutput();
      }
    }
    state.resultTextDirty = true;
    updateCharacterCount();
  }

  function buildSuccessfulTextOutput() {
    return core.buildTextOutput(
      state.results.filter(
        (result) => result.status === "success" && String(result.text ?? "").trim(),
      ),
    );
  }

  function renderResultView(options = {}) {
    const results = state.results;
    if (options.syncText) {
      elements.resultText.value = buildSuccessfulTextOutput();
      updateCharacterCount();
    }
    const successful = results.filter((result) => result.status === "success").length;
    const warnings = results.filter((result) => result.status === "warning").length;
    const failures = results.filter((result) => result.status === "failed").length;
    const correctionWarnings = results.filter((result) => result.correctionErrorCode).length;

    elements.resultHeading.textContent = results.length === 1
      ? "最初の読み取り結果を追加しました"
      : `${results.length}件の読み取り結果があります`;
    const badge = elements.resultStatusBadge;
    badge.className = "badge";
    badge.classList.add(failures || warnings || correctionWarnings ? "badge--warning" : "badge--safe");
    badge.textContent = failures || warnings || correctionWarnings
      ? `${results.length}件（要確認）`
      : `${results.length}件`;

    const statCards = [
      createStatCard(String(successful), "文字あり"),
      createStatCard(elements.resultText.value.length.toLocaleString("ja-JP"), "出力文字数", "output-length"),
      createStatCard(core.formatDuration(state.totalElapsedMs), "合計処理時間"),
    ];
    if (warnings + failures > 0) {
      statCards.push(createStatCard(String(warnings + failures), "要再確認"));
    }
    elements.resultStats.replaceChildren(...statCards);

    elements.pageResultList.replaceChildren();
    for (const result of results) {
      const row = document.createElement("div");
      row.className = "page-result-row";
      const title = document.createElement("strong");
      title.textContent = `読み取り${result.sequence} ・ ${result.pageNumber}ページ`;
      const meta = document.createElement("span");
      if (result.status === "success") {
        const variant = `${result.selectedPassLabel || result.variant || "候補"}を採用`;
        const passSummary = Number.isInteger(result.plannedPassCount)
          && result.plannedPassCount > 0
          && result.candidateCount < result.plannedPassCount
          ? ` ・ ${result.candidateCount}/${result.plannedPassCount}条件成功`
          : "";
        meta.textContent = `${result.text.trim().length.toLocaleString("ja-JP")}文字${(
          result.confidence === null ? "" : ` ・ 信頼度 ${result.confidence}%`
        )}${result.agreement === null ? "" : ` ・ 候補一致度 ${Math.round(result.agreement * 100)}%`} ・ ${(
          result.actualDpi || "—"
        )}dpi ・ ${variant}${(
          result.replacements ? ` ・ ${result.replacements}件補正` : ""
        )}${result.correctionErrorCode ? " ・ 辞書補正を省略" : ""}${passSummary}`;
      } else if (result.status === "warning") {
        meta.textContent = `文字を検出できませんでした ・ ${result.actualDpi || "—"}dpi`;
      } else {
        meta.textContent = `認識失敗 ・ ${result.errorCode || "OCR_ERROR"}`;
      }
      row.append(title, meta);
      elements.pageResultList.append(row);
    }
    updatePageResultCounts();

    elements.resultPanel.hidden = false;
    elements.resultPanel.dataset.outcome = failures ? "partial" : warnings ? "warning" : "success";
    elements.copyButton.disabled = !elements.resultText.value;
    elements.downloadTextButton.disabled = !elements.resultText.value;
    elements.downloadJsonButton.disabled = results.length === 0;
    updateOutputLengthStat();
  }

  function updatePageResultCounts() {
    const counts = new Map();
    for (const result of state.results) {
      counts.set(result.pageNumber, (counts.get(result.pageNumber) || 0) + 1);
    }
    for (const option of elements.pageSelect.options) {
      const pageNumber = Number(option.value);
      const count = counts.get(pageNumber) || 0;
      option.textContent = count ? `${pageNumber}（${count}件）` : String(pageNumber);
    }
  }

  function focusAfterRun(target) {
    root.requestAnimationFrame(() => {
      const element = target === "selection" ? elements.settingsHeading : elements.startButton;
      element.focus({ preventScroll: false });
    });
  }

  function createStatCard(value, label, key = "") {
    const card = document.createElement("div");
    card.className = "stat-card";
    if (key) card.dataset.stat = key;
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    return card;
  }

  function updateCharacterCount() {
    elements.characterCount.textContent =
      `${elements.resultText.value.length.toLocaleString("ja-JP")}文字`;
  }

  function updateOutputLengthStat() {
    const value = elements.resultStats.querySelector('[data-stat="output-length"] strong');
    if (value) value.textContent = elements.resultText.value.length.toLocaleString("ja-JP");
  }

  async function copyResult() {
    const text = elements.resultText.value;
    if (!text) return;

    if (root.navigator.clipboard?.writeText) {
      try {
        await root.navigator.clipboard.writeText(text);
        showToast("認識結果をコピーしました。", "success");
        return;
      } catch {
        // file:// may expose Clipboard API but reject it; try the legacy local fallback.
      }
    }

    elements.resultText.focus();
    elements.resultText.select();
    try {
      if (!document.execCommand("copy")) throw new Error("COPY_FAILED");
      showToast("認識結果をコピーしました。", "success");
    } catch {
      showToast(
        "自動コピーできませんでした。選択中の文字を⌘CまたはCtrl+Cでコピーしてください。",
        "warning",
        5600,
      );
    }
  }

  function downloadTextResult() {
    const text = elements.resultText.value;
    if (!state.file || !text) return;
    downloadBlob(
      new Blob(["\ufeff", text], { type: "text/plain;charset=utf-8" }),
      `${core.sanitizeBaseName(state.file.name)}_ocr.txt`,
    );
    state.resultTextDirty = false;
  }

  function downloadJsonResult() {
    if (!state.file || state.results.length === 0) return;
    const payload = {
      format: "scanscribe-region-ocr-result",
      version: 3,
      applicationVariant: {
        id: VARIANT.id,
        label: VARIANT.label,
        modelVariant: VARIANT.modelVariant,
      },
      createdAt: new Date().toISOString(),
      offline: true,
      coordinateSystem: "normalized-top-left",
      combinedText: elements.resultText.value,
      combinedTextEdited: state.resultTextEdited,
      source: {
        name: state.file.name,
        bytes: state.file.size,
        totalPages: state.pdfDocument?.numPages ?? null,
      },
      dictionary: state.resultDictionary,
      results: state.results.map((result) => ({
        sequence: result.sequence,
        page: result.pageNumber,
        region: result.region,
        status: result.status,
        text: result.text,
        rawText: result.rawText,
        confidence: result.confidence,
        selectedVariant: result.variant,
        selectedPassLabel: result.selectedPassLabel,
        comparedCandidates: result.candidateCount,
        plannedPassCount: result.plannedPassCount,
        attemptedPassCount: result.attemptedPassCount,
        successfulCandidateCount: result.successfulCandidateCount,
        failedPassCount: result.failedPassCount,
        agreement: result.agreement,
        consensusApplied: result.consensusApplied,
        disagreementCount: result.disagreementCount,
        candidates: result.candidates,
        actualDpi: result.actualDpi,
        renderScale: result.renderScale,
        renderMode: result.renderMode,
        cropPixels: result.cropPixels,
        deskew: result.deskew,
        replacements: result.replacements,
        correctionErrorCode: result.correctionErrorCode,
        errorCode: result.errorCode,
        durationMs: result.durationMs,
        settings: result.settings,
      })),
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
      `${core.sanitizeBaseName(state.file.name)}_ocr.json`,
    );
    state.resultTextDirty = false;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setControlsLocked(locked) {
    state.controlsLocked = locked;
    const controls = [
      elements.pdfFile,
      elements.pdfSelectButton,
      elements.sampleButton,
      elements.historyFile,
      elements.historySelectButton,
      elements.newDocumentButton,
      elements.pageSelect,
      elements.previousPageButton,
      elements.nextPageButton,
      elements.ocrLanguage,
      elements.renderQuality,
      elements.pageLayout,
      elements.enhanceScan,
      elements.autoRotate,
      elements.dictionaryFile,
      elements.dictionarySelectButton,
      elements.removeDictionaryButton,
      elements.selectFullPageButton,
      elements.clearSelectionButton,
    ];
    for (const control of controls) control.disabled = locked;
    elements.removeFileButton.disabled = locked && state.mode !== "loadingPdf";
    if (!locked) {
      setHistoryLoadingUi(state.historyLoading);
      setDictionaryLoadingUi(state.dictionaryLoading);
    }
    updatePageControls();
    updateSelectionUi();
  }

  function setProgress(value, stage, detail) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      state.latestProgress = Math.max(state.latestProgress, Math.max(0, Math.min(100, numeric)));
      elements.overallProgress.value = state.latestProgress;
      elements.overallProgress.removeAttribute("data-indeterminate");
      elements.progressPercent.textContent = `${Math.round(state.latestProgress)}%`;
    } else {
      elements.overallProgress.removeAttribute("value");
      elements.overallProgress.setAttribute("data-indeterminate", "true");
      elements.progressPercent.textContent = "…";
    }
    elements.progressStage.textContent = stage;
    elements.progressDetail.textContent = detail;
  }

  function clearDocumentResults() {
    state.results = [];
    state.nextSequence = 1;
    state.resultTextDirty = false;
    state.resultTextEdited = false;
    state.resultDictionary = getCurrentDictionaryMetadata();
    state.totalElapsedMs = 0;
    state.latestProgress = 0;
    elements.resultText.value = "";
    elements.resultStats.replaceChildren();
    elements.pageResultList.replaceChildren();
    elements.resultPanel.hidden = true;
    elements.progressPanel.hidden = true;
    updateCharacterCount();
  }

  function clearCanvas() {
    elements.pageCanvas.width = 1;
    elements.pageCanvas.height = 1;
    const context = elements.pageCanvas.getContext("2d");
    context?.clearRect(0, 0, 1, 1);
  }

  function classifyRegionError(error) {
    if (error instanceof OperationTimeoutError) {
      return { code: "OPERATION_TIMEOUT", message: "処理がタイムアウトしました。範囲または精度を調整してください。" };
    }
    const message = String(error?.message || error || "");
    if (/memory|allocation|out of bounds|canvas/i.test(message)) {
      return { code: "MEMORY_OR_CANVAS_ERROR", message: "画像が大きすぎます。精度を一段階下げてください。" };
    }
    if (/render|RenderingCancelledException/i.test(message)) {
      return { code: "PDF_RENDER_ERROR", message: "選択ページを画像化できませんでした。" };
    }
    if (/worker|tesseract|recogn/i.test(message)) {
      return { code: "OCR_WORKER_ERROR", message: "OCRを実行できませんでした。もう一度お試しください。" };
    }
    return { code: "REGION_ERROR", message: "この選択範囲を処理できませんでした。" };
  }

  function toUserError(error, fallback) {
    if (error instanceof core.OcrInputError) return error.message;
    if (error instanceof OperationTimeoutError) {
      return `${error.label}が制限時間内に終わりませんでした。設定を軽くしてもう一度お試しください。`;
    }
    const name = String(error?.name || "");
    const message = String(error?.message || error || "");
    if (/PasswordException/i.test(name) || /password/i.test(message)) {
      return "PDFのパスワードを確認してください。";
    }
    if (/InvalidPDFException|Invalid PDF/i.test(`${name} ${message}`)) {
      return "PDFが壊れているか、対応していない形式です。";
    }
    if (/MissingPDFException/i.test(name)) {
      return withDiagnosticStage("PDFを読み込めませんでした。", error);
    }
    if (/Out of memory|allocation|memory access/i.test(message)) {
      return "メモリが不足しました。読み取り精度を下げてください。";
    }
    if (/SecurityError|Worker/i.test(`${name} ${message}`)) {
      return "OCR機能を起動できませんでした。対応ブラウザでScanScribe.htmlを直接開いてください。";
    }
    return withDiagnosticStage(fallback, error);
  }

  function withDiagnosticStage(message, error) {
    const stage = String(error?.scanScribeDiagnosticStage || "");
    return /^[A-Z][A-Z0-9_]{2,40}$/.test(stage)
      ? `${message}（診断コード: ${stage}）`
      : message;
  }

  function showToast(message, type = "info", duration = 3000) {
    if (toastTimer) root.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.dataset.type = type;
    elements.toast.hidden = false;
    toastTimer = root.setTimeout(() => {
      elements.toast.hidden = true;
      toastTimer = null;
    }, duration);
  }

  function announce(message, assertive = false) {
    elements.liveRegion.setAttribute("aria-live", assertive ? "assertive" : "polite");
    elements.liveRegion.textContent = "";
    root.requestAnimationFrame(() => {
      elements.liveRegion.textContent = message;
    });
  }
})(window, document);
