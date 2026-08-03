"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const guardSource = readFileSync(
  path.join(__dirname, "..", "offline-guard.js"),
  "utf8",
);

function installGuard() {
  const calls = [];

  class MockXhr {
    open(method, url) {
      calls.push(["xhr", method, String(url)]);
    }
  }

  class MockSocket {
    constructor(url) {
      calls.push(["socket", String(url)]);
    }
  }

  class MockWorker {
    constructor(url) {
      this.url = String(url);
      this.terminated = false;
      calls.push(["worker", this.url]);
    }

    terminate() {
      this.terminated = true;
    }
  }

  const root = {
    location: { href: "file:///offline-app/index.html" },
    fetch(resource) {
      calls.push(["fetch", String(resource)]);
      return Promise.resolve({ ok: true });
    },
    XMLHttpRequest: MockXhr,
    WebSocket: MockSocket,
    EventSource: MockSocket,
    WebTransport: MockSocket,
    SharedWorker: MockWorker,
    RTCPeerConnection: MockSocket,
    Worker: MockWorker,
    navigator: {
      sendBeacon(url) {
        calls.push(["beacon", String(url)]);
        return true;
      },
    },
  };

  vm.runInNewContext(guardSource, {
    Date,
    DOMException,
    Object,
    Promise,
    Reflect,
    Set,
    String,
    TypeError,
    URL,
    window: root,
  }, { filename: "offline-guard.js" });

  return { root, calls };
}

test("offline guard rejects URL and Request-shaped external resources", async () => {
  const { root, calls } = installGuard();
  const guard = root.ScanScribeNetworkGuard;

  assert.equal(guard.installed, true);
  assert.equal(guard.version, 1);
  assert.equal(guard.isExternalUrl(new URL("https://example.invalid/a")), true);
  assert.equal(guard.isExternalUrl({ url: "https://example.invalid/b" }), true);
  assert.equal(guard.isExternalUrl("file://server/share/file"), true);
  assert.equal(guard.isExternalUrl("ftp://example.invalid/file"), true);
  assert.equal(guard.isExternalUrl("custom-scheme:payload"), true);
  assert.equal(guard.isExternalUrl({}), true, "unparseable inputs fail closed");

  await assert.rejects(
    root.fetch(new URL("https://example.invalid/data")),
    /disabled/i,
  );
  await assert.rejects(
    root.fetch({ url: "https://example.invalid/request" }),
    /disabled/i,
  );
  assert.equal(calls.some(([kind]) => kind === "fetch"), false, "native fetch is not reached");

  await root.fetch("data:text/plain,local");
  assert.equal(calls.filter(([kind]) => kind === "fetch").length, 1);
});

test("offline guard covers XHR, sockets, beacon, and workers", () => {
  const { root, calls } = installGuard();

  assert.throws(
    () => new root.XMLHttpRequest().open("GET", new URL("https://example.invalid")),
    (error) => error.name === "SecurityError",
  );
  assert.throws(
    () => new root.WebSocket(new URL("wss://example.invalid")),
    (error) => error.name === "SecurityError",
  );
  assert.equal(root.navigator.sendBeacon(new URL("https://example.invalid"), "x"), false);
  assert.throws(
    () => new root.Worker(new URL("https://example.invalid/worker.js")),
    (error) => error.name === "SecurityError",
  );
  assert.throws(
    () => new root.SharedWorker("blob:null/shared"),
    (error) => error.name === "SecurityError",
  );
  assert.throws(
    () => new root.RTCPeerConnection({}),
    (error) => error.name === "SecurityError",
  );

  const capture = root.ScanScribeNetworkGuard.captureWorkers(
    () => new root.Worker("blob:null/local-worker"),
  );
  assert.equal(capture.workers.size, 1);
  assert.equal(capture.workers.has(capture.value), true);
  assert.equal(calls.filter(([kind]) => kind === "worker").length, 1);
  assert.equal(calls.some(([kind]) => kind === "xhr" || kind === "socket" || kind === "beacon"), false);
});
