"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ImageInputError,
  calculateOcrScale,
  createClipboardFileName,
  inspectImageHeader,
  sanitizeImageBaseName,
  validateImageDimensions,
  validateImageSize,
} = require("../image-core.js");

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

test("PNG signature and dimensions are read without decoding", () => {
  assert.deepEqual(inspectImageHeader(pngHeader(1920, 1080)), {
    type: "png",
    mime: "image/png",
    extension: ".png",
    width: 1920,
    height: 1080,
    animated: false,
  });
});

test("baseline JPEG dimensions are read from SOF", () => {
  const bytes = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
  const result = inspectImageHeader(bytes);
  assert.equal(result.type, "jpeg");
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
});

test("extended WebP dimensions and animation flag are checked", () => {
  const bytes = new Uint8Array(30);
  bytes.set([..."RIFF"].map((value) => value.charCodeAt(0)), 0);
  bytes.set([..."WEBPVP8X"].map((value) => value.charCodeAt(0)), 8);
  bytes[24] = 0xff;
  bytes[25] = 0x03;
  bytes[27] = 0xff;
  bytes[28] = 0x01;
  const result = inspectImageHeader(bytes);
  assert.equal(result.width, 1024);
  assert.equal(result.height, 512);

  bytes[20] = 0x02;
  assert.throws(
    () => inspectImageHeader(bytes),
    (error) => error instanceof ImageInputError && error.code === "IMAGE_ANIMATED_UNSUPPORTED",
  );
});

test("unsupported input is rejected even if it could have an image extension", () => {
  assert.throws(
    () => inspectImageHeader(new TextEncoder().encode("<svg></svg>")),
    (error) => error instanceof ImageInputError && error.code === "IMAGE_FORMAT_UNSUPPORTED",
  );
});

test("byte, dimension, and pixel limits are enforced", () => {
  assert.throws(() => validateImageSize(0), /空/);
  assert.throws(
    () => validateImageSize(41 * 1024 * 1024),
    (error) => error.code === "IMAGE_BYTES_EXCEEDED",
  );
  assert.deepEqual(validateImageDimensions(2000, 1000), {
    width: 2000,
    height: 1000,
    pixels: 2_000_000,
  });
  assert.throws(
    () => validateImageDimensions(10_000, 10_000),
    (error) => error.code === "IMAGE_PIXELS_EXCEEDED",
  );
  assert.throws(
    () => validateImageDimensions(20_000, 100),
    (error) => error.code === "IMAGE_DIMENSION_EXCEEDED",
  );
});

test("OCR enlargement is capped by total pixels and maximum dimension", () => {
  assert.equal(calculateOcrScale(1000, 500, 2), 2);
  assert.equal(calculateOcrScale(10_000, 1000, 2), 1.19);
  const scale = calculateOcrScale(4000, 4000, 2);
  assert.ok(scale < 1.12 && scale > 1.11);
});

test("image output names are safe and clipboard names are stable", () => {
  assert.equal(sanitizeImageBaseName("  screen:01.PNG  "), "screen_01");
  assert.equal(sanitizeImageBaseName("../../"), "snipping");
  assert.equal(
    createClipboardFileName(new Date(2026, 6, 18, 9, 5, 4)),
    "snip_20260718_090504.png",
  );
});
