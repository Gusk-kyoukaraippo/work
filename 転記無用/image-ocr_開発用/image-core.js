(function initializeImageOcrCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ImageOcrCore = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createImageOcrCore() {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({
    maxBytes: 40 * 1024 * 1024,
    maxDimension: 12_000,
    maxPixels: 20_000_000,
    minDimension: 2,
  });

  class ImageInputError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "ImageInputError";
      this.code = code;
    }
  }

  function asBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError("input must be an ArrayBuffer or Uint8Array.");
  }

  function readUint16BigEndian(bytes, offset) {
    return bytes[offset] * 0x100 + bytes[offset + 1];
  }

  function readUint16LittleEndian(bytes, offset) {
    return bytes[offset] + bytes[offset + 1] * 0x100;
  }

  function readUint24LittleEndian(bytes, offset) {
    return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
  }

  function readUint32BigEndian(bytes, offset) {
    return (
      bytes[offset] * 0x1000000
      + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3]
    );
  }

  function isAscii(bytes, offset, value) {
    if (offset + value.length > bytes.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (bytes[offset + index] !== value.charCodeAt(index)) return false;
    }
    return true;
  }

  function inspectPng(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
      return null;
    }
    if (!isAscii(bytes, 12, "IHDR")) {
      throw new ImageInputError("PNGのヘッダーが壊れています。", "PNG_HEADER_INVALID");
    }
    return Object.freeze({
      type: "png",
      mime: "image/png",
      extension: ".png",
      width: readUint32BigEndian(bytes, 16),
      height: readUint32BigEndian(bytes, 20),
      animated: false,
    });
  }

  function inspectJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= bytes.length) break;
      const segmentLength = readUint16BigEndian(bytes, offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (startOfFrameMarkers.has(marker)) {
        if (segmentLength < 7) {
          throw new ImageInputError("JPEGの寸法情報が壊れています。", "JPEG_DIMENSIONS_INVALID");
        }
        return Object.freeze({
          type: "jpeg",
          mime: "image/jpeg",
          extension: ".jpg",
          width: readUint16BigEndian(bytes, offset + 5),
          height: readUint16BigEndian(bytes, offset + 3),
          animated: false,
        });
      }
      offset += segmentLength;
    }
    throw new ImageInputError(
      "JPEGの寸法を確認できませんでした。通常のPNGまたはJPEGで保存し直してください。",
      "JPEG_DIMENSIONS_MISSING",
    );
  }

  function inspectWebp(bytes) {
    if (
      bytes.length < 30
      || !isAscii(bytes, 0, "RIFF")
      || !isAscii(bytes, 8, "WEBP")
    ) {
      return null;
    }
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") {
      return Object.freeze({
        type: "webp",
        mime: "image/webp",
        extension: ".webp",
        width: readUint24LittleEndian(bytes, 24) + 1,
        height: readUint24LittleEndian(bytes, 27) + 1,
        animated: Boolean(bytes[20] & 0x02),
      });
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1
        + ((bytes[22] & 0xc0) >> 6)
        + (bytes[23] << 2)
        + ((bytes[24] & 0x0f) << 10);
      return Object.freeze({
        type: "webp",
        mime: "image/webp",
        extension: ".webp",
        width,
        height,
        animated: false,
      });
    }
    if (
      chunk === "VP8 "
      && bytes[23] === 0x9d
      && bytes[24] === 0x01
      && bytes[25] === 0x2a
    ) {
      return Object.freeze({
        type: "webp",
        mime: "image/webp",
        extension: ".webp",
        width: readUint16LittleEndian(bytes, 26) & 0x3fff,
        height: readUint16LittleEndian(bytes, 28) & 0x3fff,
        animated: false,
      });
    }
    throw new ImageInputError(
      "このWebP画像の形式には対応していません。PNGで保存し直してください。",
      "WEBP_FORMAT_UNSUPPORTED",
    );
  }

  function inspectImageHeader(input) {
    const bytes = asBytes(input);
    if (bytes.length === 0) {
      throw new ImageInputError("画像が空です。", "IMAGE_EMPTY");
    }
    const result = inspectPng(bytes) || inspectJpeg(bytes) || inspectWebp(bytes);
    if (!result) {
      throw new ImageInputError(
        "PNG・JPEG・WebPのいずれかを選んでください。SVG、GIF、HEIC、TIFFには対応していません。",
        "IMAGE_FORMAT_UNSUPPORTED",
      );
    }
    if (result.animated) {
      throw new ImageInputError(
        "アニメーション画像には対応していません。静止画のPNGで保存してください。",
        "IMAGE_ANIMATED_UNSUPPORTED",
      );
    }
    return result;
  }

  function validateImageSize(bytes, limits = DEFAULT_LIMITS) {
    const numeric = Number(bytes);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new ImageInputError("画像が空です。", "IMAGE_EMPTY");
    }
    const maxBytes = Number(limits.maxBytes ?? DEFAULT_LIMITS.maxBytes);
    if (numeric > maxBytes) {
      throw new ImageInputError(
        `画像ファイルが大きすぎます。${formatBytes(maxBytes)}以下にしてください。`,
        "IMAGE_BYTES_EXCEEDED",
      );
    }
    return numeric;
  }

  function validateImageDimensions(width, height, limits = DEFAULT_LIMITS) {
    const resolvedWidth = Number(width);
    const resolvedHeight = Number(height);
    if (
      !Number.isSafeInteger(resolvedWidth)
      || !Number.isSafeInteger(resolvedHeight)
      || resolvedWidth < Number(limits.minDimension ?? DEFAULT_LIMITS.minDimension)
      || resolvedHeight < Number(limits.minDimension ?? DEFAULT_LIMITS.minDimension)
    ) {
      throw new ImageInputError("画像の幅または高さが小さすぎます。", "IMAGE_DIMENSIONS_TOO_SMALL");
    }
    const maxDimension = Number(limits.maxDimension ?? DEFAULT_LIMITS.maxDimension);
    if (resolvedWidth > maxDimension || resolvedHeight > maxDimension) {
      throw new ImageInputError(
        `画像の一辺は${maxDimension.toLocaleString("ja-JP")}px以下にしてください。`,
        "IMAGE_DIMENSION_EXCEEDED",
      );
    }
    const pixels = resolvedWidth * resolvedHeight;
    const maxPixels = Number(limits.maxPixels ?? DEFAULT_LIMITS.maxPixels);
    if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
      throw new ImageInputError(
        `画像の総画素数は${maxPixels.toLocaleString("ja-JP")}画素以下にしてください。`,
        "IMAGE_PIXELS_EXCEEDED",
      );
    }
    return Object.freeze({ width: resolvedWidth, height: resolvedHeight, pixels });
  }

  function calculateOcrScale(
    width,
    height,
    requestedScale,
    maxPixels = 20_000_000,
    maxDimension = 11_900,
  ) {
    for (const [value, name] of [
      [width, "width"],
      [height, "height"],
      [requestedScale, "requestedScale"],
      [maxPixels, "maxPixels"],
      [maxDimension, "maxDimension"],
    ]) {
      if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
        throw new TypeError(`${name} must be a positive finite number.`);
      }
    }
    const pixelLimit = Math.sqrt(maxPixels / (width * height));
    const dimensionLimit = maxDimension / Math.max(width, height);
    const scale = Math.max(0.001, Math.min(requestedScale, pixelLimit, dimensionLimit));
    return Math.floor(scale * 1000) / 1000;
  }

  function sanitizeImageBaseName(fileName) {
    const withoutExtension = String(fileName ?? "")
      .trim()
      .replace(/\.(?:png|jpe?g|webp)$/i, "")
      .normalize("NFC");
    const safe = withoutExtension
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80);
    return safe && /[\p{L}\p{N}]/u.test(safe) ? safe : "snipping";
  }

  function createClipboardFileName(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError("date must be a valid Date.");
    }
    const pad = (value) => String(value).padStart(2, "0");
    return [
      "snip_",
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "_",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
      ".png",
    ].join("");
  }

  function formatBytes(bytes) {
    const numeric = Number(bytes);
    if (!Number.isFinite(numeric) || numeric < 0) return "—";
    if (numeric < 1024) return `${Math.round(numeric)} B`;
    const units = ["KB", "MB", "GB"];
    let value = numeric / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  return Object.freeze({
    DEFAULT_LIMITS,
    ImageInputError,
    calculateOcrScale,
    createClipboardFileName,
    formatBytes,
    inspectImageHeader,
    sanitizeImageBaseName,
    validateImageDimensions,
    validateImageSize,
  });
});
