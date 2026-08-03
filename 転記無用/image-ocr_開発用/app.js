(function initializeScanScribeImage(root, document) {
  "use strict";

  const core = root.OcrCore;
  const accuracy = root.AccuracyCore;
  const imageCore = root.ImageOcrCore;
  const browserCompat = root.ScanScribeBrowserCompat;
  const VARIANT = Object.freeze({
    id: "image-precision",
    label: "画像・高精度版",
    modelVariant: "tessdata_best_float",
    requiredModels: Object.freeze(["jpn", "eng"]),
    ocrMaxPixels: 22_000_000,
    ocrContentMaxPixels: 20_000_000,
    ocrMaxDimension: 12_000,
    ocrContentMaxDimension: 11_900,
    psmEnsembleSize: 2,
    characterConsensus: true,
  });
  const HEADER_READ_BYTES = 1024 * 1024;
  const PREVIEW_MAX_PIXELS = 2_200_000;
  const PREVIEW_MAX_DIMENSION = 2200;
  const OCR_STARTUP_TIMEOUT_MS = 180_000;
  const OCR_CONFIG_TIMEOUT_MS = 30_000;
  const OCR_RECOGNITION_TIMEOUT_MS = 300_000;
  const WORKER_TERMINATION_TIMEOUT_MS = 2_000;
  const CONSENSUS_TEXT_SAMPLE_CHARS = 800;

  const elementIds = [
    "protocolBadge",
    "compatibilityNotice",
    "compatibilityMessage",
    "dropZone",
    "imageFile",
    "pasteButton",
    "imageSelectButton",
    "sampleButton",
    "autoRunAfterPaste",
    "inputStatus",
    "imageSummary",
    "imageName",
    "imageMeta",
    "removeImageButton",
    "previewFigure",
    "previewCanvas",
    "previewCaption",
    "smallImageNotice",
    "settingsPanel",
    "settingsHeading",
    "ocrLanguage",
    "imageScale",
    "pageLayout",
    "compareVariants",
    "autoRotate",
    "dictionaryFile",
    "dictionarySelectButton",
    "dictionarySummary",
    "dictionaryName",
    "dictionaryMeta",
    "dictionaryError",
    "removeDictionaryButton",
    "ocrSummary",
    "startButton",
    "startButtonLabel",
    "progressPanel",
    "progressHeading",
    "cancelButton",
    "progressStage",
    "progressDetail",
    "progressPercent",
    "overallProgress",
    "resultPanel",
    "resultHeading",
    "resultStats",
    "resultText",
    "characterCount",
    "imageResultList",
    "copyButton",
    "downloadTextButton",
    "downloadJsonButton",
    "clearResultsButton",
    "liveRegion",
    "toast",
  ];
  const elements = Object.fromEntries(
    elementIds.map((id) => [id, document.getElementById(id)]),
  );

  const state = {
    mode: "booting",
    compatible: false,
    controlsLocked: false,
    loadToken: 0,
    runToken: 0,
    source: null,
    activeRun: null,
    ocrSession: null,
    dictionary: null,
    dictionaryMatcher: null,
    dictionaryFileName: null,
    dictionaryLoading: false,
    clipboardReading: false,
    results: [],
    nextSequence: 1,
    resultTextDirty: false,
    resultTextEdited: false,
    latestProgress: 0,
    totalElapsedMs: 0,
  };

  let toastTimer = null;
  let toastToken = 0;
  let pasteHintTimer = null;

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
    const missingElement = elementIds.find((id) => !elements[id]);
    if (missingElement) throw new Error(`Required element is missing: ${missingElement}`);
    bindEvents();
    state.compatible = checkCompatibility();
    state.mode = state.compatible ? "idle" : "unsupported";
    updateUi();
  }

  function bindEvents() {
    elements.imageSelectButton.addEventListener("click", () => elements.imageFile.click());
    elements.imageFile.addEventListener("change", () => {
      const [file] = elements.imageFile.files || [];
      if (file) {
        void loadImageBlob(file, {
          name: file.name,
          inputMethod: "file",
          lastModified: file.lastModified,
          autoStart: false,
        });
      }
      elements.imageFile.value = "";
    });
    elements.pasteButton.addEventListener("click", () => void readClipboardFromButton());
    elements.sampleButton.addEventListener("click", () => void loadSampleImage());
    elements.removeImageButton.addEventListener("click", () => removeCurrentImage({ focusPicker: true }));

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
      if (dragDepth === 0) clearPasteHint();
    });
    elements.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      clearPasteHint();
      if (isBusy()) {
        showToast("処理が終わってから、画像をもう一度ドロップしてください。", "warning");
        return;
      }
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length !== 1) {
        showToast("画像を1枚だけドロップしてください。", "error");
        return;
      }
      const [file] = files;
      void loadImageBlob(file, {
        name: file.name,
        inputMethod: "drop",
        lastModified: file.lastModified,
        autoStart: false,
      });
    });
    elements.dropZone.addEventListener("keydown", (event) => {
      if (event.target !== elements.dropZone) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!isBusy()) elements.imageFile.click();
    });
    document.addEventListener("paste", handlePasteEvent);

    for (const control of [
      elements.ocrLanguage,
      elements.imageScale,
      elements.pageLayout,
      elements.compareVariants,
      elements.autoRotate,
    ]) {
      control.addEventListener("change", updateUi);
    }

    elements.dictionarySelectButton.addEventListener("click", () => elements.dictionaryFile.click());
    elements.dictionaryFile.addEventListener("change", () => {
      const [file] = elements.dictionaryFile.files || [];
      if (file) void loadDictionaryFile(file);
      elements.dictionaryFile.value = "";
    });
    elements.removeDictionaryButton.addEventListener("click", removeDictionary);

    elements.startButton.addEventListener("click", () => void startOcr());
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
    elements.clearResultsButton.addEventListener("click", clearAllResults);

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
    if (!imageCore) missing.push("画像検査機能");
    if (
      !browserCompat
      || browserCompat.installed !== true
      || browserCompat.version !== 1
      || typeof browserCompat.readBlobAsArrayBuffer !== "function"
    ) {
      missing.push("画像読込互換機能");
    }
    if (!root.Tesseract?.createWorker) missing.push("OCR機能");
    if (
      root.ScanScribeNetworkGuard?.installed !== true
      || root.ScanScribeNetworkGuard?.version !== 1
      || !root.ScanScribeNetworkGuard?.captureWorkers
    ) {
      missing.push("オフライン保護機能");
    }
    const missingModels = VARIANT.requiredModels.filter(
      (code) => !root.ScanScribeAssets?.models?.[code],
    );
    if (missingModels.length > 0) missing.push("日本語・英語モデル");
    if (typeof root.Worker !== "function") missing.push("Web Worker");
    if (typeof root.WebAssembly !== "object") missing.push("WebAssembly");
    if (typeof root.Blob !== "function") missing.push("Blob API");
    if (typeof root.AbortController !== "function") missing.push("中止制御機能");
    if (typeof root.HTMLCanvasElement !== "function") missing.push("画像処理機能");

    elements.protocolBadge.textContent = root.location.protocol === "file:"
      ? "file:// 実行中"
      : "オフライン構成";

    if (missing.length > 0) {
      elements.compatibilityMessage.textContent =
        `${missing.join("・")}を読み込めませんでした。単一HTMLをEdgeまたはChromeで開き直してください。`;
      elements.compatibilityNotice.hidden = false;
      return false;
    }
    return true;
  }

  function isBusy() {
    return state.mode === "loading"
      || state.mode === "running"
      || state.mode === "cancelling"
      || state.dictionaryLoading
      || state.clipboardReading;
  }

  function isEditableTarget(target) {
    if (!(target instanceof root.Element)) return false;
    if (target.closest("textarea, [contenteditable='true']")) return true;
    const input = target.closest("input");
    if (!input) return false;
    return !new Set([
      "button", "checkbox", "color", "file", "hidden", "image",
      "radio", "range", "reset", "submit",
    ]).has(String(input.type || "text").toLowerCase());
  }

  function clipboardImageFiles(clipboardData) {
    const imageItems = [...(clipboardData?.items || [])]
      .filter((item) => item.kind === "file" && String(item.type).startsWith("image/"));
    const pngItems = imageItems.filter((item) => item.type === "image/png");
    const selectedItems = pngItems.length === 1 ? pngItems : imageItems;
    const itemFiles = selectedItems.map((item) => item.getAsFile()).filter(Boolean);
    if (itemFiles.length > 0) return itemFiles;
    return [...(clipboardData?.files || [])].filter(
      (file) => String(file.type).startsWith("image/"),
    );
  }

  function clipboardHasPlainText(clipboardData) {
    return [...(clipboardData?.items || [])].some((item) => (
      item.kind === "string" && String(item.type).toLowerCase() === "text/plain"
    ));
  }

  function handlePasteEvent(event) {
    const files = clipboardImageFiles(event.clipboardData);
    if (files.length === 0) return;
    if (isEditableTarget(event.target) && clipboardHasPlainText(event.clipboardData)) return;
    event.preventDefault();
    clearPasteHint();
    if (isBusy()) {
      showToast("処理が終わってから、もう一度Ctrl + Vで貼り付けてください。", "warning", 5200);
      return;
    }
    if (files.length !== 1) {
      showToast("クリップボードの画像は1枚ずつ貼り付けてください。", "error");
      return;
    }
    void loadImageBlob(files[0], {
      name: imageCore.createClipboardFileName(),
      inputMethod: "clipboard",
      lastModified: Date.now(),
      autoStart: elements.autoRunAfterPaste.checked,
    });
  }

  async function readClipboardFromButton() {
    if (isBusy()) return;
    if (!root.navigator.clipboard?.read) {
      showPasteHint("この画面を選んだまま、Ctrl + Vを押してください。");
      return;
    }
    state.clipboardReading = true;
    elements.inputStatus.textContent = "クリップボードの画像を確認しています…";
    setControlsLocked(true);
    let pendingImage = null;
    let fallbackMessage = null;
    try {
      const clipboardItems = await root.navigator.clipboard.read();
      const imageEntries = clipboardItems.map((item) => {
        const supportedType = item.types.find((type) => (
          type === "image/png" || type === "image/jpeg" || type === "image/webp"
        ));
        const fallbackType = item.types.find((type) => String(type).startsWith("image/"));
        const type = supportedType || fallbackType;
        return type ? { item, type } : null;
      }).filter(Boolean);
      if (imageEntries.length === 0) {
        fallbackMessage = "クリップボードに画像がありません。Win + Shift + Sで切り取ってからCtrl + Vを押してください。";
      } else if (imageEntries.length > 1) {
        fallbackMessage = "クリップボードの画像は1枚ずつ貼り付けてください。";
      } else {
        const [{ item, type }] = imageEntries;
        const blob = await item.getType(type);
        pendingImage = {
          blob,
          options: {
            name: imageCore.createClipboardFileName(),
            inputMethod: "clipboard-button",
            lastModified: Date.now(),
            autoStart: elements.autoRunAfterPaste.checked,
          },
        };
      }
    } catch {
      fallbackMessage = "クリップボードを直接読めませんでした。この画面を選んだままCtrl + Vを押してください。";
    } finally {
      state.clipboardReading = false;
      elements.inputStatus.textContent = "";
      setControlsLocked(false);
    }
    if (pendingImage) {
      await loadImageBlob(pendingImage.blob, pendingImage.options);
    } else if (fallbackMessage) {
      showPasteHint(fallbackMessage);
    }
  }

  function showPasteHint(message) {
    elements.inputStatus.textContent = message;
    elements.dropZone.dataset.state = "awaiting-paste";
    elements.dropZone.focus();
    root.clearTimeout(pasteHintTimer);
    pasteHintTimer = root.setTimeout(clearPasteHint, 8000);
    announce(message);
  }

  function clearPasteHint() {
    root.clearTimeout(pasteHintTimer);
    pasteHintTimer = null;
    elements.dropZone.dataset.state = "empty";
  }

  async function loadImageBlob(blob, options = {}) {
    if (!state.compatible || isBusy()) return;
    const token = ++state.loadToken;
    const previousMode = state.source ? "ready" : "idle";
    state.mode = "loading";
    elements.inputStatus.textContent = "画像の形式と大きさを確認しています…";
    setControlsLocked(true);
    let canvas = null;
    let decoded = null;
    let pendingSource = null;

    try {
      if (!(blob instanceof Blob)) {
        throw new imageCore.ImageInputError("画像を選んでください。", "IMAGE_REQUIRED");
      }
      imageCore.validateImageSize(blob.size);
      const headerBytes = new Uint8Array(
        await browserCompat.readBlobAsArrayBuffer(
          blob.slice(0, Math.min(blob.size, HEADER_READ_BYTES)),
        ),
      );
      if (token !== state.loadToken) return;
      const header = imageCore.inspectImageHeader(headerBytes);
      imageCore.validateImageDimensions(header.width, header.height);

      elements.inputStatus.textContent = "画像を端末内で開いています…";
      decoded = await decodeRasterImage(blob);
      if (token !== state.loadToken) return;
      const dimensions = imageCore.validateImageDimensions(
        decoded.source.width || decoded.source.naturalWidth,
        decoded.source.height || decoded.source.naturalHeight,
      );

      canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
      if (!context) throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      decoded.cleanup();
      decoded = null;

      if (token !== state.loadToken) return;
      pendingSource = {
        canvas,
        recognizedCount: 0,
        meta: Object.freeze({
          name: normalizeImageName(options.name, header.extension),
          bytes: blob.size,
          type: header.mime,
          detectedFormat: header.type,
          width: canvas.width,
          height: canvas.height,
          inputMethod: String(options.inputMethod || "file"),
          lastModified: Number.isFinite(Number(options.lastModified))
            ? Number(options.lastModified)
            : null,
        }),
      };
      renderPreview(pendingSource);
      const previousSource = state.source;
      state.source = pendingSource;
      pendingSource = null;
      canvas = null;
      disposeSource(previousSource);
      state.mode = "ready";
      elements.inputStatus.textContent = `${state.source.meta.name} を読み込みました。画像全体が対象です。`;
      updateUi();
      announce(`${state.source.meta.name}を読み込みました。画像全体を文字認識できます。`, true);

      if (options.autoStart) {
        const loadedSource = state.source;
        root.setTimeout(() => {
          if (state.source === loadedSource && state.mode === "ready") void startOcr();
        }, 0);
      } else {
        root.requestAnimationFrame(() => elements.settingsHeading.focus({ preventScroll: false }));
      }
    } catch (error) {
      if (token !== state.loadToken) return;
      state.mode = previousMode;
      elements.inputStatus.textContent = "";
      try {
        if (state.source) renderPreview(state.source);
        else clearPreview();
      } catch {
        clearPreview();
      }
      showToast(toUserError(error, "画像を読み込めませんでした。"), "error", 6200);
      announce(toUserError(error, "画像を読み込めませんでした。"), true);
    } finally {
      decoded?.cleanup();
      disposeSource(pendingSource);
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      if (token === state.loadToken) {
        setControlsLocked(false);
        updateUi();
      }
    }
  }

  function normalizeImageName(name, extension) {
    const raw = String(name || "").trim();
    if (!raw) return `${imageCore.sanitizeImageBaseName("")}${extension}`;
    if (/\.(?:png|jpe?g|webp)$/i.test(raw)) return raw.slice(0, 180);
    return `${raw.slice(0, 170)}${extension}`;
  }

  async function decodeRasterImage(blob) {
    if (typeof root.createImageBitmap === "function") {
      try {
        const bitmap = await root.createImageBitmap(blob, { imageOrientation: "from-image" });
        return {
          source: bitmap,
          cleanup: once(() => bitmap.close()),
        };
      } catch {
        try {
          const bitmap = await root.createImageBitmap(blob);
          return {
            source: bitmap,
            cleanup: once(() => bitmap.close()),
          };
        } catch {
          // The image element fallback below provides a clearer browser-compatible path.
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      if (typeof image.decode === "function") {
        await image.decode();
      } else {
        await new Promise((resolve, reject) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", reject, { once: true });
        });
      }
      return {
        source: image,
        cleanup: once(() => URL.revokeObjectURL(url)),
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function once(callback) {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      callback();
    };
  }

  function disposeSource(source) {
    if (!source?.canvas) return;
    source.canvas.width = 1;
    source.canvas.height = 1;
  }

  function removeCurrentImage(options = {}) {
    if (isBusy()) return;
    ++state.loadToken;
    const previous = state.source;
    state.source = null;
    disposeSource(previous);
    clearPreview();
    state.mode = state.compatible ? "idle" : "unsupported";
    elements.inputStatus.textContent = "";
    updateUi();
    announce("現在の画像を外しました。保存済みの文字起こし結果は残っています。");
    if (options.focusPicker) elements.pasteButton.focus();
  }

  function renderPreview(source = state.source) {
    if (!source) return;
    const scale = Math.min(
      1,
      Math.sqrt(PREVIEW_MAX_PIXELS / (source.canvas.width * source.canvas.height)),
      PREVIEW_MAX_DIMENSION / Math.max(source.canvas.width, source.canvas.height),
    );
    elements.previewCanvas.width = Math.max(1, Math.round(source.canvas.width * scale));
    elements.previewCanvas.height = Math.max(1, Math.round(source.canvas.height * scale));
    const context = elements.previewCanvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PREVIEW_CANVAS_CONTEXT_UNAVAILABLE");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      source.canvas,
      0,
      0,
      elements.previewCanvas.width,
      elements.previewCanvas.height,
    );
    elements.previewCaption.textContent =
      `${source.meta.width.toLocaleString("ja-JP")} × ${source.meta.height.toLocaleString("ja-JP")} px — 画像全体をOCRします`;
  }

  function clearPreview() {
    elements.previewCanvas.width = 1;
    elements.previewCanvas.height = 1;
    elements.previewCanvas.getContext("2d")?.clearRect(0, 0, 1, 1);
  }

  async function loadSampleImage() {
    if (!state.compatible || isBusy()) return;
    state.mode = "loading";
    setControlsLocked(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1500;
      canvas.height = 650;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("SAMPLE_CANVAS_CONTEXT_UNAVAILABLE");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#0f6d6f";
      context.lineWidth = 8;
      context.strokeRect(58, 54, 1384, 542);
      const fontFamily = '"Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif';
      context.fillStyle = "#102125";
      context.font = `700 72px ${fontFamily}`;
      context.fillText("スクリーンショット文字起こし", 118, 175);
      context.font = `500 58px ${fontFamily}`;
      context.fillText("文書番号 12345", 118, 295);
      context.fillText("合計金額 123,450円", 118, 405);
      context.font = `600 52px ${fontFamily}`;
      context.fillText("Local OCR / No Upload", 118, 520);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("SAMPLE_ENCODE_FAILED"))), "image/png");
      });
      canvas.width = 1;
      canvas.height = 1;
      state.mode = state.source ? "ready" : "idle";
      setControlsLocked(false);
      await loadImageBlob(blob, {
        name: "scanscribe_image_sample.png",
        inputMethod: "sample",
        lastModified: Date.now(),
        autoStart: false,
      });
    } catch (error) {
      state.mode = state.source ? "ready" : "idle";
      setControlsLocked(false);
      showToast(toUserError(error, "サンプル画像を作成できませんでした。"), "error");
    }
  }

  async function loadDictionaryFile(file) {
    if (isBusy()) return;
    state.dictionaryLoading = true;
    setControlsLocked(true);
    elements.dictionaryError.textContent = "";
    try {
      if (!(file instanceof File)) {
        throw new core.OcrInputError("補正辞書のJSONを選んでください。", "DICTIONARY_REQUIRED");
      }
      if (file.size > core.MAX_DICTIONARY_BYTES) {
        throw new core.OcrInputError(
          `補正辞書は${core.formatBytes(core.MAX_DICTIONARY_BYTES)}以下にしてください。`,
          "DICTIONARY_TOO_LARGE",
        );
      }
      const dictionary = core.normalizeDictionary(JSON.parse(await file.text()), file.size);
      const matcher = core.compileDictionary(dictionary);
      state.dictionary = dictionary;
      state.dictionaryMatcher = matcher;
      state.dictionaryFileName = file.name;
      elements.dictionaryName.textContent = dictionary.name;
      elements.dictionaryMeta.textContent =
        `${dictionary.entries.length.toLocaleString("ja-JP")}件・${file.name}`;
      elements.dictionarySummary.hidden = false;
      showToast("補正辞書を読み込みました。次のOCRから適用します。", "success");
    } catch (error) {
      elements.dictionaryError.textContent = error instanceof SyntaxError
        ? "JSONの構文を確認してください。"
        : toUserError(error, "補正辞書を読み込めませんでした。");
    } finally {
      state.dictionaryLoading = false;
      setControlsLocked(false);
      updateUi();
    }
  }

  function removeDictionary() {
    if (isBusy()) return;
    state.dictionary = null;
    state.dictionaryMatcher = null;
    state.dictionaryFileName = null;
    elements.dictionarySummary.hidden = true;
    elements.dictionaryName.textContent = "";
    elements.dictionaryMeta.textContent = "";
    elements.dictionaryError.textContent = "";
    showToast("補正辞書を外しました。", "success");
  }

  function captureSettings() {
    if (!state.source) {
      throw new imageCore.ImageInputError("スクリーンショットを貼り付けてください。", "IMAGE_REQUIRED");
    }
    const requestedScale = Number(elements.imageScale.value);
    const actualScale = imageCore.calculateOcrScale(
      state.source.canvas.width,
      state.source.canvas.height,
      requestedScale,
      VARIANT.ocrContentMaxPixels,
      VARIANT.ocrContentMaxDimension,
    );
    return Object.freeze({
      variantId: VARIANT.id,
      variantLabel: VARIANT.label,
      languages: Object.freeze(elements.ocrLanguage.value.split("+")),
      languageLabel: elements.ocrLanguage.options[elements.ocrLanguage.selectedIndex].textContent,
      requestedScale,
      actualScale,
      scaleLabel: elements.imageScale.options[elements.imageScale.selectedIndex].textContent,
      pageSegmentationMode: elements.pageLayout.value,
      layoutLabel: elements.pageLayout.options[elements.pageLayout.selectedIndex].textContent,
      compareVariants: elements.compareVariants.checked,
      autoRotate: elements.autoRotate.checked,
      dictionaryMatcher: state.dictionaryMatcher,
      dictionary: getDictionaryMetadata(),
      sourceCanvas: state.source.canvas,
      source: Object.freeze({ ...state.source.meta }),
    });
  }

  function getDictionaryMetadata() {
    if (!state.dictionary) return null;
    return Object.freeze({
      name: state.dictionary.name,
      entries: state.dictionary.entries.length,
      fileName: state.dictionaryFileName,
    });
  }

  async function startOcr() {
    if (!state.compatible || isBusy() || !state.source) return;
    let settings;
    try {
      settings = captureSettings();
    } catch (error) {
      showToast(toUserError(error, "OCR設定を確認してください。"), "error");
      return;
    }

    const run = {
      token: ++state.runToken,
      abortController: new AbortController(),
      cancelled: false,
      workerResources: null,
      passIndex: 0,
      passCount: 1,
      passLabel: "画像全体",
    };
    state.activeRun = run;
    state.mode = "running";
    state.latestProgress = 0;
    elements.cancelButton.disabled = false;
    elements.cancelButton.textContent = "中止";
    elements.progressPanel.hidden = false;
    setProgress(0, "OCRの準備を始めます", "画像は端末の外へ送信しません");
    setControlsLocked(true);
    announce("画像全体の文字認識を開始しました。", true);
    root.requestAnimationFrame(() => elements.progressHeading.focus({ preventScroll: false }));
    const startedAt = performance.now();

    try {
      const result = await processImage(run, settings, startedAt);
      assertActiveRun(run);
      state.results.push(result);
      if (state.source?.canvas === settings.sourceCanvas) state.source.recognizedCount += 1;
      state.nextSequence += 1;
      state.totalElapsedMs += result.durationMs;
      appendResultText(result.text);
      state.resultTextDirty = true;
      state.mode = "ready";
      elements.progressPanel.hidden = true;
      renderResults();
      setControlsLocked(false);
      state.activeRun = null;
      if (result.status === "warning") {
        showToast("文字を見つけられませんでした。設定を変えてもう一度お試しください。", "warning", 5600);
      } else {
        showToast(`読み取り${result.sequence}を結果へ追加しました。`, "success");
      }
      announce(`読み取り${result.sequence}を結果へ追加しました。`, true);
      root.requestAnimationFrame(() => elements.resultHeading.focus({ preventScroll: false }));
    } catch (error) {
      if (error instanceof RunCancelledError || run.cancelled) return;
      if (state.activeRun === run) {
        state.activeRun = null;
        state.mode = state.source ? "ready" : "idle";
        elements.progressPanel.hidden = true;
        setControlsLocked(false);
      }
      showToast(toUserError(error, "文字認識を完了できませんでした。"), "error", 6200);
      announce(toUserError(error, "文字認識を完了できませんでした。"), true);
    } finally {
      if (state.activeRun === run && state.mode !== "cancelling") {
        state.activeRun = null;
        state.mode = state.source ? "ready" : "idle";
        elements.progressPanel.hidden = true;
        setControlsLocked(false);
      }
      updateUi();
    }
  }

  async function processImage(run, settings, startedAt) {
    let working = null;
    let recognitionCanvas = null;
    let deskewInfo = null;
    try {
      setProgress(5, "画像をOCR向けに整えています", "透明部分を白背景にし、画像端へ余白を加えます");
      working = createWorkingCanvas(settings.sourceCanvas, settings.actualScale);
      recognitionCanvas = working.canvas;
      let actualDpi = Math.max(96, Math.round(96 * working.scale));

      if (settings.autoRotate) {
        setProgress(10, "文字の傾きを調べています", "小さな傾きだけを自動補正します");
        const deskewed = tryDeskewCanvas(recognitionCanvas);
        deskewInfo = deskewed.info;
        if (deskewed.canvas) {
          const previousCanvas = recognitionCanvas;
          recognitionCanvas = deskewed.canvas;
          previousCanvas.width = 1;
          previousCanvas.height = 1;
          working.canvas = recognitionCanvas;
          actualDpi = Math.max(96, Math.round(actualDpi * (deskewInfo?.outputScale || 1)));
        }
      }

      const darkBackground = detectDarkBackground(recognitionCanvas);
      const passDefinitions = settings.compareVariants
        ? [
          { id: "original", label: "原画像", thresholdingMethod: "0" },
          { id: "otsu", label: "Adaptive Otsu版", thresholdingMethod: "1" },
          { id: "sauvola", label: "Sauvola版", thresholdingMethod: "2" },
          { id: "contrast", label: "コントラスト補正版", thresholdingMethod: "0" },
          ...(darkBackground
            ? [{ id: "inverted", label: "暗背景反転版", thresholdingMethod: "0" }]
            : []),
        ]
        : [{ id: "original", label: "原画像", thresholdingMethod: "0" }];
      const pageSegmentationModes = getPageSegmentationCandidates(
        settings.pageSegmentationMode,
        settings.compareVariants ? VARIANT.psmEnsembleSize : 1,
      );
      const passCount = passDefinitions.length * pageSegmentationModes.length;
      const candidates = [];
      let failedPassCount = 0;
      let passIndex = 0;
      let lastRecognitionError = null;

      for (const definition of passDefinitions) {
        assertActiveRun(run);
        let candidateCanvas = recognitionCanvas;
        try {
          if (definition.id === "contrast") {
            setProgress(null, "コントラスト補正版を準備しています", "薄い文字向けの候補を作ります");
            candidateCanvas = cloneCanvas(recognitionCanvas);
            enhanceCanvas(candidateCanvas);
          } else if (definition.id === "inverted") {
            setProgress(null, "暗背景向け画像を準備しています", "白い文字と暗い背景を反転します");
            candidateCanvas = cloneCanvas(recognitionCanvas);
            invertCanvas(candidateCanvas);
          }

          for (const pageSegmentationMode of pageSegmentationModes) {
            passIndex += 1;
            const label = `${definition.label}${deskewInfo?.applied ? "・傾き補正" : ""}（PSM ${pageSegmentationMode}）`;
            run.passIndex = passIndex;
            run.passCount = passCount;
            run.passLabel = label;
            setProgress(
              16 + ((passIndex - 1) / Math.max(1, passCount)) * 76,
              `${label}を認識しています`,
              `${passIndex}/${passCount}条件を処理しています`,
            );
            try {
              const recognition = await recognizeWithRecovery(run, candidateCanvas, {
                ...settings,
                actualDpi,
                pageSegmentationMode,
                thresholdingMethod: definition.thresholdingMethod,
              });
              candidates.push(toOcrCandidate(recognition, {
                id: `${definition.id}-psm${pageSegmentationMode}`,
                label,
                preprocessor: definition.id,
                pageSegmentationMode,
                thresholdingMethod: definition.thresholdingMethod,
              }));
            } catch (error) {
              if (error instanceof RunCancelledError || run.cancelled) throw error;
              lastRecognitionError = error;
              failedPassCount += 1;
            }
          }
        } catch (error) {
          if (error instanceof RunCancelledError || run.cancelled) throw error;
          lastRecognitionError = error;
          const remaining = pageSegmentationModes.length;
          passIndex += remaining;
          failedPassCount += remaining;
        } finally {
          if (candidateCanvas !== recognitionCanvas) {
            candidateCanvas.width = 1;
            candidateCanvas.height = 1;
          }
        }
      }

      if (candidates.length === 0) {
        throw lastRecognitionError || new Error("OCR_ALL_PASSES_FAILED");
      }

      assertActiveRun(run);
      setProgress(95, `${candidates.length}候補を比較しています`, "候補間の一致度と信頼度を評価します");
      const selected = selectBestOcrCandidate(candidates);
      const rawText = String(selected.text || "");
      const corrected = applyDictionarySafely(rawText, settings.dictionaryMatcher);
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      setProgress(100, "結果へ追加しています", `読み取り${state.nextSequence}をまとめています`);

      return Object.freeze({
        sequence: state.nextSequence,
        status: rawText.trim() ? "success" : "warning",
        text: corrected.text,
        rawText,
        confidence: Number.isFinite(selected.confidence) ? Math.round(selected.confidence) : null,
        selectedVariant: selected.variant,
        selectedPassLabel: selected.label || selected.variant,
        comparisonScore: selected.comparisonScore ?? null,
        agreement: Number.isFinite(selected.agreement) ? selected.agreement : null,
        consensusApplied: selected.consensusApplied === true,
        disagreementCount: Number.isInteger(selected.disagreementCount)
          ? selected.disagreementCount
          : null,
        candidateCount: candidates.length,
        plannedPassCount: passCount,
        attemptedPassCount: passIndex,
        failedPassCount,
        replacements: corrected.replacements,
        correctionErrorCode: corrected.errorCode,
        actualScale: working.scale,
        actualDpi,
        padding: working.padding,
        darkBackground,
        deskew: deskewInfo,
        durationMs,
        source: settings.source,
        dictionary: settings.dictionary,
        settings: Object.freeze({
          variantId: settings.variantId,
          variantLabel: settings.variantLabel,
          modelVariant: VARIANT.modelVariant,
          languages: settings.languages,
          languageLabel: settings.languageLabel,
          requestedScale: settings.requestedScale,
          actualScale: working.scale,
          scaleLabel: settings.scaleLabel,
          layout: settings.layoutLabel,
          pageSegmentationMode: settings.pageSegmentationMode,
          compareVariants: settings.compareVariants,
          autoRotate: settings.autoRotate,
        }),
        candidates: Object.freeze(candidates.map((candidate) => Object.freeze({
          variant: candidate.variant,
          label: candidate.label,
          text: candidate.text,
          confidence: candidate.confidence,
          preprocessor: candidate.preprocessor,
          pageSegmentationMode: candidate.pageSegmentationMode,
          thresholdingMethod: candidate.thresholdingMethod,
        }))),
      });
    } finally {
      const canvases = new Set([working?.canvas, recognitionCanvas]);
      for (const canvas of canvases) {
        if (!canvas) continue;
        canvas.width = 1;
        canvas.height = 1;
      }
    }
  }

  function createWorkingCanvas(sourceCanvas, requestedScale) {
    const scale = imageCore.calculateOcrScale(
      sourceCanvas.width,
      sourceCanvas.height,
      requestedScale,
      VARIANT.ocrContentMaxPixels,
      VARIANT.ocrContentMaxDimension,
    );
    const contentWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
    const contentHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
    const padding = Math.max(16, Math.min(40, Math.round(Math.min(contentWidth, contentHeight) * 0.025)));
    const canvas = document.createElement("canvas");
    try {
      canvas.width = contentWidth + padding * 2;
      canvas.height = contentHeight + padding * 2;
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(sourceCanvas, padding, padding, contentWidth, contentHeight);
      return { canvas, scale, padding, contentWidth, contentHeight };
    } catch (error) {
      canvas.width = 1;
      canvas.height = 1;
      throw error;
    }
  }

  function cloneCanvas(sourceCanvas) {
    const canvas = document.createElement("canvas");
    try {
      canvas.width = sourceCanvas.width;
      canvas.height = sourceCanvas.height;
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sourceCanvas, 0, 0);
      return canvas;
    } catch (error) {
      canvas.width = 1;
      canvas.height = 1;
      throw error;
    }
  }

  function enhanceCanvas(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    accuracy.enhanceRgbaPercentilesInPlace(image.data, canvas.width, canvas.height);
    context.putImageData(image, 0, 0);
  }

  function invertCanvas(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      image.data[index] = 255 - image.data[index];
      image.data[index + 1] = 255 - image.data[index + 1];
      image.data[index + 2] = 255 - image.data[index + 2];
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  function detectDarkBackground(sourceCanvas) {
    let analysisCanvas = null;
    try {
      const scale = Math.min(
        1,
        Math.sqrt(300_000 / (sourceCanvas.width * sourceCanvas.height)),
        900 / Math.max(sourceCanvas.width, sourceCanvas.height),
      );
      analysisCanvas = document.createElement("canvas");
      analysisCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
      analysisCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
      const context = analysisCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
      context.drawImage(sourceCanvas, 0, 0, analysisCanvas.width, analysisCanvas.height);
      const grayscale = accuracy.readCanvasGrayscale(analysisCanvas);
      const statistics = accuracy.computeImageStatistics(
        grayscale.data,
        grayscale.width,
        grayscale.height,
      );
      return statistics.percentiles.median < 118 && statistics.mean < 145;
    } catch {
      return false;
    } finally {
      if (analysisCanvas) {
        analysisCanvas.width = 1;
        analysisCanvas.height = 1;
      }
    }
  }

  function tryDeskewCanvas(sourceCanvas) {
    if (!accuracy?.estimateDeskewAngle || Math.min(sourceCanvas.width, sourceCanvas.height) < 48) {
      return { canvas: null, info: null };
    }
    let analysisCanvas = null;
    try {
      const scale = Math.min(
        1,
        Math.sqrt(1_200_000 / (sourceCanvas.width * sourceCanvas.height)),
        1800 / Math.max(sourceCanvas.width, sourceCanvas.height),
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
      const apply = Math.abs(estimate.correctionAngle) >= 0.15 && estimate.confidence >= 0.02;
      const bounds = accuracy.calculateRotatedBounds(
        sourceCanvas.width,
        sourceCanvas.height,
        estimate.correctionAngle,
      );
      const outputScale = Math.min(
        1,
        Math.sqrt(VARIANT.ocrMaxPixels / (bounds.width * bounds.height)),
        VARIANT.ocrMaxDimension / bounds.width,
        VARIANT.ocrMaxDimension / bounds.height,
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
        maximumPixels: VARIANT.ocrMaxPixels,
        maximumDimension: VARIANT.ocrMaxDimension,
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

  function toOcrCandidate(recognition, pass) {
    const reportedConfidence = Number(recognition.data?.confidence);
    return {
      text: String(recognition.data?.text || ""),
      confidence: Number.isFinite(reportedConfidence)
        ? Math.max(0, Math.min(100, reportedConfidence))
        : 0,
      variant: pass.id,
      label: pass.label,
      preprocessor: pass.preprocessor,
      pageSegmentationMode: pass.pageSegmentationMode,
      thresholdingMethod: pass.thresholdingMethod,
    };
  }

  function selectBestOcrCandidate(candidates) {
    if (candidates.length < 2 || !accuracy?.buildCandidateConsensus) {
      return core.selectOcrCandidate(candidates);
    }
    const requiresSampling = candidates.some(
      (candidate) => [...String(candidate.text || "")].length > CONSENSUS_TEXT_SAMPLE_CHARS,
    );
    const compared = requiresSampling
      ? candidates.map((candidate) => ({
        ...candidate,
        text: accuracy.sampleTextForAgreement(candidate.text, CONSENSUS_TEXT_SAMPLE_CHARS),
      }))
      : candidates;
    const consensus = accuracy.buildCandidateConsensus(compared, {
      agreementWeight: 0.85,
      confidenceWeight: 0.15,
      minimumVoteRatio: 0.5,
    });
    const selected = candidates[consensus.selectedIndex];
    const evaluation = consensus.evaluations.find(
      (entry) => entry.index === consensus.selectedIndex,
    );
    const comparable = consensus.activeCandidateCount >= 2;
    const useConsensus = VARIANT.characterConsensus
      && !requiresSampling
      && comparable
      && consensus.agreement >= 0.55
      && String(consensus.consensusText).trim();
    return Object.freeze({
      ...selected,
      text: useConsensus ? consensus.consensusText : selected.text,
      agreement: comparable ? consensus.agreement : null,
      comparisonScore: evaluation
        ? Math.round(evaluation.score * 100_000) / 1000
        : null,
      consensusApplied: Boolean(useConsensus),
      disagreementCount: comparable ? consensus.disagreements.length : null,
    });
  }

  function applyDictionarySafely(text, matcher) {
    const source = String(text || "");
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
        scope.fetch = () => Promise.reject(new TypeError("Network access is disabled."));
        if (scope.XMLHttpRequest && scope.XMLHttpRequest.prototype) {
          scope.XMLHttpRequest.prototype.open = blocked;
        }
        scope.importScripts = blocked;
        for (const name of ["WebSocket", "EventSource", "WebTransport", "Worker", "SharedWorker"]) {
          if (name in scope) scope[name] = blocked;
        }
      })(self);
    `;
    const workerBlob = new Blob(
      [workerGuard, "\n", assets.tesseractCoreSource, "\n", assets.tesseractWorkerSource],
      { type: "application/javascript" },
    );
    const workerUrl = URL.createObjectURL(workerBlob);
    const resources = {
      url: workerUrl,
      nativeWorkers: new Set(),
      apiWorker: null,
      promise: null,
      failureError: null,
      failureListeners: new Set(),
      disposed: false,
      terminatedWorkers: new WeakSet(),
    };
    run.workerResources = resources;
    let failureReported = false;
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

    try {
      const captured = root.ScanScribeNetworkGuard.captureWorkers(() => (
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
              if (activeRun?.workerResources === resources) handleOcrProgress(activeRun, message);
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
            void terminateWorkerOnce(resources, worker);
          } else {
            resources.apiWorker = worker;
          }
        },
        () => {},
      );
      const worker = await awaitRunOperation(
        run,
        () => resources.promise,
        OCR_STARTUP_TIMEOUT_MS,
        "OCRエンジンの起動",
        resources,
      );
      assertActiveRun(run);
      if (resources.disposed || run.workerResources !== resources) throw new RunCancelledError();
      resources.apiWorker = worker;
      return worker;
    } catch (error) {
      await disposeOcrWorker(run, resources);
      throw error;
    }
  }

  async function configureOcrWorker(run, worker, settings) {
    await awaitRunOperation(
      run,
      () => worker.setParameters({
        tessedit_pageseg_mode: settings.pageSegmentationMode,
        preserve_interword_spaces: "1",
        user_defined_dpi: String(settings.actualDpi),
        thresholding_method: String(settings.thresholdingMethod),
      }),
      OCR_CONFIG_TIMEOUT_MS,
      "OCR設定",
      run.workerResources,
    );
  }

  async function recognizeWithRecovery(run, canvas, settings) {
    const recognize = async () => {
      const worker = await acquireOcrWorker(run, settings);
      await configureOcrWorker(run, worker, settings);
      return awaitRunOperation(
        run,
        () => worker.recognize(canvas, { rotateAuto: settings.autoRotate }),
        OCR_RECOGNITION_TIMEOUT_MS,
        "文字認識",
        run.workerResources,
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

  function handleOcrProgress(run, message) {
    if (state.activeRun !== run || run.cancelled || state.mode !== "running") return;
    const status = String(message?.status || "").toLowerCase();
    if (status !== "recognizing text") {
      setProgress(null, core.mapOcrStatus(status), "同梱したOCRエンジンとモデルだけを使っています");
      return;
    }
    const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    const passCount = Math.max(1, run.passCount);
    const passIndex = Math.max(1, run.passIndex);
    const span = 76 / passCount;
    const start = 16 + (passIndex - 1) * span;
    setProgress(
      start + progress * span,
      `${run.passLabel}を認識しています`,
      `${passIndex}/${passCount}条件を処理しています`,
    );
  }

  function assertActiveRun(run) {
    if (
      !run
      || run.cancelled
      || run.abortController.signal.aborted
      || state.activeRun !== run
      || state.mode !== "running"
    ) {
      throw new RunCancelledError();
    }
  }

  async function awaitRunOperation(run, operationFactory, timeoutMs, label, failureSource = null) {
    assertActiveRun(run);
    let timeoutId = null;
    let abortListener = null;
    let failureListener = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = root.setTimeout(() => reject(new OperationTimeoutError(label)), timeoutMs);
    });
    const cancelled = new Promise((_, reject) => {
      abortListener = () => reject(new RunCancelledError());
      run.abortController.signal.addEventListener("abort", abortListener, { once: true });
    });
    const failure = failureSource ? new Promise((_, reject) => {
      failureListener = (error) => reject(error);
      if (failureSource.failureError) {
        reject(failureSource.failureError);
      } else {
        failureSource.failureListeners.add(failureListener);
      }
    }) : null;
    try {
      return await Promise.race([
        Promise.resolve().then(operationFactory),
        timeout,
        cancelled,
        ...(failure ? [failure] : []),
      ]);
    } finally {
      root.clearTimeout(timeoutId);
      if (abortListener) run.abortController.signal.removeEventListener("abort", abortListener);
      if (failureListener) failureSource.failureListeners.delete(failureListener);
    }
  }

  async function cancelOcrRun() {
    const run = state.activeRun;
    if (state.mode !== "running" || !run) return;
    state.mode = "cancelling";
    run.cancelled = true;
    run.abortController.abort();
    elements.cancelButton.disabled = true;
    elements.cancelButton.textContent = "中止中…";
    setProgress(null, "現在の画像を中止しています", "追加済みの読み取り結果は残します");
    announce("現在の画像の文字認識を中止しています。", true);
    await disposeOcrWorker(run);
    if (state.activeRun !== run || state.mode !== "cancelling") return;
    state.activeRun = null;
    state.mode = state.source ? "ready" : "idle";
    elements.progressPanel.hidden = true;
    setControlsLocked(false);
    updateUi();
    showToast("現在の画像の文字認識を中止しました。", "warning");
    announce("現在の画像の文字認識を中止しました。追加済みの結果は残っています。", true);
    elements.startButton.focus();
  }

  function terminateWorkerOnce(resources, worker) {
    if (!worker || resources.terminatedWorkers.has(worker)) return Promise.resolve();
    resources.terminatedWorkers.add(worker);
    return Promise.resolve().then(() => worker.terminate()).catch(() => {});
  }

  async function disposeOcrWorker(run, selectedResources = run?.workerResources) {
    const resources = selectedResources;
    if (!resources || resources.disposed) return;
    resources.disposed = true;
    resources.failureListeners.clear();
    if (run?.workerResources === resources) run.workerResources = null;
    if (state.ocrSession?.resources === resources) state.ocrSession = null;
    const apiWorker = resources.apiWorker;
    resources.apiWorker = null;
    resources.promise?.then(
      (lateWorker) => {
        if (lateWorker !== apiWorker) void terminateWorkerOnce(resources, lateWorker);
      },
      () => {},
    );
    const terminations = [terminateWorkerOnce(resources, apiWorker)];
    for (const nativeWorker of resources.nativeWorkers) {
      try {
        nativeWorker.terminate();
      } catch {
        // Native worker termination is best-effort.
      }
    }
    await Promise.race([
      Promise.allSettled(terminations),
      new Promise((resolve) => root.setTimeout(resolve, WORKER_TERMINATION_TIMEOUT_MS)),
    ]);
    URL.revokeObjectURL(resources.url);
  }

  function appendResultText(text) {
    const incoming = String(text || "").trim();
    if (!incoming) return;
    const current = elements.resultText.value.trimEnd();
    elements.resultText.value = current ? `${current}\n\n${incoming}` : incoming;
    updateCharacterCount();
  }

  function renderResults() {
    elements.resultPanel.hidden = state.results.length === 0;
    if (state.results.length === 0) return;
    const successes = state.results.filter((result) => result.status === "success").length;
    const averageConfidenceValues = state.results
      .map((result) => result.confidence)
      .filter(Number.isFinite);
    const averageConfidence = averageConfidenceValues.length > 0
      ? Math.round(averageConfidenceValues.reduce((sum, value) => sum + value, 0) / averageConfidenceValues.length)
      : null;
    elements.resultStats.replaceChildren(
      createStatCard(state.results.length.toLocaleString("ja-JP"), "画像"),
      createStatCard(successes.toLocaleString("ja-JP"), "文字あり"),
      createStatCard(
        averageConfidence === null ? "—" : `${averageConfidence}%`,
        "平均信頼度",
      ),
      createStatCard(
        elements.resultText.value.length.toLocaleString("ja-JP"),
        "出力文字数",
        "output-length",
      ),
    );
    elements.imageResultList.replaceChildren(...state.results.map(createImageResultCard));
    updateCharacterCount();
    updateUi();
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

  function createImageResultCard(result) {
    const article = document.createElement("article");
    article.className = "image-result";
    const head = document.createElement("div");
    head.className = "image-result-head";
    const titleBlock = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = `${result.sequence}. ${result.source.name}`;
    const meta = document.createElement("p");
    meta.className = "result-meta";
    const confidence = Number.isFinite(result.confidence) ? `信頼度 ${result.confidence}%` : "信頼度 —";
    meta.textContent = [
      `${result.source.width.toLocaleString("ja-JP")} × ${result.source.height.toLocaleString("ja-JP")} px`,
      confidence,
      `${result.candidateCount}候補`,
      core.formatDuration(result.durationMs),
    ].join("・");
    titleBlock.append(heading, meta);
    const badge = document.createElement("span");
    badge.className = result.status === "success" ? "badge badge--safe" : "badge badge--warning";
    badge.textContent = result.status === "success" ? "完了" : "文字なし";
    head.append(titleBlock, badge);
    const pre = document.createElement("pre");
    pre.textContent = result.text || "（文字を検出できませんでした）";
    article.append(head, pre);
    return article;
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
        // file:// may expose Clipboard API but reject it; use the local fallback.
      }
    }
    elements.resultText.focus();
    elements.resultText.select();
    try {
      if (!document.execCommand("copy")) throw new Error("COPY_FAILED");
      showToast("認識結果をコピーしました。", "success");
    } catch {
      showToast("自動コピーできませんでした。選択中の文字をCtrl + Cでコピーしてください。", "warning", 5600);
    }
  }

  function downloadTextResult() {
    const text = elements.resultText.value;
    if (!text) return;
    downloadBlob(
      new Blob(["\ufeff", text], { type: "text/plain;charset=utf-8" }),
      `${resultBaseName()}_ocr.txt`,
    );
    state.resultTextDirty = false;
  }

  function downloadJsonResult() {
    if (state.results.length === 0) return;
    const payload = {
      format: "scanscribe-image-ocr-result",
      version: 1,
      applicationVariant: {
        id: VARIANT.id,
        label: VARIANT.label,
        modelVariant: VARIANT.modelVariant,
      },
      createdAt: new Date().toISOString(),
      offline: true,
      combinedText: elements.resultText.value,
      combinedTextEdited: state.resultTextEdited,
      totalElapsedMs: state.totalElapsedMs,
      results: state.results.map((result) => ({
        sequence: result.sequence,
        status: result.status,
        text: result.text,
        rawText: result.rawText,
        confidence: result.confidence,
        selectedVariant: result.selectedVariant,
        selectedPassLabel: result.selectedPassLabel,
        comparisonScore: result.comparisonScore,
        agreement: result.agreement,
        consensusApplied: result.consensusApplied,
        disagreementCount: result.disagreementCount,
        candidateCount: result.candidateCount,
        plannedPassCount: result.plannedPassCount,
        attemptedPassCount: result.attemptedPassCount,
        failedPassCount: result.failedPassCount,
        replacements: result.replacements,
        correctionErrorCode: result.correctionErrorCode,
        actualScale: result.actualScale,
        actualDpi: result.actualDpi,
        padding: result.padding,
        darkBackground: result.darkBackground,
        deskew: result.deskew,
        durationMs: result.durationMs,
        source: result.source,
        dictionary: result.dictionary,
        settings: result.settings,
        candidates: result.candidates,
      })),
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
      `${resultBaseName()}_ocr.json`,
    );
    state.resultTextDirty = false;
  }

  function resultBaseName() {
    const firstName = state.results[0]?.source?.name || "snipping";
    const base = imageCore.sanitizeImageBaseName(firstName);
    return state.results.length > 1 ? `${base}_and_${state.results.length}_images` : base;
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

  function clearAllResults() {
    if (isBusy() || state.results.length === 0) return;
    if (state.resultTextDirty && !root.confirm("文字起こし結果をすべてクリアしますか？")) return;
    state.results = [];
    state.nextSequence = 1;
    state.resultTextDirty = false;
    state.resultTextEdited = false;
    state.totalElapsedMs = 0;
    if (state.source) state.source.recognizedCount = 0;
    elements.resultText.value = "";
    elements.resultStats.replaceChildren();
    elements.imageResultList.replaceChildren();
    elements.resultPanel.hidden = true;
    updateCharacterCount();
    updateUi();
    showToast("文字起こし結果をクリアしました。", "success");
    elements.pasteButton.focus();
  }

  function setControlsLocked(locked) {
    state.controlsLocked = locked;
    const controls = [
      elements.imageFile,
      elements.pasteButton,
      elements.imageSelectButton,
      elements.sampleButton,
      elements.autoRunAfterPaste,
      elements.removeImageButton,
      elements.ocrLanguage,
      elements.imageScale,
      elements.pageLayout,
      elements.compareVariants,
      elements.autoRotate,
      elements.dictionaryFile,
      elements.dictionarySelectButton,
      elements.removeDictionaryButton,
      elements.clearResultsButton,
      elements.resultText,
    ];
    for (const control of controls) control.disabled = locked;
    elements.dropZone.setAttribute("aria-disabled", String(locked));
    updateUi();
  }

  function updateUi() {
    const source = state.source;
    const busy = isBusy() || state.controlsLocked;
    const inputUnavailable = !state.compatible || busy;
    for (const control of [
      elements.imageFile,
      elements.pasteButton,
      elements.imageSelectButton,
      elements.sampleButton,
      elements.autoRunAfterPaste,
      elements.ocrLanguage,
      elements.imageScale,
      elements.pageLayout,
      elements.compareVariants,
      elements.autoRotate,
      elements.dictionaryFile,
      elements.dictionarySelectButton,
    ]) {
      control.disabled = inputUnavailable;
    }
    elements.removeImageButton.disabled = !source || busy;
    elements.removeDictionaryButton.disabled = !state.dictionary || busy;
    elements.dropZone.setAttribute("aria-disabled", String(inputUnavailable));
    elements.imageSummary.hidden = !source;
    elements.previewFigure.hidden = !source;
    elements.settingsPanel.hidden = !source;
    elements.smallImageNotice.hidden = !source
      || !(source.meta.width < 360 || source.meta.height < 100);
    if (source) {
      elements.imageName.textContent = source.meta.name;
      const methodLabels = {
        clipboard: "Ctrl + V",
        "clipboard-button": "クリップボード",
        drop: "ドロップ",
        file: "ファイル",
        sample: "サンプル",
      };
      elements.imageMeta.textContent = [
        `${source.meta.width.toLocaleString("ja-JP")} × ${source.meta.height.toLocaleString("ja-JP")} px`,
        imageCore.formatBytes(source.meta.bytes),
        methodLabels[source.meta.inputMethod] || "画像",
      ].join("・");
      const requestedScale = Number(elements.imageScale.value);
      const actualScale = imageCore.calculateOcrScale(
        source.meta.width,
        source.meta.height,
        requestedScale,
        VARIANT.ocrContentMaxPixels,
        VARIANT.ocrContentMaxDimension,
      );
      const scaleSummary = actualScale < requestedScale - 0.01
        ? `画像全体を約${actualScale.toFixed(2)}倍で読み取ります（上限に合わせて自動調整）`
        : `画像全体を${actualScale.toFixed(actualScale % 1 === 0 ? 0 : 1)}倍で読み取ります`;
      elements.ocrSummary.textContent = source.recognizedCount > 0
        ? `この画像は追加済みです。もう一度追加する場合は再実行してください（${scaleSummary}）。`
        : scaleSummary;
      elements.startButtonLabel.textContent = source.recognizedCount > 0
        ? "同じ画像をもう一度OCRして追加"
        : "画像全体をOCRして追加";
    }
    elements.startButton.disabled = !(
      state.compatible
      && source
      && state.mode === "ready"
      && !busy
      && !state.dictionaryLoading
    );
    elements.copyButton.disabled = !elements.resultText.value || busy;
    elements.downloadTextButton.disabled = !elements.resultText.value || busy;
    elements.downloadJsonButton.disabled = state.results.length === 0 || busy;
    elements.clearResultsButton.disabled = state.results.length === 0 || busy;
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

  function showToast(message, kind = "info", duration = 3600) {
    root.clearTimeout(toastTimer);
    const token = ++toastToken;
    elements.toast.textContent = "";
    elements.toast.dataset.kind = kind;
    elements.toast.hidden = false;
    root.requestAnimationFrame(() => {
      if (token === toastToken) elements.toast.textContent = message;
    });
    toastTimer = root.setTimeout(() => {
      if (token === toastToken) elements.toast.hidden = true;
    }, duration);
  }

  function announce(message, urgent = false) {
    elements.liveRegion.setAttribute("aria-live", urgent ? "assertive" : "polite");
    elements.liveRegion.textContent = "";
    root.requestAnimationFrame(() => {
      elements.liveRegion.textContent = message;
    });
  }

  function toUserError(error, fallback) {
    if (error instanceof imageCore.ImageInputError || error instanceof core.OcrInputError) {
      return error.message;
    }
    if (error instanceof OperationTimeoutError) {
      return `${error.label}が制限時間内に終わりませんでした。画像を小さくするか、画像補正を外して再実行してください。`;
    }
    const name = String(error?.name || "");
    const message = String(error?.message || error || "");
    if (/decode|encoding|image|bitmap/i.test(`${name} ${message}`)) {
      return "画像が壊れているか、対応していない形式です。PNGで保存し直してください。";
    }
    if (/memory|allocation|out of bounds|canvas/i.test(message)) {
      return "画像を処理するメモリが不足しました。読み取りサイズを原寸に下げてください。";
    }
    if (/SecurityError|Worker|tesseract|recogn/i.test(`${name} ${message}`)) {
      return "OCR機能を起動できませんでした。EdgeまたはChromeで単一HTMLを直接開き直してください。";
    }
    return fallback;
  }
})(window, document);
