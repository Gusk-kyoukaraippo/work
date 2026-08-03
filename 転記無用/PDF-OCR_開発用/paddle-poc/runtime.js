(function paddleOfflinePoc() {
  "use strict";

  const state = {
    worker: null,
    pending: new Map(),
    nextRequestId: 1,
    objectUrls: [],
    initialized: false,
  };

  const elements = {
    status: document.getElementById("status"),
    detail: document.getElementById("detail"),
    output: document.getElementById("output"),
    metrics: document.getElementById("metrics"),
    log: document.getElementById("log"),
    runSample: document.getElementById("runSample"),
    imageFile: document.getElementById("imageFile"),
    preview: document.getElementById("preview"),
  };

  // The document itself never needs fetch. The Paddle worker gets a stricter
  // wrapper which permits only the blob: URLs created from embedded bytes.
  globalThis.fetch = () => Promise.reject(new TypeError("Network access is disabled."));
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource", "WebTransport"] ) {
    if (name in globalThis) {
      globalThis[name] = class DisabledNetworkApi {
        constructor() {
          throw new DOMException("Network access is disabled.", "SecurityError");
        }
      };
    }
  }

  function setStatus(title, detail) {
    elements.status.textContent = title;
    elements.detail.textContent = detail || "";
  }

  function appendLog(message) {
    const line = document.createElement("div");
    line.textContent = String(message);
    elements.log.append(line);
  }

  function decodeBase64Element(id, type) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing embedded asset: ${id}`);
    const source = element.textContent.replace(/\s+/g, "");
    const parts = [];
    // Multiple of four, small enough to avoid retaining a second giant binary string.
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0; offset < source.length; offset += chunkSize) {
      const binary = atob(source.slice(offset, offset + chunkSize));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      parts.push(bytes);
    }
    element.remove();
    return new Blob(parts, { type });
  }

  function createTrackedUrl(blob) {
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    return url;
  }

  function workerGuardSource() {
    return `
      const __paddlePocFetch = self.fetch.bind(self);
      self.fetch = (input, init) => {
        const raw = typeof input === "string" || input instanceof URL
          ? String(input)
          : String(input && input.url || "");
        let parsed;
        try { parsed = new URL(raw); } catch {
          return Promise.reject(new TypeError("Only embedded blob assets are allowed."));
        }
        if (parsed.protocol !== "blob:") {
          return Promise.reject(new TypeError("Network access is disabled: " + parsed.protocol));
        }
        return __paddlePocFetch(input, init);
      };
      if (self.XMLHttpRequest && self.XMLHttpRequest.prototype) {
        self.XMLHttpRequest.prototype.open = function () {
          throw new DOMException("XMLHttpRequest is disabled.", "SecurityError");
        };
      }
      for (const name of ["WebSocket", "EventSource", "WebTransport", "SharedWorker"]) {
        if (name in self) self[name] = class DisabledNetworkApi {
          constructor() { throw new DOMException("Network access is disabled.", "SecurityError"); }
        };
      }
    `;
  }

  function createPaddleWorker() {
    const sourceElement = document.getElementById("asset-paddle-worker");
    if (!sourceElement) throw new Error("Missing embedded Paddle worker source.");
    const source = `${workerGuardSource()}\n${sourceElement.textContent}`;
    sourceElement.remove();
    const workerUrl = createTrackedUrl(new Blob([source], { type: "text/javascript" }));
    // Chrome rejects a blob: module worker created by a file: document because
    // the document has an opaque origin. build.mjs converts the self-contained
    // upstream worker to classic-worker syntax after verifying its source SHA.
    const worker = new Worker(workerUrl, { name: "paddle-offline-poc" });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
      const location = [event.filename, event.lineno, event.colno].filter(Boolean).join(":");
      const error = new Error(
        `${event.message || "Paddle worker failed."}${location ? ` (${location})` : ""}`,
      );
      appendLog(`worker error: ${error.message}`);
      failAllPending(error);
    });
    worker.addEventListener("messageerror", () => {
      failAllPending(new Error("Paddle worker returned an unreadable message."));
    });
    return worker;
  }

  function handleWorkerMessage(event) {
    const message = event.data;
    if (!message || message.kind !== "worker-transport-response") return;
    const pending = state.pending.get(message.requestId);
    if (!pending) return;
    state.pending.delete(message.requestId);
    if (message.status === "success") {
      pending.resolve(message.payload);
      return;
    }
    const error = new Error(message.error && message.error.message || "Paddle worker error.");
    error.name = message.error && message.error.name || "Error";
    if (message.error && message.error.stack) error.stack = message.error.stack;
    pending.reject(error);
  }

  function failAllPending(error) {
    for (const pending of state.pending.values()) pending.reject(error);
    state.pending.clear();
  }

  function request(type, payload, transferables) {
    const requestId = state.nextRequestId;
    state.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      state.pending.set(requestId, { resolve, reject });
      state.worker.postMessage({
        kind: "worker-transport-request",
        type,
        payload,
        requestId,
      }, transferables || []);
    });
  }

  function createPipelineConfig(detUrl, recUrl) {
    return {
      pipelineName: "OCR",
      raw: {},
      warnings: [],
      unsupportedFeatures: [],
      modelSelection: {
        textDetectionModelName: "PP-OCRv6_small_det",
        textRecognitionModelName: "PP-OCRv6_small_rec",
      },
      assets: {
        det: { url: detUrl },
        rec: { url: recUrl },
      },
      runtimeDefaults: {
        text_det_limit_side_len: 960,
        text_det_limit_type: "max",
        text_det_max_side_limit: 4000,
        text_det_thresh: 0.3,
        text_det_box_thresh: 0.6,
        text_det_unclip_ratio: 2.0,
        text_rec_score_thresh: 0,
      },
      pipelineBatchSize: 1,
      textDetectionBatchSize: 1,
      textRecognitionBatchSize: 1,
    };
  }

  async function initialize() {
    if (state.initialized) return;
    setStatus("埋込資産を準備中", "Base64を分割デコードしています");
    appendLog(`document protocol: ${location.protocol}`);
    appendLog(`secure context: ${String(isSecureContext)}`);
    appendLog(`crossOriginIsolated: ${String(crossOriginIsolated)}`);

    const ortWasmUrl = createTrackedUrl(decodeBase64Element(
      "asset-ort-wasm",
      "application/wasm",
    ));
    const detUrl = createTrackedUrl(decodeBase64Element(
      "asset-paddle-det",
      "application/x-tar",
    ));
    const recUrl = createTrackedUrl(decodeBase64Element(
      "asset-paddle-rec",
      "application/x-tar",
    ));

    state.worker = createPaddleWorker();
    setStatus("PP-OCRv6 smallを初期化中", "埋込モデルからONNXセッションを作成しています");
    const startedAt = performance.now();
    const summary = await request("init", {
      options: {
        pipelineConfig: createPipelineConfig(detUrl, recUrl),
        ortOptions: {
          backend: "wasm",
          numThreads: 1,
          simd: true,
          proxy: false,
          disableWasmProxy: true,
          // ORT 1.22 accepts a per-resource object. The worker bundle already
          // embeds the matching .mjs glue; only its stripped WASM is supplied.
          wasmPaths: { wasm: ortWasmUrl },
        },
      },
    });
    state.initialized = true;
    appendLog(`init: ${Math.round(performance.now() - startedAt)} ms`);
    appendLog(`provider: det=${summary.detProvider}, rec=${summary.recProvider}`);
    appendLog(`worker assets: ${summary.assets.map((asset) => asset.bytes).join(", ")} bytes`);
  }

  async function blobToPreview(blob) {
    const url = createTrackedUrl(blob);
    elements.preview.src = url;
    elements.preview.hidden = false;
  }

  async function recognize(blob, sourceLabel) {
    elements.runSample.disabled = true;
    elements.imageFile.disabled = true;
    elements.output.value = "";
    elements.metrics.textContent = "";
    try {
      await initialize();
      await blobToPreview(blob);
      setStatus("認識中", sourceLabel);
      const bitmap = await createImageBitmap(blob);
      const startedAt = performance.now();
      const results = await request("predict", {
        sources: [{ kind: "imageBitmap", imageBitmap: bitmap }],
        params: {},
      }, [bitmap]);
      const result = results[0];
      const text = result.items.map((item) => item.text).join("\n");
      elements.output.value = text;
      elements.metrics.textContent = JSON.stringify({
        runtime: result.runtime,
        metrics: result.metrics,
        wallMs: Math.round(performance.now() - startedAt),
        items: result.items,
      }, null, 2);
      setStatus("認識完了", `${result.items.length}行を検出しました`);
      window.__PADDLE_POC_RESULT__ = {
        status: "success",
        text,
        items: result.items,
        runtime: result.runtime,
        metrics: result.metrics,
      };
      console.log("PADDLE_POC_SUCCESS", window.__PADDLE_POC_RESULT__);
    } catch (error) {
      const message = error && error.stack || String(error);
      setStatus("認識失敗", error && error.message || String(error));
      elements.metrics.textContent = message;
      window.__PADDLE_POC_RESULT__ = { status: "failed", error: message };
      console.error("PADDLE_POC_FAILURE", error);
    } finally {
      elements.runSample.disabled = false;
      elements.imageFile.disabled = false;
    }
  }

  function embeddedSampleBlob() {
    return decodeBase64Element("asset-sample", "image/png");
  }

  let sampleBlob = null;
  elements.runSample.addEventListener("click", () => {
    if (!sampleBlob) sampleBlob = embeddedSampleBlob();
    void recognize(sampleBlob, "同梱した日本語固定画像");
  });
  elements.imageFile.addEventListener("change", () => {
    const file = elements.imageFile.files && elements.imageFile.files[0];
    if (file) void recognize(file, file.name);
  });

  addEventListener("beforeunload", () => {
    try { state.worker && state.worker.terminate(); } catch {}
    for (const url of state.objectUrls) URL.revokeObjectURL(url);
  });

  window.__PADDLE_POC_RESULT__ = { status: "ready" };
  // Auto-run makes headless and manual verification use the same path.
  elements.runSample.click();
})();
