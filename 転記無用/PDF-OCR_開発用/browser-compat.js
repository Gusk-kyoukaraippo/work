(function installScanScribeBrowserCompat(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ScanScribeBrowserCompat = api;
  }
})(
  typeof globalThis === "object" ? globalThis : this,
  function createScanScribeBrowserCompat(root) {
    "use strict";

    function dataCloneError(message) {
      if (typeof root.DOMException === "function") {
        return new root.DOMException(message, "DataCloneError");
      }
      const error = new Error(message);
      error.name = "DataCloneError";
      return error;
    }

    function cloneFallback(value) {
      const seen = new Map();

      function clone(input) {
        if (
          input === null
          || typeof input === "undefined"
          || typeof input === "boolean"
          || typeof input === "number"
          || typeof input === "string"
          || typeof input === "bigint"
        ) {
          return input;
        }
        if (typeof input === "symbol" || typeof input === "function") {
          throw dataCloneError("This value cannot be cloned.");
        }
        if (seen.has(input)) return seen.get(input);

        if (input instanceof ArrayBuffer) {
          const output = input.slice(0);
          seen.set(input, output);
          return output;
        }
        if (ArrayBuffer.isView(input)) {
          const buffer = clone(input.buffer);
          const output = input instanceof DataView
            ? new DataView(buffer, input.byteOffset, input.byteLength)
            : new input.constructor(buffer, input.byteOffset, input.length);
          seen.set(input, output);
          return output;
        }
        if (input instanceof Date) {
          const output = new Date(input.getTime());
          seen.set(input, output);
          return output;
        }
        if (input instanceof RegExp) {
          const output = new RegExp(input.source, input.flags);
          output.lastIndex = input.lastIndex;
          seen.set(input, output);
          return output;
        }
        if (input instanceof Map) {
          const output = new Map();
          seen.set(input, output);
          for (const [key, entry] of input) output.set(clone(key), clone(entry));
          return output;
        }
        if (input instanceof Set) {
          const output = new Set();
          seen.set(input, output);
          for (const entry of input) output.add(clone(entry));
          return output;
        }
        if (typeof root.Blob === "function" && input instanceof root.Blob) {
          const output = input.slice(0, input.size, input.type);
          seen.set(input, output);
          return output;
        }
        if (input instanceof Error) {
          const output = new Error(input.message);
          seen.set(input, output);
          output.name = input.name;
          if (input.stack) output.stack = input.stack;
          if ("cause" in input) output.cause = clone(input.cause);
          return output;
        }

        const output = Array.isArray(input)
          ? []
          : Object.create(Object.getPrototypeOf(input) === null ? null : Object.prototype);
        seen.set(input, output);
        for (const key of Reflect.ownKeys(input)) {
          const descriptor = Object.getOwnPropertyDescriptor(input, key);
          if (descriptor?.enumerable) output[key] = clone(input[key]);
        }
        return output;
      }

      return clone(value);
    }

    const nativeStructuredClone = typeof root.structuredClone === "function"
      ? root.structuredClone.bind(root)
      : null;
    const usingStructuredCloneFallback = nativeStructuredClone === null;
    if (usingStructuredCloneFallback) {
      Object.defineProperty(root, "structuredClone", {
        configurable: true,
        writable: true,
        value: cloneFallback,
      });
    }

    async function readBlobAsArrayBuffer(blob) {
      if (!blob || typeof blob !== "object") {
        throw new TypeError("A Blob or File is required.");
      }

      let directError = null;
      if (typeof blob.arrayBuffer === "function") {
        try {
          const value = await blob.arrayBuffer();
          if (value instanceof ArrayBuffer) return value;
          throw new TypeError("Blob.arrayBuffer() returned an invalid value.");
        } catch (error) {
          directError = error;
        }
      }

      if (typeof root.FileReader !== "function") {
        throw directError || new TypeError("This browser cannot read local file bytes.");
      }

      try {
        return await new Promise((resolve, reject) => {
          const reader = new root.FileReader();
          reader.addEventListener("load", () => {
            if (reader.result instanceof ArrayBuffer) {
              resolve(reader.result);
            } else {
              reject(new TypeError("FileReader returned an invalid value."));
            }
          }, { once: true });
          reader.addEventListener("error", () => {
            reject(reader.error || new Error("FileReader could not read the file."));
          }, { once: true });
          reader.addEventListener("abort", () => {
            const error = new Error("File reading was cancelled.");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
          reader.readAsArrayBuffer(blob);
        });
      } catch (readerError) {
        if (directError && readerError instanceof Error && readerError.cause === undefined) {
          try {
            readerError.cause = directError;
          } catch {
            // Error.cause can be read-only in older browsers.
          }
        }
        throw readerError;
      }
    }

    return Object.freeze({
      version: 1,
      installed: true,
      structuredClone: nativeStructuredClone || cloneFallback,
      usingStructuredCloneFallback,
      readBlobAsArrayBuffer,
    });
  },
);
