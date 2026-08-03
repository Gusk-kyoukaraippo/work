"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const compatibilitySource = readFileSync(
  path.join(__dirname, "..", "browser-compat.js"),
  "utf8",
);

function installCompatibility(overrides = {}) {
  const root = {
    ArrayBuffer,
    Blob,
    DOMException,
    Error,
    Map,
    Object,
    Reflect,
    RegExp,
    Set,
    ...overrides,
  };
  const context = {
    Array,
    ArrayBuffer,
    BigInt,
    Blob,
    Boolean,
    DataView,
    Date,
    DOMException,
    Error,
    Map,
    Number,
    Object,
    Reflect,
    RegExp,
    Set,
    String,
    Symbol,
    TypeError,
    Uint8Array,
    globalThis: root,
  };
  vm.runInNewContext(compatibilitySource, context, {
    filename: "browser-compat.js",
  });
  return root.ScanScribeBrowserCompat;
}

test("installs a cyclic and typed-array capable structuredClone fallback", () => {
  const compatibility = installCompatibility({ structuredClone: undefined });
  const source = {
    bytes: new Uint8Array([1, 2, 3]),
    map: new Map([["key", new Set(["value"])]]),
  };
  source.self = source;

  const cloned = compatibility.structuredClone(source, {
    transfer: [source.bytes.buffer],
  });

  assert.equal(compatibility.usingStructuredCloneFallback, true);
  assert.notEqual(cloned, source);
  assert.deepEqual([...cloned.bytes], [1, 2, 3]);
  assert.notEqual(cloned.bytes.buffer, source.bytes.buffer);
  assert.equal(cloned.self, cloned);
  assert.deepEqual([...cloned.map.get("key")], ["value"]);
});

test("preserves the native structuredClone implementation when available", () => {
  const sentinel = (value) => ({ native: value });
  const compatibility = installCompatibility({ structuredClone: sentinel });

  assert.equal(compatibility.usingStructuredCloneFallback, false);
  assert.equal(compatibility.structuredClone("ok").native, "ok");
});

test("falls back to FileReader when Blob.arrayBuffer is unavailable", async () => {
  class MockFileReader {
    constructor() {
      this.listeners = new Map();
      this.result = null;
      this.error = null;
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    readAsArrayBuffer(blob) {
      this.result = blob.expected;
      this.listeners.get("load")();
    }
  }

  const compatibility = installCompatibility({
    FileReader: MockFileReader,
    structuredClone: undefined,
  });
  const expected = new Uint8Array([4, 5, 6]).buffer;
  const actual = await compatibility.readBlobAsArrayBuffer({
    arrayBuffer: undefined,
    expected,
  });

  assert.deepEqual([...new Uint8Array(actual)], [4, 5, 6]);
});

test("retries with FileReader when Blob.arrayBuffer rejects", async () => {
  class MockFileReader {
    constructor() {
      this.listeners = new Map();
      this.result = null;
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    readAsArrayBuffer(blob) {
      this.result = blob.expected;
      this.listeners.get("load")();
    }
  }

  const compatibility = installCompatibility({
    FileReader: MockFileReader,
    structuredClone: undefined,
  });
  const expected = new Uint8Array([7, 8]).buffer;
  const actual = await compatibility.readBlobAsArrayBuffer({
    arrayBuffer: () => Promise.reject(new Error("blocked by policy")),
    expected,
  });

  assert.deepEqual([...new Uint8Array(actual)], [7, 8]);
});
