#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const htmlPath = join(projectDirectory, "ScanScribe-light.html");
const DEFAULT_SMOKE_TIMEOUT_MS = 180_000;
const CHROME_START_TIMEOUT_MS = 20_000;
const CDP_COMMAND_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const MAX_DIAGNOSTIC_CHARS = 32_000;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

const smokeTimeoutMs = parsePositiveInteger(
  process.env.SCANSCRIBE_BROWSER_TIMEOUT_MS,
  DEFAULT_SMOKE_TIMEOUT_MS,
  "SCANSCRIBE_BROWSER_TIMEOUT_MS",
);

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function elapsedSeconds(startedAt, endedAt = performance.now()) {
  return ((endedAt - startedAt) / 1000).toFixed(2);
}

function truncate(value, maximum = 1_000) {
  const string = String(value ?? "");
  return string.length <= maximum ? string : `${string.slice(0, maximum)}…`;
}

async function isExecutable(candidate) {
  try {
    const candidateStats = await stat(candidate);
    if (!candidateStats.isFile()) return false;
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const configured = process.env.SCANSCRIBE_CHROME_PATH;
  if (configured) {
    const explicitPath = resolve(configured);
    if (!await isExecutable(explicitPath)) {
      throw new Error(
        `SCANSCRIBE_CHROME_PATH is not an executable file: ${explicitPath}`,
      );
    }
    return explicitPath;
  }

  const applicationNames = [
    "Google Chrome.app/Contents/MacOS/Google Chrome",
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "Chromium.app/Contents/MacOS/Chromium",
  ];
  const absoluteCandidates = [
    ...applicationNames.map((name) => join("/Applications", name)),
    ...applicationNames.map((name) => join(homedir(), "Applications", name)),
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  const executableNames = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ];
  const pathCandidates = (process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => executableNames.map((name) => join(directory, name)));

  for (const candidate of [...new Set([...absoluteCandidates, ...pathCandidates])]) {
    if (await isExecutable(candidate)) return candidate;
  }

  throw new Error(
    "Chrome/Chromium was not found. Set SCANSCRIBE_CHROME_PATH to an executable "
    + "Google Chrome, Chrome for Testing, or Chromium binary.",
  );
}

function appendDiagnostic(current, chunk) {
  const combined = `${current}${String(chunk)}`;
  return combined.length <= MAX_DIAGNOSTIC_CHARS
    ? combined
    : combined.slice(combined.length - MAX_DIAGNOSTIC_CHARS);
}

async function waitForDevToolsPort(profileDirectory, browserProcess, getBrowserOutput) {
  const activePortPath = join(profileDirectory, "DevToolsActivePort");
  const deadline = performance.now() + CHROME_START_TIMEOUT_MS;
  let lastError;

  while (performance.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(
        `Chrome exited before DevTools became available (exit ${browserProcess.exitCode}).\n`
        + truncate(getBrowserOutput(), 4_000),
      );
    }
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
      lastError = new Error(`Invalid DevToolsActivePort content: ${JSON.stringify(portLine)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }

  throw new Error(
    `Chrome DevTools did not start within ${CHROME_START_TIMEOUT_MS} ms. `
    + `${lastError?.message || "DevToolsActivePort was not created."}\n`
    + truncate(getBrowserOutput(), 4_000),
  );
}

async function fetchJson(url, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForPageTarget(port, browserProcess) {
  const deadline = performance.now() + CHROME_START_TIMEOUT_MS;
  let lastError;
  while (performance.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chrome exited while waiting for a debuggable page target.`);
    }
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => (
        target.type === "page" && target.webSocketDebuggerUrl
      ));
      if (page) return page;
      lastError = new Error("DevTools returned no page target.");
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `A Chrome page target was not available within ${CHROME_START_TIMEOUT_MS} ms: `
    + `${lastError?.message || "unknown error"}`,
  );
}

class CdpWebSocket {
  constructor(url) {
    this.url = new URL(url);
    if (this.url.protocol !== "ws:") {
      throw new Error(`Only local ws:// DevTools endpoints are supported: ${url}`);
    }
    this.socket = null;
    this.connected = false;
    this.closing = false;
    this.handshakeBuffer = Buffer.alloc(0);
    this.frameBuffer = Buffer.alloc(0);
    this.fragmentOpcode = null;
    this.fragmentChunks = [];
    this.nextCommandId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.listenerErrors = [];
    this.connectResolve = null;
    this.connectReject = null;
    this.websocketKey = randomBytes(16).toString("base64");
  }

