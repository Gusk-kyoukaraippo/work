"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../accuracy-core.js");

test("CommonJS loading does not leak the browser API onto globalThis", () => {
  assert.equal(globalThis.AccuracyCore, undefined);
});

function assertApproximately(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function referenceLevenshtein(leftText, rightText) {
  const left = [...leftText];
  const right = [...rightText];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function stringsThroughLength(alphabet, maximumLength) {
  const result = [""];
  let level = [""];
  for (let length = 1; length <= maximumLength; length += 1) {
    level = level.flatMap((prefix) => alphabet.map((character) => prefix + character));
    result.push(...level);
  }
  return result;
}

function makeSlantedLines(width, height, angleDegrees) {
  const data = new Uint8ClampedArray(width * height).fill(255);
  const slope = Math.tan(angleDegrees * Math.PI / 180);
  for (const baseline of [20, 43, 66, 89]) {
    for (let x = 8; x < width - 8; x += 1) {
      // Periodic spaces stop the fixture behaving like a ruled form.
      if (x % 31 >= 25) continue;
      const centerY = Math.round(baseline + slope * (x - width / 2));
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        const y = centerY + thickness;
        if (y >= 0 && y < height) data[y * width + x] = 0;
      }
    }
  }
  return data;
}

function naiveSauvola(data, width, height, windowSize, k, dynamicRange) {
  const radius = Math.floor(windowSize / 2);
  const output = new Uint8ClampedArray(data.length);
  const thresholds = new Float64Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let squareSum = 0;
      let count = 0;
      for (let sampleY = Math.max(0, y - radius); sampleY <= Math.min(height - 1, y + radius); sampleY += 1) {
        for (let sampleX = Math.max(0, x - radius); sampleX <= Math.min(width - 1, x + radius); sampleX += 1) {
          const value = data[sampleY * width + sampleX];
          sum += value;
          squareSum += value * value;
          count += 1;
        }
      }
      const mean = sum / count;
      const variance = Math.max(0, squareSum / count - mean * mean);
      const threshold = mean * (1 + k * (Math.sqrt(variance) / dynamicRange - 1));
      const index = y * width + x;
      thresholds[index] = threshold;
      output[index] = data[index] <= threshold ? 0 : 255;
    }
  }
  return { output, thresholds };
}

test("calculateExpandedRoi converts, rounds outward, and expands a normalized ROI", () => {
  const result = core.calculateExpandedRoi(
    { x: 0.105, y: 0.21, width: 0.101, height: 0.205 },
    100,
    50,
    { marginPixels: 5 },
  );

  assert.deepEqual(result.selection, { x: 10, y: 10, width: 11, height: 11 });
  assert.deepEqual(result.expanded, { x: 5, y: 5, width: 21, height: 21 });
  assert.deepEqual(result.requestedMargins, { top: 5, right: 5, bottom: 5, left: 5 });
  assert.deepEqual(result.effectiveMargins, { top: 5, right: 5, bottom: 5, left: 5 });
  assert.deepEqual(result.normalized, { x: 0.05, y: 0.1, width: 0.21, height: 0.42 });
});

test("calculateExpandedRoi clamps each expansion margin at page edges", () => {
  const result = core.calculateExpandedRoi(
    { x: 0, y: 0, width: 0.1, height: 0.1 },
    100,
    100,
    { marginPixels: { top: 9, right: 7, bottom: 5, left: 3 } },
  );

  assert.deepEqual(result.selection, { x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(result.expanded, { x: 0, y: 0, width: 17, height: 15 });
  assert.deepEqual(result.effectiveMargins, { top: 0, right: 7, bottom: 5, left: 0 });
  assert.throws(
    () => core.calculateExpandedRoi({ x: 2, y: 2, width: 0.1, height: 0.1 }, 100, 100),
    /does not intersect/,
  );
});

test("toGrayscale accepts grayscale and alpha-composites RGBA over white", () => {
  const grayscale = new Uint8Array([4, 90]);
  assert.deepEqual([...core.toGrayscale(grayscale, 2, 1)], [4, 90]);
  assert.notEqual(core.toGrayscale(grayscale, 2, 1), grayscale);

  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 0, 0, 0,
    0, 255, 0, 128,
  ]);
  assert.deepEqual([...core.toGrayscale(rgba, 3, 1)], [76, 255, 202]);
});

