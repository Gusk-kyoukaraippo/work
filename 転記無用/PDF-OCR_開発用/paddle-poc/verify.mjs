#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const htmlUrl = pathToFileURL(join(import.meta.dirname, "index.html")).href;
const profile = await mkdtemp(join(tmpdir(), "paddle-poc-chrome-"));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => (
        target.type === "page"
        && !String(target.url || "").startsWith("chrome-extension:")
      ));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Chrome DevTools endpoint did not become ready.");
}

const port = await freePort();
const chrome = spawn(chromePath, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
chrome.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const endpoint = await waitForTarget(port);
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const diagnostics = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      callback(message);
    }
    if (message.method === "Runtime.consoleAPICalled") {
      diagnostics.push(`console.${message.params.type}: ${message.params.args.map((arg) => (
        arg.value ?? arg.description ?? ""
      )).join(" ")}`);
    }
    if (message.method === "Runtime.exceptionThrown") {
      diagnostics.push(`exception: ${message.params.exceptionDetails.text} ${
        message.params.exceptionDetails.exception?.description || ""
      }`);
    }
    if (message.method === "Log.entryAdded") {
      diagnostics.push(`log: ${message.params.entry.level}: ${message.params.entry.text}`);
    }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Log.enable");
  await command("Page.navigate", { url: htmlUrl });

  const deadline = Date.now() + 360_000;
  let result;
  while (Date.now() < deadline) {
    const evaluated = await command("Runtime.evaluate", {
      expression: "JSON.stringify(window.__PADDLE_POC_RESULT__ || null)",
      returnByValue: true,
    });
    const raw = evaluated.result?.value;
    if (raw) {
      result = JSON.parse(raw);
      if (result?.status === "success" || result?.status === "failed") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  socket.close();
  if (!result || result.status !== "success") {
    throw new Error(
      `PoC failed or timed out: ${JSON.stringify(result)}\n${diagnostics.join("\n")}`,
    );
  }
  if (!String(result.text || "").trim()) {
    throw new Error(`OCR initialized but returned no text: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ htmlUrl, result }, null, 2));
} finally {
  chrome.kill("SIGTERM");
  await new Promise((resolve) => chrome.once("exit", resolve)).catch(() => {});
  await rm(profile, { recursive: true, force: true });
  if (stderr) process.stderr.write(stderr.slice(-4000));
}