  async connect(timeoutMs = CHROME_START_TIMEOUT_MS) {
    const port = Number(this.url.port || 80);
    this.socket = createConnection({ host: this.url.hostname, port });
    this.socket.on("data", (chunk) => this.handleSocketData(chunk));
    this.socket.on("error", (error) => this.handleSocketFailure(error));
    this.socket.on("close", () => this.handleSocketClose());

    const connection = new Promise((resolveConnection, rejectConnection) => {
      this.connectResolve = resolveConnection;
      this.connectReject = rejectConnection;
    });
    const timeout = setTimeout(() => {
      this.handleSocketFailure(new Error(`DevTools WebSocket handshake timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    this.socket.once("connect", () => {
      const request = [
        `GET ${this.url.pathname}${this.url.search} HTTP/1.1`,
        `Host: ${this.url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${this.websocketKey}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n");
      this.socket.write(request, "ascii");
    });

    try {
      await connection;
    } finally {
      clearTimeout(timeout);
      this.connectResolve = null;
      this.connectReject = null;
    }
  }

  on(method, listener) {
    const methodListeners = this.listeners.get(method) || new Set();
    methodListeners.add(listener);
    this.listeners.set(method, methodListeners);
    return () => methodListeners.delete(listener);
  }

  async send(method, params = {}, sessionId = undefined, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    if (!this.connected || !this.socket || this.closing) {
      throw new Error(`Cannot send ${method}: DevTools WebSocket is not connected.`);
    }
    const id = this.nextCommandId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    const response = new Promise((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectResponse(new Error(`CDP command ${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolveResponse(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectResponse(error);
        },
      });
    });

    this.writeFrame(0x1, Buffer.from(JSON.stringify(message), "utf8"));
    return response;
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.connected = false;
    if (this.socket && !this.socket.destroyed) this.socket.end();
    this.rejectPending(new Error("DevTools WebSocket closed."));
  }

  handleSocketData(chunk) {
    if (!this.connected) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
      const headerEnd = this.handshakeBuffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;

      const header = this.handshakeBuffer.subarray(0, headerEnd).toString("latin1");
      const remaining = this.handshakeBuffer.subarray(headerEnd + 4);
      this.handshakeBuffer = Buffer.alloc(0);
      const lines = header.split("\r\n");
      if (!/^HTTP\/1\.[01] 101\b/.test(lines[0])) {
        this.handleSocketFailure(new Error(`DevTools WebSocket upgrade failed: ${lines[0]}`));
        return;
      }
      const headers = new Map(lines.slice(1).map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
      }));
      const expectedAccept = createHash("sha1")
        .update(`${this.websocketKey}${WEBSOCKET_GUID}`, "ascii")
        .digest("base64");
      if (headers.get("sec-websocket-accept") !== expectedAccept) {
        this.handleSocketFailure(new Error("DevTools WebSocket returned an invalid accept key."));
        return;
      }
      this.connected = true;
      this.connectResolve?.();
      if (remaining.length > 0) this.consumeFrames(remaining);
      return;
    }
    this.consumeFrames(chunk);
  }

  consumeFrames(chunk) {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    while (this.frameBuffer.length >= 2) {
      const first = this.frameBuffer[0];
      const second = this.frameBuffer[1];
      const final = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let payloadLength = second & 0x7f;
      let offset = 2;

      if (first & 0x70) {
        this.handleSocketFailure(new Error("Compressed/reserved WebSocket frames are unsupported."));
        return;
      }
      if (payloadLength === 126) {
        if (this.frameBuffer.length < offset + 2) return;
        payloadLength = this.frameBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.frameBuffer.length < offset + 8) return;
        const extendedLength = this.frameBuffer.readBigUInt64BE(offset);
        if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.handleSocketFailure(new Error("DevTools WebSocket frame is too large."));
          return;
        }
        payloadLength = Number(extendedLength);
        offset += 8;
      }

      let mask;
      if (masked) {
        if (this.frameBuffer.length < offset + 4) return;
        mask = this.frameBuffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.frameBuffer.length < offset + payloadLength) return;

      const payload = Buffer.from(this.frameBuffer.subarray(offset, offset + payloadLength));
      this.frameBuffer = this.frameBuffer.subarray(offset + payloadLength);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      this.handleFrame(opcode, final, payload);
    }
  }

  handleFrame(opcode, final, payload) {
    if (opcode === 0x8) {
      this.close();
      return;
    }
    if (opcode === 0x9) {
      this.writeFrame(0xA, payload);
      return;
    }
    if (opcode === 0xA) return;

    if (opcode === 0x0) {
      if (this.fragmentOpcode === null) {
        this.handleSocketFailure(new Error("Unexpected continuation WebSocket frame."));
        return;
      }
      this.fragmentChunks.push(payload);
      if (final) {
        const completeOpcode = this.fragmentOpcode;
        const completePayload = Buffer.concat(this.fragmentChunks);
        this.fragmentOpcode = null;
        this.fragmentChunks = [];
        this.handleCompleteFrame(completeOpcode, completePayload);
      }
      return;
    }

    if (opcode !== 0x1 && opcode !== 0x2) {
      this.handleSocketFailure(new Error(`Unsupported WebSocket opcode ${opcode}.`));
      return;
    }
    if (!final) {
      if (this.fragmentOpcode !== null) {
        this.handleSocketFailure(new Error("Nested fragmented WebSocket message."));
        return;
      }
      this.fragmentOpcode = opcode;
      this.fragmentChunks = [payload];
      return;
    }
    this.handleCompleteFrame(opcode, payload);
  }

  handleCompleteFrame(opcode, payload) {
    if (opcode !== 0x1) {
      this.handleSocketFailure(new Error("Unexpected binary message from DevTools."));
      return;
    }
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch (error) {
      this.handleSocketFailure(new Error(`Invalid DevTools JSON: ${error.message}`));
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(
          `${pending.method} failed (${message.error.code}): ${message.error.message}`,
        ));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }

    const methodListeners = this.listeners.get(message.method);
    if (!methodListeners) return;
    for (const listener of methodListeners) {
      try {
        const listenerResult = listener(message.params || {}, message);
        if (listenerResult && typeof listenerResult.catch === "function") {
          listenerResult.catch((error) => this.listenerErrors.push(error));
        }
      } catch (error) {
        this.listenerErrors.push(error);
      }
    }
  }

  writeFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return;
    const mask = randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | payload.length;
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    header[0] = 0x80 | opcode;
    const maskedPayload = Buffer.allocUnsafe(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      maskedPayload[index] = payload[index] ^ mask[index % 4];
    }
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }

  handleSocketFailure(error) {
    if (this.closing) return;
    this.closing = true;
    this.connected = false;
    this.connectReject?.(error);
    this.rejectPending(error);
    this.socket?.destroy();
  }

  handleSocketClose() {
    const wasClosing = this.closing;
    this.closing = true;
    this.connected = false;
    if (!wasClosing) {
      const error = new Error("DevTools WebSocket closed unexpectedly.");
      this.connectReject?.(error);
      this.rejectPending(error);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || "unknown evaluation error";
    throw new Error(`Browser evaluation failed: ${description}`);
  }
  return response.result?.value;
}

async function waitUntil(label, timeoutMs, predicate) {
  const deadline = performance.now() + timeoutMs;
  let lastError;
  while (performance.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out after ${timeoutMs} ms waiting for ${label}`
    + `${lastError ? `: ${lastError.message}` : "."}`,
  );
}

function remoteObjectText(object) {
  if (Object.hasOwn(object, "value")) {
    try {
      return typeof object.value === "string" ? object.value : JSON.stringify(object.value);
    } catch {
      return String(object.value);
    }
  }
  return object.description || object.unserializableValue || object.type || "unknown";
}

async function stopBrowser(browserProcess) {
  if (!browserProcess || browserProcess.exitCode !== null) return;
  browserProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => browserProcess.once("exit", resolveExit)),
    delay(5_000),
  ]);
  if (browserProcess.exitCode === null) browserProcess.kill("SIGKILL");
}

let browserProcess;
let profileDirectory;
let downloadDirectory;
let cdp;
let browserOutput = "";
const consoleDiagnostics = [];
const exceptionDiagnostics = [];
const sessionDiagnostics = [];
const observedRequests = [];
const outboundRequests = [];
let cleanedUp = false;

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  cdp?.close();
  await stopBrowser(browserProcess);
  if (profileDirectory) {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => {
      process.kill(process.pid, signal);
    });
  });
}

try {
  await access(htmlPath, fsConstants.R_OK);
  const chromePath = await findChrome();
  profileDirectory = await mkdtemp(join(tmpdir(), "scanscribe-browser-smoke-"));
  const chromeArguments = [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-sync",
    "--metrics-recording-only",
    "--safebrowsing-disable-auto-update",
    "--password-store=basic",
    "--use-mock-keychain",
    "--window-size=1400,1200",
    "about:blank",
  ];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    chromeArguments.unshift("--no-sandbox");
  }