test("histogram and image statistics expose stable contrast signals", () => {
  const data = new Uint8ClampedArray([0, 0, 255, 255]);
  const { histogram, count } = core.createHistogram(data, 2, 2);
  assert.equal(count, 4);
  assert.equal(histogram[0], 2);
  assert.equal(histogram[255], 2);
  assert.equal(core.percentileFromHistogram(histogram, count, 0.5), 0);

  const statistics = core.computeImageStatistics(data, 2, 2);
  assert.equal(statistics.minimum, 0);
  assert.equal(statistics.maximum, 255);
  assert.equal(statistics.range, 255);
  assert.equal(statistics.mean, 127.5);
  assert.equal(statistics.variance, 16256.25);
  assert.equal(statistics.standardDeviation, 127.5);
  assert.equal(statistics.entropy, 1);
  assert.deepEqual(statistics.percentiles, { low: 0, median: 0, high: 255 });
});

test("RGBA percentile enhancement mutates and returns the same buffer deterministically", () => {
  const pixels = new Uint8ClampedArray([
    50, 50, 50, 1,
    100, 100, 100, 64,
    150, 150, 150, 128,
    200, 200, 200, 254,
  ]);
  const result = core.enhanceRgbaPercentilesInPlace(pixels, 4, 1);

  assert.equal(result.data, pixels);
  assert.deepEqual(
    {
      width: result.width,
      height: result.height,
      low: result.low,
      high: result.high,
      samples: result.samples,
      sampleStep: result.sampleStep,
      fallbackApplied: result.fallbackApplied,
    },
    {
      width: 4,
      height: 1,
      low: 49,
      high: 199,
      samples: 4,
      sampleStep: 4,
      fallbackApplied: false,
    },
  );
  assert.deepEqual([...pixels], [
    14, 14, 14, 255,
    90, 90, 90, 255,
    166, 166, 166, 255,
    241, 241, 241, 255,
  ]);
});

test("RGBA percentile enhancement uses the full-range fallback for low contrast", () => {
  const pixels = new Uint8ClampedArray([
    100, 100, 100, 255,
    120, 120, 120, 128,
    140, 140, 140, 0,
  ]);
  const result = core.enhanceRgbaPercentilesInPlace(pixels, 3, 1);

  assert.equal(result.fallbackApplied, true);
  assert.equal(result.low, 0);
  assert.equal(result.high, 255);
  assert.deepEqual([...pixels], [
    100, 100, 100, 255,
    120, 120, 120, 255,
    140, 140, 140, 255,
  ]);
});

test("RGBA percentile enhancement converts flat color to opaque grayscale", () => {
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 0,
    10, 20, 30, 127,
  ]);
  const result = core.enhanceRgbaPercentilesInPlace(pixels, 2, 1);

  assert.equal(result.fallbackApplied, true);
  assert.deepEqual([...pixels], [
    18, 18, 18, 255,
    18, 18, 18, 255,
  ]);
});

test("RGBA percentile enhancement preserves the large-image histogram sampling stride", () => {
  const width = 1_000_000;
  const pixels = new Uint8ClampedArray(width * 4);
  for (let pixel = 0; pixel < width; pixel += 1) {
    const offset = pixel * 4;
    const sampled = pixel % 2 === 0;
    const value = sampled
      ? (pixel < width / 2 ? 80 : 200)
      : (pixel < width / 2 ? 0 : 255);
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = pixel % 256;
  }

  const result = core.enhanceRgbaPercentilesInPlace(pixels, width, 1);

  assert.equal(result.sampleStep, 8);
  assert.equal(result.samples, 500_000);
  assert.equal(result.low, 79);
  assert.equal(result.high, 199);
  assert.equal(result.fallbackApplied, false);
  assert.deepEqual([...pixels.slice(0, 8)], [
    22, 22, 22, 255,
    0, 0, 0, 255,
  ]);
  assert.deepEqual([...pixels.slice(-8)], [
    241, 241, 241, 255,
    255, 255, 255, 255,
  ]);
});

