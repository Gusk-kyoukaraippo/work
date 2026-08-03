(function installOfflineNetworkGuard(root) {
  "use strict";

  const blockedAttempts = [];
  const workerCaptureStack = [];

  function urlText(value) {
    if (typeof value === "string") return value;
    if (value && typeof value.href === "string") return value.href;
    if (value && typeof value.url === "string") return value.url;
    return "";
  }

  function isExternalUrl(value) {
    try {
      const raw = urlText(value);
      if (!raw) return true;
      const parsed = new URL(raw, root.location.href);
      if (parsed.protocol === "blob:" || parsed.protocol === "data:") return false;
      if (parsed.protocol === "file:" && parsed.host === "") return false;
      return true;
    } catch {
      return true;
    }
  }

  function record(kind, value) {
    blockedAttempts.push({ kind, value: String(value ?? ""), at: Date.now() });
    if (blockedAttempts.length > 20) blockedAttempts.shift();
  }

  if (typeof root.fetch === "function") {
    const nativeFetch = root.fetch.bind(root);
    root.fetch = function guardedFetch(resource, options) {
      if (isExternalUrl(resource)) {
        record("fetch", urlText(resource));
        return Promise.reject(new TypeError("External network access is disabled."));
      }
      return nativeFetch(resource, options);
    };
  }

  if (root.XMLHttpRequest?.prototype) {
    const nativeOpen = root.XMLHttpRequest.prototype.open;
    root.XMLHttpRequest.prototype.open = function guardedOpen(method, url, ...rest) {
      if (isExternalUrl(url)) {
        record("XMLHttpRequest", url);
        throw new DOMException("External network access is disabled.", "SecurityError");
      }
      return nativeOpen.call(this, method, url, ...rest);
    };
  }

  for (const constructorName of ["WebSocket", "EventSource", "WebTransport"]) {
    const NativeConstructor = root[constructorName];
    if (typeof NativeConstructor !== "function") continue;
    root[constructorName] = function GuardedNetworkConstructor(url, ...rest) {
      if (isExternalUrl(url)) {
        record(constructorName, url);
        throw new DOMException("External network access is disabled.", "SecurityError");
      }
      return Reflect.construct(NativeConstructor, [url, ...rest], new.target || NativeConstructor);
    };
    Object.setPrototypeOf(root[constructorName], NativeConstructor);
    root[constructorName].prototype = NativeConstructor.prototype;
  }

  for (const constructorName of ["SharedWorker", "RTCPeerConnection", "webkitRTCPeerConnection"]) {
    const NativeConstructor = root[constructorName];
    if (typeof NativeConstructor !== "function") continue;
    root[constructorName] = function DisabledCommunicationConstructor(...args) {
      record(constructorName, args[0]);
      throw new DOMException("This communication API is disabled.", "SecurityError");
    };
    Object.setPrototypeOf(root[constructorName], NativeConstructor);
    root[constructorName].prototype = NativeConstructor.prototype;
  }

  const NativeWorker = root.Worker;
  if (typeof NativeWorker === "function") {
    root.Worker = function GuardedWorker(url, options) {
      if (isExternalUrl(url)) {
        record("Worker", urlText(url));
        throw new DOMException("External network access is disabled.", "SecurityError");
      }
      const worker = Reflect.construct(
        NativeWorker,
        options === undefined ? [url] : [url, options],
        new.target || NativeWorker,
      );
      const capture = workerCaptureStack[workerCaptureStack.length - 1];
      if (capture) capture.add(worker);
      return worker;
    };
    Object.setPrototypeOf(root.Worker, NativeWorker);
    root.Worker.prototype = NativeWorker.prototype;
  }

  if (typeof root.navigator?.sendBeacon === "function") {
    try {
      const nativeSendBeacon = root.navigator.sendBeacon.bind(root.navigator);
      root.navigator.sendBeacon = function guardedSendBeacon(url, data) {
        if (isExternalUrl(url)) {
          record("sendBeacon", url);
          return false;
        }
        return nativeSendBeacon(url, data);
      };
    } catch {
      // Some browsers expose sendBeacon as a read-only property. The app never calls it.
    }
  }

  root.ScanScribeNetworkGuard = Object.freeze({
    version: 1,
    installed: true,
    isExternalUrl,
    getBlockedAttempts: () => blockedAttempts.map((attempt) => ({ ...attempt })),
    captureWorkers(factory) {
      if (typeof factory !== "function") throw new TypeError("factory must be a function.");
      const workers = new Set();
      workerCaptureStack.push(workers);
      try {
        return { value: factory(), workers };
      } finally {
        workerCaptureStack.pop();
      }
    },
  });
})(window);