  const totalStartedAt = performance.now();
  browserProcess = spawn(chromePath, chromeArguments, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  browserProcess.on("error", (error) => {
    browserOutput = appendDiagnostic(browserOutput, `Chrome process error: ${error.stack || error}\n`);
  });
  browserProcess.stdout.on("data", (chunk) => {
    browserOutput = appendDiagnostic(browserOutput, chunk);
  });
  browserProcess.stderr.on("data", (chunk) => {
    browserOutput = appendDiagnostic(browserOutput, chunk);
  });

  const port = await waitForDevToolsPort(
    profileDirectory,
    browserProcess,
    () => browserOutput,
  );
  const pageTarget = await waitForPageTarget(port, browserProcess);
  cdp = new CdpWebSocket(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  const recordRequest = (url, kind, message) => {
    if (!url) return;
    const entry = {
      kind,
      url,
      sessionId: message.sessionId || null,
    };
    observedRequests.push(entry);
    if (/^(?:https?|wss?):/i.test(url)) outboundRequests.push(entry);
  };
  cdp.on("Network.requestWillBeSent", (params, message) => {
    recordRequest(params.request?.url, params.type || "request", message);
  });
  cdp.on("Network.webSocketCreated", (params, message) => {
    recordRequest(params.url, "websocket", message);
  });
  cdp.on("Runtime.consoleAPICalled", (params, message) => {
    consoleDiagnostics.push({
      type: params.type,
      text: (params.args || []).map(remoteObjectText).join(" "),
      sessionId: message.sessionId || null,
    });
  });
  cdp.on("Runtime.exceptionThrown", (params, message) => {
    const details = params.exceptionDetails || {};
    exceptionDiagnostics.push({
      text: details.exception?.description || details.text || "Unknown runtime exception",
      url: details.url || "",
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
      sessionId: message.sessionId || null,
    });
  });
  cdp.on("Target.attachedToTarget", (params) => {
    const sessionId = params.sessionId;
    const initializeSession = async () => {
      try {
        await Promise.all([
          cdp.send("Network.enable", {}, sessionId),
          cdp.send("Runtime.enable", {}, sessionId),
        ]);
      } catch (error) {
        sessionDiagnostics.push(
          `${params.targetInfo?.type || "target"} ${params.targetInfo?.url || ""}: ${error.message}`,
        );
      } finally {
        try {
          await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
        } catch (error) {
          sessionDiagnostics.push(
            `Could not resume ${params.targetInfo?.type || "target"}: ${error.message}`,
          );
        }
      }
    };
    void initializeSession();
  });

  await Promise.all([
    cdp.send("Network.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Page.enable"),
  ]);
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });
  const browserVersion = await cdp.send("Browser.getVersion");
  downloadDirectory = join(profileDirectory, "downloads");
  await mkdir(downloadDirectory);
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDirectory,
    eventsEnabled: true,
  });

  const navigationStartedAt = performance.now();
  const navigation = await cdp.send("Page.navigate", {
    url: pathToFileURL(htmlPath).href,
  });
  if (navigation.errorText) {
    throw new Error(`Chrome could not open ${htmlPath}: ${navigation.errorText}`);
  }
  await waitUntil("the generated app to finish loading", 30_000, async () => (
    await evaluate(cdp, `
      document.readyState === "complete"
      && Boolean(document.getElementById("sampleButton"))
      && document.documentElement.dataset.singleFile === "true"
    `)
  ));
  const navigationFinishedAt = performance.now();

  const compatibility = await evaluate(cdp, `(() => ({
    noticeHidden: document.getElementById("compatibilityNotice").hidden,
    noticeText: document.getElementById("compatibilityMessage").textContent.trim(),
    protocol: location.protocol,
    variant: document.documentElement.dataset.variant,
  }))()`);
  assert.equal(compatibility.protocol, "file:", "generated app runs through file://");
  assert.equal(compatibility.variant, "light", "generated light variant is loaded");
  assert.equal(
    compatibility.noticeHidden,
    true,
    `compatibility notice must remain hidden: ${compatibility.noticeText}`,
  );

  const sampleStartedAt = performance.now();
  await evaluate(cdp, `document.getElementById("sampleButton").click()`);
  await waitUntil("the sample preview and OCR start button", 45_000, async () => (
    await evaluate(cdp, `
      !document.getElementById("previewFigure").hidden
      && !document.getElementById("startButton").disabled
      && !document.getElementById("selectionBox").hidden
    `)
  ));
  const sampleFinishedAt = performance.now();

  const ocrStartedAt = performance.now();
  await evaluate(cdp, `document.getElementById("startButton").click()`);
  await waitUntil("the OCR result panel", smokeTimeoutMs, async () => (
    await evaluate(cdp, `!document.getElementById("resultPanel").hidden`)
  ));
  const ocrFinishedAt = performance.now();
  const resultText = await evaluate(
    cdp,
    `document.getElementById("resultText").value.trim()`,
  );
  assert.ok(resultText, "OCR result text must not be empty");
  const compactResult = resultText.normalize("NFKC").replace(/[\s,]+/g, "");
  assert.match(compactResult, /完全オフライン文字認識/, "representative Japanese text is recognized");
  assert.match(compactResult, /LOCALOCRSAMPLE/i, "representative English text is recognized");
  assert.match(compactResult, /12345/, "representative digits are recognized");

  await evaluate(cdp, `document.getElementById("downloadJsonButton").click()`);
  let historyPath;
  await waitUntil("the exported JSON history download", 15_000, async () => {
    const names = await readdir(downloadDirectory);
    const complete = names.find((name) => name.endsWith(".json"));
    const partial = names.some((name) => name.endsWith(".crdownload"));
    if (!complete || partial) return false;
    historyPath = join(downloadDirectory, complete);
    return true;
  });
  const exportedHistory = JSON.parse(await readFile(historyPath, "utf8"));
  assert.equal(exportedHistory.format, "scanscribe-region-ocr-result");
  assert.equal(exportedHistory.version, 3);
  assert.equal(exportedHistory.results.length, 1);
  const importedEditMarker = "SCANSCRIBE_BROWSER_RESUME_EDIT";
  exportedHistory.combinedText = `${exportedHistory.combinedText}\n\n${importedEditMarker}`;
  exportedHistory.combinedTextEdited = true;
  const historyBase64 = Buffer.from(JSON.stringify(exportedHistory), "utf8").toString("base64");
  await evaluate(cdp, `(() => {
    const binary = atob(${JSON.stringify(historyBase64)});
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const historyFile = new File([bytes], "browser-smoke-history.json", {
      type: "application/json",
    });
    const transfer = new DataTransfer();
    transfer.items.add(historyFile);
    const input = document.getElementById("historyFile");
    input.files = transfer.files;
    window.confirm = () => true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitUntil("the imported JSON history", 15_000, async () => (
    await evaluate(cdp, `
      document.getElementById("resultText").value.includes(${JSON.stringify(importedEditMarker)})
      && document.getElementById("historyError").textContent === ""
      && document.getElementById("pageResultList").children.length === 1
    `)
  ));

  const clipboardFallback = await evaluate(cdp, `(async () => {
    const calls = [];
    const originalExecCommand = document.execCommand;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("simulated file permission denial")) },
    });
    document.execCommand = (command) => {
      calls.push(command);
      return command === "copy";
    };
    document.getElementById("copyButton").click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    delete navigator.clipboard;
    document.execCommand = originalExecCommand;
    return {
      calls,
      toast: document.getElementById("toast").textContent,
    };
  })()`);
  assert.deepEqual(
    clipboardFallback.calls,
    ["copy"],
    "execCommand is attempted when the exposed Clipboard API rejects file:// access",
  );
  assert.match(clipboardFallback.toast, /コピーしました/);

  const resumedOcrStartedAt = performance.now();
  await evaluate(cdp, `document.getElementById("selectFullPageButton").click()`);
  await waitUntil("a new selection after history import", 5_000, async () => (
    await evaluate(cdp, `!document.getElementById("startButton").disabled`)
  ));
  await evaluate(cdp, `document.getElementById("startButton").click()`);
  await waitUntil("a continued OCR result after history import", smokeTimeoutMs, async () => (
    await evaluate(cdp, `
      document.getElementById("pageResultList").children.length === 2
      && document.getElementById("progressPanel").hidden
    `)
  ));
  const resumedOcrFinishedAt = performance.now();
  const resumedText = await evaluate(cdp, `document.getElementById("resultText").value`);
  assert.match(resumedText, new RegExp(importedEditMarker));
  assert.match(resumedText, /読み取り2・1ページ/, "continued OCR uses the restored next sequence");

  await delay(250);
  assert.deepEqual(
    outboundRequests,
    [],
    `no HTTP(S)/WebSocket requests are allowed: ${JSON.stringify(outboundRequests, null, 2)}`,
  );
  assert.deepEqual(
    exceptionDiagnostics,
    [],
    `browser runtime exceptions were reported: ${JSON.stringify(exceptionDiagnostics, null, 2)}`,
  );
  assert.deepEqual(
    sessionDiagnostics,
    [],
    `attached target diagnostics were reported: ${JSON.stringify(sessionDiagnostics, null, 2)}`,
  );
  assert.deepEqual(
    cdp.listenerErrors.map((error) => error.message),
    [],
    "CDP event listeners completed without errors",
  );

  const resultSummary = resultText.replace(/\s+/g, " ").trim();
  console.log(
    `Browser smoke test passed on ${browserVersion.product || "Chrome"}: `
    + `load ${elapsedSeconds(navigationStartedAt, navigationFinishedAt)}s, `
    + `sample ${elapsedSeconds(sampleStartedAt, sampleFinishedAt)}s, `
    + `OCR ${elapsedSeconds(ocrStartedAt, ocrFinishedAt)}s, `
    + `resume OCR ${elapsedSeconds(resumedOcrStartedAt, resumedOcrFinishedAt)}s, `
    + `total ${elapsedSeconds(totalStartedAt)}s; `
    + `${observedRequests.length} allowed file/blob/data request(s), `
    + `${consoleDiagnostics.length} console message(s); `
    + `result ${JSON.stringify(truncate(resultSummary, 180))}.`,
  );
} catch (error) {
  let uiSnapshot;
  if (cdp?.connected) {
    try {
      uiSnapshot = await evaluate(cdp, `(() => ({
        href: location.href,
        readyState: document.readyState,
        compatibilityNotice: document.getElementById("compatibilityNotice")?.hidden,
        compatibilityMessage: document.getElementById("compatibilityMessage")?.textContent,
        previewHidden: document.getElementById("previewFigure")?.hidden,
        startDisabled: document.getElementById("startButton")?.disabled,
        progressHidden: document.getElementById("progressPanel")?.hidden,
        progressStage: document.getElementById("progressStage")?.textContent,
        progressDetail: document.getElementById("progressDetail")?.textContent,
        resultHidden: document.getElementById("resultPanel")?.hidden,
        resultText: document.getElementById("resultText")?.value,
        historyError: document.getElementById("historyError")?.textContent,
        historyButton: document.getElementById("historySelectButton")?.textContent,
      }))()`);
    } catch {
      // The original failure is more useful than a secondary diagnostic failure.
    }
  }
  console.error(`Browser smoke test failed: ${error.stack || error}`);
  if (uiSnapshot) console.error(`UI snapshot: ${JSON.stringify(uiSnapshot, null, 2)}`);
  if (outboundRequests.length > 0) {
    console.error(`Outbound requests: ${JSON.stringify(outboundRequests, null, 2)}`);
  }
  if (exceptionDiagnostics.length > 0) {
    console.error(`Runtime exceptions: ${JSON.stringify(exceptionDiagnostics, null, 2)}`);
  }
  if (sessionDiagnostics.length > 0) {
    console.error(`Attached target diagnostics: ${sessionDiagnostics.join("\n")}`);
  }
  if (consoleDiagnostics.length > 0) {
    console.error(`Console diagnostics: ${JSON.stringify(consoleDiagnostics.slice(-20), null, 2)}`);
  }
  if (browserOutput.trim()) {
    console.error(`Chrome output (tail):\n${truncate(browserOutput.trim(), 8_000)}`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