test("RGBA percentile enhancement strictly validates its buffer and dimensions", () => {
  assert.throws(
    () => core.enhanceRgbaPercentilesInPlace(new Uint8Array(4), 1, 1),
    /Uint8ClampedArray/,
  );
  assert.throws(
    () => core.enhanceRgbaPercentilesInPlace(new Uint8ClampedArray(3), 1, 1),
    /length must be 4/,
  );
  assert.throws(
    () => core.enhanceRgbaPercentilesInPlace(new Uint8ClampedArray(4), 0, 1),
    /positive safe integer/,
  );
  assert.throws(
    () => core.enhanceRgbaPercentilesInPlace(new Uint8ClampedArray(4), 1.5, 1),
    /positive safe integer/,
  );
});

test("percentile stretching expands useful contrast and skips flat images", () => {
  const stretched = core.stretchGrayscalePercentiles(
    new Uint8ClampedArray([50, 100, 150, 200]),
    4,
    1,
    { lowPercentile: 0, highPercentile: 1, minimumRange: 0 },
  );
  assert.equal(stretched.changed, true);
  assert.equal(stretched.low, 50);
  assert.equal(stretched.high, 200);
  assert.deepEqual([...stretched.data], [0, 85, 170, 255]);

  const flat = core.stretchGrayscalePercentiles(
    new Uint8ClampedArray([100, 101]),
    2,
    1,
    { lowPercentile: 0, highPercentile: 1, minimumRange: 32 },
  );
  assert.equal(flat.changed, false);
  assert.deepEqual([...flat.data], [100, 101]);
});

test("Otsu separates a bimodal image and supports explicit inversion", () => {
  const data = new Uint8ClampedArray([10, 10, 10, 200, 200, 200]);
  assert.equal(core.computeOtsuThreshold(data, 6, 1), 10);
  assert.deepEqual([...core.binarizeOtsu(data, 6, 1).data], [0, 0, 0, 255, 255, 255]);
  assert.deepEqual(
    [...core.binarizeOtsu(data, 6, 1, { threshold: 10, invert: true }).data],
    [255, 255, 255, 0, 0, 0],
  );
});

test("Sauvola rolling-window implementation matches a direct reference", () => {
  const width = 7;
  const height = 6;
  const data = new Uint8ClampedArray(width * height);
  let state = 0x12345678;
  for (let index = 0; index < data.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index] = state >>> 24;
  }
  const expected = naiveSauvola(data, width, height, 5, 0.24, 128);
  const actual = core.binarizeSauvola(data, width, height, {
    windowSize: 5,
    k: 0.24,
    dynamicRange: 128,
    returnThresholdMap: true,
  });

  assert.deepEqual([...actual.data], [...expected.output]);
  for (let index = 0; index < data.length; index += 1) {
    assertApproximately(actual.thresholdMap[index], expected.thresholds[index], 1e-4);
  }
});

test("Sauvola keeps uniform paper white while retaining a dark local mark", () => {
  const data = new Uint8ClampedArray(25).fill(210);
  data[12] = 40;
  const normal = core.binarizeSauvola(data, 5, 5, { windowSize: 3 });
  assert.equal(normal.data[0], 255);
  assert.equal(normal.data[12], 0);
  const inverted = core.binarizeSauvola(data, 5, 5, { windowSize: 3, invert: true });
  assert.equal(inverted.data[0], 0);
  assert.equal(inverted.data[12], 255);
  assert.throws(() => core.binarizeSauvola(data, 5, 5, { windowSize: 4 }), /odd integer/);
});

test("rotation bounds and pure grayscale rotation are deterministic", () => {
  assert.deepEqual(core.calculateRotatedBounds(3, 2, 90), { width: 2, height: 3 });
  assert.deepEqual(core.calculateRotatedBounds(4, 2, 0), { width: 4, height: 2 });

  const input = new Uint8ClampedArray([1, 2, 3, 4, 5, 6]);
  const identity = core.rotateGrayscale(input, 2, 3, 0);
  assert.equal(identity.width, 2);
  assert.equal(identity.height, 3);
  assert.deepEqual([...identity.data], [...input]);

  const rotated = core.rotateGrayscale(input, 2, 3, 90, { interpolation: "nearest" });
  assert.equal(rotated.width, 3);
  assert.equal(rotated.height, 2);
  assert.deepEqual([...rotated.data], [5, 3, 1, 6, 4, 2]);
});

test("deskew estimation recovers a small text-baseline angle and correction sign", () => {
  const width = 180;
  const height = 112;
  for (const expectedAngle of [2.4, -2.4]) {
    const result = core.estimateDeskewAngle(
      makeSlantedLines(width, height, expectedAngle),
      width,
      height,
    );
    assertApproximately(result.angle, expectedAngle, 0.25);
    assert.equal(result.correctionAngle, -result.angle);
    assert.ok(result.foregroundPixels > 100);
    assert.ok(result.score > 0);
  }

  const blank = core.estimateDeskewAngle(
    new Uint8ClampedArray(width * height).fill(255),
    width,
    height,
  );
  assert.deepEqual(
    { angle: blank.angle, correctionAngle: blank.correctionAngle, confidence: blank.confidence },
    { angle: 0, correctionAngle: 0, confidence: 0 },
  );

  const solidInk = core.estimateDeskewAngle(new Uint8ClampedArray(width * height), width, height);
  assert.deepEqual(
    { angle: solidInk.angle, correctionAngle: solidInk.correctionAngle, confidence: solidInk.confidence },
    { angle: 0, correctionAngle: 0, confidence: 0 },
  );
});

test("alignText handles Japanese, normalization, and Unicode code points", () => {
  const replacement = core.alignText("請求金額", "請求全額");
  assert.equal(replacement.distance, 1);
  assert.equal(replacement.similarity, 0.75);
  assert.equal(replacement.operations.filter(({ type }) => type === "replace").length, 1);

  const emoji = core.alignText("A😀B", "A😃B");
  assert.equal(emoji.distance, 1);
  assert.equal(emoji.operations.length, 3);
  assert.equal(core.alignText("か\u3099", "が").distance, 0);
});

test("alignText agrees with reference Levenshtein distance across short strings", () => {
  const strings = stringsThroughLength(["a", "b", "😀"], 3);
  for (const left of strings) {
    for (const right of strings) {
      const alignment = core.alignText(left, right, { normalization: null });
      assert.equal(alignment.distance, referenceLevenshtein(left, right), `${left} -> ${right}`);
      assert.equal(
        alignment.operations.filter(({ left: character }) => character !== null)
          .map(({ left: character }) => character).join(""),
        left,
      );
      assert.equal(
        alignment.operations.filter(({ right: character }) => character !== null)
          .map(({ right: character }) => character).join(""),
        right,
      );
    }
  }
});

test("candidate consensus favors agreement over one high-confidence outlier", () => {
  const candidates = [
    { id: "normal", text: "請求金額 10,000円", confidence: 82 },
    { id: "otsu", text: "請求金額 10,000円", confidence: 70 },
    { id: "outlier", text: "XYZ 88,888", confidence: 99 },
    { id: "empty", text: "   ", confidence: 100 },
  ];
  const result = core.buildCandidateConsensus(candidates);

  assert.equal(result.consensusText, "請求金額 10,000円");
  assert.ok(result.selectedIndex === 0 || result.selectedIndex === 1);
  assert.equal(result.evaluations.length, 3);
  assert.equal(result.pairwiseSimilarities.length, 3);
});

test("candidate consensus suppresses an insertion that lacks majority support", () => {
  const result = core.buildCandidateConsensus([
    { text: "東京都", confidence: 85 },
    { text: "東京都", confidence: 75 },
    { text: "東京者都", confidence: 95 },
  ]);
  assert.equal(result.consensusText, "東京都");
});

test("candidate consensus counts conflicting insertion gaps and does not report perfect agreement", () => {
  const result = core.buildCandidateConsensus([
    { text: "A", confidence: 90 },
    { text: "AX", confidence: 90 },
    { text: "AY", confidence: 90 },
  ]);
  assert.equal(result.consensusText, "A");
  assert.ok(result.agreement < 0.55);
  assert.ok(result.voteAgreement < 1);
  assert.ok(result.disagreements.some(({ kind }) => kind === "insertion"));
});

test("candidate consensus reports when only one non-empty result is comparable", () => {
  const result = core.buildCandidateConsensus([
    { text: "", confidence: 99 },
    { text: "唯一の候補", confidence: 60 },
    { text: "   ", confidence: 99 },
  ]);
  assert.equal(result.activeCandidateCount, 1);
  assert.equal(result.selectedCandidate.text, "唯一の候補");
});

test("agreement sampling preserves empty candidates and covers long text", () => {
  assert.equal(core.sampleTextForAgreement(" \n ".repeat(500), 80), "");
  assert.equal(core.sampleTextForAgreement("短い文字列", 80), "短い文字列");
  const long = Array.from({ length: 1_000 }, (_, index) => String(index % 10)).join("");
  const sampled = core.sampleTextForAgreement(long, 80);
  assert.equal([...sampled].length, 80);
  assert.ok(sampled.startsWith(long.slice(0, 10)));
  assert.ok(sampled.endsWith(long.slice(-10)));
  assert.equal((sampled.match(/…/g) || []).length, 2);
});

test("rotateCanvas can bound the deskewed output without changing default geometry", () => {
  const calls = [];
  const context = {
    save: () => calls.push("save"),
    fillRect: () => {},
    translate: () => {},
    scale: (...args) => calls.push(["scale", ...args]),
    rotate: () => {},
    drawImage: () => {},
    restore: () => calls.push("restore"),
  };
  const output = core.rotateCanvas(
    { width: 400, height: 200 },
    4,
    {
      maximumPixels: 20_000,
      maximumDimension: 180,
      canvasFactory: () => ({ width: 0, height: 0, getContext: () => context }),
    },
  );
  assert.ok(output.width <= 180);
  assert.ok(output.height <= 180);
  assert.ok(output.width * output.height <= 20_000);
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "scale"));
});

test("Canvas wrappers keep DOM dependencies injectable", () => {
  const calls = [];
  const context = {
    save: () => calls.push("save"),
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    translate: (...args) => calls.push(["translate", ...args]),
    rotate: (angle) => calls.push(["rotate", angle]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
    restore: () => calls.push("restore"),
  };
  const output = core.rotateCanvas(
    { width: 4, height: 2 },
    90,
    {
      canvasFactory(width, height) {
        return { width, height, getContext: () => context };
      },
    },
  );
  assert.deepEqual({ width: output.width, height: output.height }, { width: 2, height: 4 });
  assert.equal(calls[0], "save");
  assert.equal(calls.at(-1), "restore");
  assertApproximately(calls.find((entry) => Array.isArray(entry) && entry[0] === "rotate")[1], Math.PI / 2);

  const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
  const read = core.readCanvasGrayscale({
    width: 1,
    height: 1,
    getContext: () => ({ getImageData: () => ({ data: pixels, width: 1, height: 1 }) }),
  });
  assert.deepEqual([...read.data], [76]);
});
