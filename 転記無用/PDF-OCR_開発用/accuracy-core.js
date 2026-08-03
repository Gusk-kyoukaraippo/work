(function initializeAccuracyCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else if (root) {
    root.AccuracyCore = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createAccuracyCore() {
  "use strict";

  const DEG_TO_RAD = Math.PI / 180;
  const EPSILON = 1e-12;

  function assertPositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }

  function assertFiniteNumber(value, name) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number.`);
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function assertDimensions(width, height) {
    assertPositiveInteger(width, "width");
    assertPositiveInteger(height, "height");
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels)) {
      throw new RangeError("width * height exceeds the safe integer range.");
    }
    return pixels;
  }

  function normalizeRegion(region) {
    if (!region || typeof region !== "object") {
      throw new TypeError("region must be an object.");
    }
    const values = [region.x, region.y, region.width, region.height].map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError("region coordinates must be finite numbers.");
    }
    const [rawX, rawY, rawWidth, rawHeight] = values;
    if (rawWidth <= 0 || rawHeight <= 0) {
      throw new RangeError("region width and height must be greater than zero.");
    }
    const left = clamp(rawX, 0, 1);
    const top = clamp(rawY, 0, 1);
    const right = clamp(rawX + rawWidth, 0, 1);
    const bottom = clamp(rawY + rawHeight, 0, 1);
    if (right <= left || bottom <= top) {
      throw new RangeError("region does not intersect the source image.");
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function normalizeMargins(value, fallback) {
    if (value === undefined) {
      return { top: fallback, right: fallback, bottom: fallback, left: fallback };
    }
    if (Number.isFinite(Number(value))) {
      const margin = Math.max(0, Math.round(Number(value)));
      return { top: margin, right: margin, bottom: margin, left: margin };
    }
    if (!value || typeof value !== "object") {
      throw new TypeError("marginPixels must be a number or margin object.");
    }
    const margins = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const margin = Number(value[side] ?? 0);
      if (!Number.isFinite(margin) || margin < 0) {
        throw new TypeError(`marginPixels.${side} must be a non-negative finite number.`);
      }
      margins[side] = Math.round(margin);
    }
    return margins;
  }

  /**
   * Converts a normalized top-left ROI to pixels, expands the source rectangle,
   * and reports the effective margins after page-edge clamping.
   */
  function calculateExpandedRoi(region, sourceWidth, sourceHeight, options = {}) {
    assertDimensions(sourceWidth, sourceHeight);
    const normalized = normalizeRegion(region);
    const selectionLeft = clamp(Math.floor(normalized.x * sourceWidth), 0, sourceWidth - 1);
    const selectionTop = clamp(Math.floor(normalized.y * sourceHeight), 0, sourceHeight - 1);
    const selectionRight = clamp(
      Math.ceil((normalized.x + normalized.width) * sourceWidth),
      selectionLeft + 1,
      sourceWidth,
    );
    const selectionBottom = clamp(
      Math.ceil((normalized.y + normalized.height) * sourceHeight),
      selectionTop + 1,
      sourceHeight,
    );
    const selection = {
      x: selectionLeft,
      y: selectionTop,
      width: selectionRight - selectionLeft,
      height: selectionBottom - selectionTop,
    };

    const marginRatio = Number(options.marginRatio ?? 0.02);
    const minimumMargin = Number(options.minimumMarginPixels ?? 4);
    const maximumMargin = Number(options.maximumMarginPixels ?? 64);
    for (const [value, name] of [
      [marginRatio, "marginRatio"],
      [minimumMargin, "minimumMarginPixels"],
      [maximumMargin, "maximumMarginPixels"],
    ]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative finite number.`);
      }
    }
    if (maximumMargin < minimumMargin) {
      throw new RangeError("maximumMarginPixels must be at least minimumMarginPixels.");
    }
    const automaticMargin = Math.round(clamp(
      Math.min(selection.width, selection.height) * marginRatio,
      minimumMargin,
      maximumMargin,
    ));
    const requestedMargins = normalizeMargins(options.marginPixels, automaticMargin);
    const expandedLeft = Math.max(0, selectionLeft - requestedMargins.left);
    const expandedTop = Math.max(0, selectionTop - requestedMargins.top);
    const expandedRight = Math.min(sourceWidth, selectionRight + requestedMargins.right);
    const expandedBottom = Math.min(sourceHeight, selectionBottom + requestedMargins.bottom);
    const expanded = {
      x: expandedLeft,
      y: expandedTop,
      width: expandedRight - expandedLeft,
      height: expandedBottom - expandedTop,
    };
    const effectiveMargins = {
      top: selectionTop - expandedTop,
      right: expandedRight - selectionRight,
      bottom: expandedBottom - selectionBottom,
      left: selectionLeft - expandedLeft,
    };
    return Object.freeze({
      selection: Object.freeze(selection),
      expanded: Object.freeze(expanded),
      requestedMargins: Object.freeze(requestedMargins),
      effectiveMargins: Object.freeze(effectiveMargins),
      normalized: Object.freeze({
        x: expanded.x / sourceWidth,
        y: expanded.y / sourceHeight,
        width: expanded.width / sourceWidth,
        height: expanded.height / sourceHeight,
      }),
    });
  }

  function resolvePixelInput(input, width, height) {
    let data = input;
    let resolvedWidth = width;
    let resolvedHeight = height;
    if (input && typeof input === "object" && "data" in input) {
      data = input.data;
      resolvedWidth ??= input.width;
      resolvedHeight ??= input.height;
    }
    assertDimensions(resolvedWidth, resolvedHeight);
    if (!data || typeof data.length !== "number") {
      throw new TypeError("pixel data must be an array-like object.");
    }
    return { data, width: resolvedWidth, height: resolvedHeight };
  }

  function resolveGrayscaleInput(input, width, height) {
    const resolved = resolvePixelInput(input, width, height);
    const expected = resolved.width * resolved.height;
    if (resolved.data.length !== expected) {
      throw new RangeError(`grayscale data length must be ${expected}.`);
    }
    return resolved;
  }

  function toGrayscale(input, width, height, options = {}) {
    const resolved = resolvePixelInput(input, width, height);
    const pixels = resolved.width * resolved.height;
    if (resolved.data.length === pixels) {
      return new Uint8ClampedArray(resolved.data);
    }
    if (resolved.data.length !== pixels * 4) {
      throw new RangeError(`RGBA data length must be ${pixels * 4}.`);
    }
    const redWeight = Number(options.redWeight ?? 0.299);
    const greenWeight = Number(options.greenWeight ?? 0.587);
    const blueWeight = Number(options.blueWeight ?? 0.114);
    const background = clamp(Math.round(Number(options.background ?? 255)), 0, 255);
    for (const [value, name] of [
      [redWeight, "redWeight"],
      [greenWeight, "greenWeight"],
      [blueWeight, "blueWeight"],
    ]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative finite number.`);
      }
    }
    const weightTotal = redWeight + greenWeight + blueWeight;
    if (weightTotal <= 0) throw new RangeError("grayscale weights must have a positive sum.");

    const output = new Uint8ClampedArray(pixels);
    for (let pixel = 0, index = 0; pixel < pixels; pixel += 1, index += 4) {
      const alpha = clamp(Number(resolved.data[index + 3]) / 255, 0, 1);
      const luminance = (
        Number(resolved.data[index]) * redWeight
        + Number(resolved.data[index + 1]) * greenWeight
        + Number(resolved.data[index + 2]) * blueWeight
      ) / weightTotal;
      output[pixel] = Math.round(luminance * alpha + background * (1 - alpha));
    }
    return output;
  }

  function createHistogram(input, width, height, options = {}) {
    const resolved = resolveGrayscaleInput(input, width, height);
    const sampleStep = Number(options.sampleStep ?? 1);
    if (!Number.isSafeInteger(sampleStep) || sampleStep < 1) {
      throw new TypeError("sampleStep must be a positive safe integer.");
    }
    const histogram = new Uint32Array(256);
    let count = 0;
    for (let index = 0; index < resolved.data.length; index += sampleStep) {
      const value = clamp(Math.round(Number(resolved.data[index])), 0, 255);
      histogram[value] += 1;
      count += 1;
    }
    return { histogram, count, width: resolved.width, height: resolved.height };
  }

  function percentileFromHistogram(histogram, count, percentile) {
    if (!histogram || histogram.length !== 256) {
      throw new TypeError("histogram must contain 256 bins.");
    }
    assertPositiveInteger(count, "count");
    const quantile = Number(percentile);
    if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
      throw new RangeError("percentile must be between 0 and 1.");
    }
    const target = Math.floor(quantile * (count - 1));
    let cumulative = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      cumulative += histogram[value];
      if (cumulative > target) return value;
    }
    return 255;
  }

  function computeImageStatistics(input, width, height, options = {}) {
    const { histogram, count, width: resolvedWidth, height: resolvedHeight } = createHistogram(
      input,
      width,
      height,
      options,
    );
    let sum = 0;
    let sumSquares = 0;
    let minimum = 0;
    let maximum = 255;
    while (minimum < 255 && histogram[minimum] === 0) minimum += 1;
    while (maximum > 0 && histogram[maximum] === 0) maximum -= 1;
    let entropy = 0;
    for (let value = minimum; value <= maximum; value += 1) {
      const frequency = histogram[value];
      if (frequency === 0) continue;
      sum += value * frequency;
      sumSquares += value * value * frequency;
      const probability = frequency / count;
      entropy -= probability * Math.log2(probability);
    }
    const mean = sum / count;
    const variance = Math.max(0, sumSquares / count - mean * mean);
    const lowPercentile = Number(options.lowPercentile ?? 0.02);
    const highPercentile = Number(options.highPercentile ?? 0.98);
    const low = percentileFromHistogram(histogram, count, lowPercentile);
    const median = percentileFromHistogram(histogram, count, 0.5);
    const high = percentileFromHistogram(histogram, count, highPercentile);
    return {
      width: resolvedWidth,
      height: resolvedHeight,
      samples: count,
      minimum,
      maximum,
      range: maximum - minimum,
      mean,
      variance,
      standardDeviation: Math.sqrt(variance),
      entropy,
      percentiles: { low, median, high },
      histogram,
    };
  }

  /**
   * Applies the app's scan-contrast enhancement directly to opaque RGBA pixels.
   * The histogram is sampled for large images, while every output pixel is
   * converted to grayscale, blended with the percentile stretch, and made
   * opaque. The input buffer is mutated to avoid another full-size allocation.
   */
  function enhanceRgbaPercentilesInPlace(input, width, height) {
    const resolved = resolvePixelInput(input, width, height);
    const pixelCount = resolved.width * resolved.height;
    const expectedLength = pixelCount * 4;
    if (!Number.isSafeInteger(expectedLength)) {
      throw new RangeError("RGBA data length exceeds the safe integer range.");
    }
    if (!(resolved.data instanceof Uint8ClampedArray)) {
      throw new TypeError("RGBA data must be a Uint8ClampedArray.");
    }
    if (resolved.data.length !== expectedLength) {
      throw new RangeError(`RGBA data length must be ${expectedLength}.`);
    }

    const pixels = resolved.data;
    const histogram = new Uint32Array(256);
    const sampleStep = Math.max(4, Math.floor(pixelCount / 500_000) * 4);
    let samples = 0;

    for (let index = 0; index < pixels.length; index += sampleStep) {
      const luminance = Math.round(
        pixels[index] * 0.299
        + pixels[index + 1] * 0.587
        + pixels[index + 2] * 0.114,
      );
      histogram[luminance] += 1;
      samples += 1;
    }

    const lowTarget = samples * 0.02;
    const highTarget = samples * 0.98;
    let cumulative = 0;
    let low = 0;
    let high = 255;
    for (let value = 0; value < 256; value += 1) {
      cumulative += histogram[value];
      if (cumulative <= lowTarget) low = value;
      if (cumulative < highTarget) high = value;
    }
    const fallbackApplied = high - low < 80;
    if (fallbackApplied) {
      low = 0;
      high = 255;
    }
    const factor = 255 / Math.max(1, high - low);

    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = pixels[index] * 0.299
        + pixels[index + 1] * 0.587
        + pixels[index + 2] * 0.114;
      const stretched = clamp((luminance - low) * factor, 0, 255);
      const adjusted = Math.round(luminance * 0.25 + stretched * 0.75);
      pixels[index] = adjusted;
      pixels[index + 1] = adjusted;
      pixels[index + 2] = adjusted;
      pixels[index + 3] = 255;
    }

    return {
      data: pixels,
      width: resolved.width,
      height: resolved.height,
      low,
      high,
      samples,
      sampleStep,
      fallbackApplied,
    };
  }

  function stretchGrayscalePercentiles(input, width, height, options = {}) {
    const resolved = resolveGrayscaleInput(input, width, height);
    const lowPercentile = Number(options.lowPercentile ?? 0.02);
    const highPercentile = Number(options.highPercentile ?? 0.98);
    if (
      !Number.isFinite(lowPercentile)
      || !Number.isFinite(highPercentile)
      || lowPercentile < 0
      || highPercentile > 1
      || lowPercentile >= highPercentile
    ) {
      throw new RangeError("percentile bounds must satisfy 0 <= low < high <= 1.");
    }
    const minimumRange = Number(options.minimumRange ?? 32);
    const blend = Number(options.blend ?? 1);
    if (!Number.isFinite(minimumRange) || minimumRange < 0) {
      throw new TypeError("minimumRange must be a non-negative finite number.");
    }
    if (!Number.isFinite(blend) || blend < 0 || blend > 1) {
      throw new RangeError("blend must be between 0 and 1.");
    }
    const { histogram, count } = createHistogram(resolved.data, resolved.width, resolved.height);
    const low = percentileFromHistogram(histogram, count, lowPercentile);
    const high = percentileFromHistogram(histogram, count, highPercentile);
    const output = new Uint8ClampedArray(resolved.data.length);
    if (high - low < minimumRange) {
      output.set(resolved.data);
      return { data: output, low, high, changed: false };
    }
    const factor = 255 / (high - low);
    for (let index = 0; index < resolved.data.length; index += 1) {
      const original = Number(resolved.data[index]);
      const stretched = clamp((original - low) * factor, 0, 255);
      output[index] = Math.round(original * (1 - blend) + stretched * blend);
    }
    return { data: output, low, high, changed: blend > 0 };
  }

  function computeOtsuThreshold(input, width, height, options = {}) {
    const { histogram, count } = createHistogram(input, width, height, options);
    let total = 0;
    for (let value = 0; value < 256; value += 1) total += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestThreshold = 0;
    let bestVariance = -1;
    for (let threshold = 0; threshold < 255; threshold += 1) {
      backgroundWeight += histogram[threshold];
      if (backgroundWeight === 0) continue;
      const foregroundWeight = count - backgroundWeight;
      if (foregroundWeight === 0) break;
      backgroundSum += threshold * histogram[threshold];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (total - backgroundSum) / foregroundWeight;
      const difference = backgroundMean - foregroundMean;
      const betweenClassVariance = backgroundWeight * foregroundWeight * difference * difference;
      if (betweenClassVariance > bestVariance) {
        bestVariance = betweenClassVariance;
        bestThreshold = threshold;
      }
    }
    return bestThreshold;
  }

  function thresholdPixel(value, threshold, invert) {
    const darkForeground = value <= threshold;
    if (invert) return darkForeground ? 255 : 0;
    return darkForeground ? 0 : 255;
  }

  function binarizeOtsu(input, width, height, options = {}) {
    const resolved = resolveGrayscaleInput(input, width, height);
    const threshold = options.threshold === undefined
      ? computeOtsuThreshold(resolved.data, resolved.width, resolved.height, options)
      : Number(options.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
      throw new RangeError("threshold must be between 0 and 255.");
    }
    const invert = options.invert === true;
    const output = new Uint8ClampedArray(resolved.data.length);
    for (let index = 0; index < resolved.data.length; index += 1) {
      output[index] = thresholdPixel(Number(resolved.data[index]), threshold, invert);
    }
    return { data: output, threshold };
  }

  /**
   * O(width) memory Sauvola binarization. Edge windows shrink rather than using
   * fabricated pixels, which keeps local statistics stable near crop borders.
   */
  function binarizeSauvola(input, width, height, options = {}) {
    const resolved = resolveGrayscaleInput(input, width, height);
    const windowSize = Number(options.windowSize ?? 25);
    if (!Number.isSafeInteger(windowSize) || windowSize < 3 || windowSize % 2 === 0) {
      throw new TypeError("windowSize must be an odd integer of at least 3.");
    }
    const k = Number(options.k ?? 0.2);
    const dynamicRange = Number(options.dynamicRange ?? 128);
    if (!Number.isFinite(k) || k < 0 || k > 1) {
      throw new RangeError("k must be between 0 and 1.");
    }
    if (!Number.isFinite(dynamicRange) || dynamicRange <= 0) {
      throw new TypeError("dynamicRange must be a positive finite number.");
    }
    const invert = options.invert === true;
    const radius = Math.floor(windowSize / 2);
    const columnSums = new Float64Array(resolved.width);
    const columnSquareSums = new Float64Array(resolved.width);
    const output = new Uint8ClampedArray(resolved.data.length);
    const thresholdMap = options.returnThresholdMap ? new Float32Array(resolved.data.length) : null;

    const updateRow = (row, direction) => {
      if (row < 0 || row >= resolved.height) return;
      const offset = row * resolved.width;
      for (let x = 0; x < resolved.width; x += 1) {
        const value = Number(resolved.data[offset + x]);
        columnSums[x] += direction * value;
        columnSquareSums[x] += direction * value * value;
      }
    };
    for (let row = 0; row <= Math.min(resolved.height - 1, radius); row += 1) {
      updateRow(row, 1);
    }

    for (let y = 0; y < resolved.height; y += 1) {
      if (y > 0) {
        updateRow(y - radius - 1, -1);
        updateRow(y + radius, 1);
      }
      const top = Math.max(0, y - radius);
      const bottom = Math.min(resolved.height - 1, y + radius);
      const rows = bottom - top + 1;
      let windowSum = 0;
      let windowSquareSum = 0;
      for (let x = 0; x <= Math.min(resolved.width - 1, radius); x += 1) {
        windowSum += columnSums[x];
        windowSquareSum += columnSquareSums[x];
      }
      for (let x = 0; x < resolved.width; x += 1) {
        if (x > 0) {
          const removeColumn = x - radius - 1;
          const addColumn = x + radius;
          if (removeColumn >= 0) {
            windowSum -= columnSums[removeColumn];
            windowSquareSum -= columnSquareSums[removeColumn];
          }
          if (addColumn < resolved.width) {
            windowSum += columnSums[addColumn];
            windowSquareSum += columnSquareSums[addColumn];
          }
        }
        const left = Math.max(0, x - radius);
        const right = Math.min(resolved.width - 1, x + radius);
        const area = rows * (right - left + 1);
        const mean = windowSum / area;
        const variance = Math.max(0, windowSquareSum / area - mean * mean);
        const standardDeviation = Math.sqrt(variance);
        const threshold = mean * (1 + k * (standardDeviation / dynamicRange - 1));
        const index = y * resolved.width + x;
        output[index] = thresholdPixel(Number(resolved.data[index]), threshold, invert);
        if (thresholdMap) thresholdMap[index] = threshold;
      }
    }
    return { data: output, thresholdMap, windowSize, k, dynamicRange };
  }

  function projectionScore(points, width, height, angleDegrees) {
    const radians = angleDegrees * DEG_TO_RAD;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const maximumX = Math.max(0, width - 1);
    const maximumY = Math.max(0, height - 1);
    const cornerProjections = [
      0,
      -maximumX * sine,
      maximumY * cosine,
      maximumY * cosine - maximumX * sine,
    ];
    const minimumProjection = Math.min(...cornerProjections);
    const maximumProjection = Math.max(...cornerProjections);
    const extent = Math.ceil(maximumProjection - minimumProjection) + 5;
    const offset = 2 - minimumProjection;
    const bins = new Float64Array(extent);
    let total = 0;
    for (const point of points) {
      const projected = point.y * cosine - point.x * sine + offset;
      const lower = Math.floor(projected);
      const fraction = projected - lower;
      if (lower >= 0 && lower < bins.length) bins[lower] += point.weight * (1 - fraction);
      if (lower + 1 >= 0 && lower + 1 < bins.length) bins[lower + 1] += point.weight * fraction;
      total += point.weight;
    }
    if (total <= EPSILON) return 0;
    let sumSquares = 0;
    for (const value of bins) sumSquares += value * value;
    return sumSquares / (total * total);
  }

  function angleSequence(minimum, maximum, step) {
    const values = [];
    const count = Math.floor((maximum - minimum) / step + EPSILON);
    for (let index = 0; index <= count; index += 1) {
      values.push(minimum + index * step);
    }
    if (values.length === 0 || values[values.length - 1] < maximum - EPSILON) values.push(maximum);
    return values;
  }

  /**
   * Estimates the text-baseline skew angle. Rotate by correctionAngle to deskew.
   */
  function estimateDeskewAngle(input, width, height, options = {}) {
    const resolved = resolveGrayscaleInput(input, width, height);
    const minimumAngle = Number(options.minimumAngle ?? -5);
    const maximumAngle = Number(options.maximumAngle ?? 5);
    const coarseStep = Number(options.coarseStep ?? 0.5);
    const fineStep = Number(options.fineStep ?? 0.1);
    for (const [value, name] of [
      [minimumAngle, "minimumAngle"],
      [maximumAngle, "maximumAngle"],
      [coarseStep, "coarseStep"],
      [fineStep, "fineStep"],
    ]) assertFiniteNumber(value, name);
    if (minimumAngle > maximumAngle) throw new RangeError("minimumAngle must not exceed maximumAngle.");
    if (coarseStep <= 0 || fineStep <= 0) throw new RangeError("angle steps must be positive.");

    const threshold = options.threshold === undefined
      ? computeOtsuThreshold(resolved.data, resolved.width, resolved.height)
      : Number(options.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
      throw new RangeError("threshold must be between 0 and 255.");
    }
    const maxSamples = Number(options.maxSamples ?? 180_000);
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 100) {
      throw new TypeError("maxSamples must be a safe integer of at least 100.");
    }
    const samplingStep = Math.max(
      1,
      Math.ceil(Math.sqrt((resolved.width * resolved.height) / maxSamples)),
    );
    const points = [];
    let sampledPixels = 0;
    for (let y = 0; y < resolved.height; y += samplingStep) {
      const rowOffset = y * resolved.width;
      for (let x = 0; x < resolved.width; x += samplingStep) {
        sampledPixels += 1;
        const value = Number(resolved.data[rowOffset + x]);
        if (value > threshold) continue;
        points.push({
          x,
          y,
          weight: Math.max(1 / 255, (255 - value) / 255),
        });
      }
    }
    const minimumForegroundPixels = Number(options.minimumForegroundPixels ?? 24);
    const maximumForegroundRatio = Number(options.maximumForegroundRatio ?? 0.98);
    if (!Number.isSafeInteger(minimumForegroundPixels) || minimumForegroundPixels < 1) {
      throw new TypeError("minimumForegroundPixels must be a positive safe integer.");
    }
    if (
      !Number.isFinite(maximumForegroundRatio)
      || maximumForegroundRatio <= 0
      || maximumForegroundRatio > 1
    ) {
      throw new RangeError("maximumForegroundRatio must be greater than zero and at most one.");
    }
    const foregroundRatio = points.length / sampledPixels;
    if (points.length < minimumForegroundPixels || foregroundRatio > maximumForegroundRatio) {
      return {
        angle: 0,
        correctionAngle: 0,
        score: 0,
        confidence: 0,
        foregroundPixels: points.length,
        foregroundRatio,
        threshold,
        samplingStep,
      };
    }

    const evaluate = (angles) => angles.map((angle) => ({
      angle,
      score: projectionScore(points, resolved.width, resolved.height, angle),
    }));
    const coarse = evaluate(angleSequence(minimumAngle, maximumAngle, coarseStep));
    coarse.sort((left, right) => right.score - left.score || Math.abs(left.angle) - Math.abs(right.angle));
    const coarseBest = coarse[0];
    const fineMinimum = Math.max(minimumAngle, coarseBest.angle - coarseStep);
    const fineMaximum = Math.min(maximumAngle, coarseBest.angle + coarseStep);
    const fine = evaluate(angleSequence(fineMinimum, fineMaximum, fineStep));
    fine.sort((left, right) => right.score - left.score || Math.abs(left.angle) - Math.abs(right.angle));
    const best = fine[0];
    const zeroScore = projectionScore(points, resolved.width, resolved.height, 0);
    const runnerUp = fine.find((entry) => Math.abs(entry.angle - best.angle) >= fineStep * 1.5) || coarse[1];
    const peakSeparation = runnerUp && best.score > EPSILON
      ? Math.max(0, (best.score - runnerUp.score) / best.score)
      : 0;
    const improvementOverZero = zeroScore > EPSILON
      ? Math.max(0, (best.score - zeroScore) / zeroScore)
      : 0;
    const confidence = clamp(Math.max(peakSeparation, improvementOverZero), 0, 1);
    const angle = Math.round(best.angle * 10_000) / 10_000;
    return {
      angle,
      correctionAngle: -angle,
      score: best.score,
      confidence,
      foregroundPixels: points.length,
      foregroundRatio,
      threshold,
      samplingStep,
    };
  }

  function calculateRotatedBounds(width, height, angleDegrees) {
    assertDimensions(width, height);
    assertFiniteNumber(angleDegrees, "angleDegrees");
    const radians = angleDegrees * DEG_TO_RAD;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    return Object.freeze({
      width: Math.max(1, Math.ceil(width * cosine + height * sine - EPSILON)),
      height: Math.max(1, Math.ceil(width * sine + height * cosine - EPSILON)),
    });
  }

  function sampleNearest(data, width, height, x, y, background) {
    const sourceX = Math.round(x);
    const sourceY = Math.round(y);
    if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) return background;
    return Number(data[sourceY * width + sourceX]);
  }

  function sampleBilinear(data, width, height, x, y, background) {
    const left = Math.floor(x);
    const top = Math.floor(y);
    const fractionX = x - left;
    const fractionY = y - top;
    const at = (sampleX, sampleY) => (
      sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height
        ? background
        : Number(data[sampleY * width + sampleX])
    );
    const topValue = at(left, top) * (1 - fractionX) + at(left + 1, top) * fractionX;
    const bottomValue = at(left, top + 1) * (1 - fractionX) + at(left + 1, top + 1) * fractionX;
    return topValue * (1 - fractionY) + bottomValue * fractionY;
  }

  function rotateGrayscale(input, width, height, angleDegrees, options = {}) {
    const resolved = resolveGrayscaleInput(input, width, height);
    assertFiniteNumber(angleDegrees, "angleDegrees");
    const expand = options.expand !== false;
    const bounds = expand
      ? calculateRotatedBounds(resolved.width, resolved.height, angleDegrees)
      : { width: resolved.width, height: resolved.height };
    const background = clamp(Math.round(Number(options.background ?? 255)), 0, 255);
    const interpolation = options.interpolation ?? "bilinear";
    if (interpolation !== "bilinear" && interpolation !== "nearest") {
      throw new TypeError('interpolation must be "bilinear" or "nearest".');
    }
    const output = new Uint8ClampedArray(bounds.width * bounds.height);
    const radians = angleDegrees * DEG_TO_RAD;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const sourceCenterX = (resolved.width - 1) / 2;
    const sourceCenterY = (resolved.height - 1) / 2;
    const outputCenterX = (bounds.width - 1) / 2;
    const outputCenterY = (bounds.height - 1) / 2;
    const sampler = interpolation === "nearest" ? sampleNearest : sampleBilinear;
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) {
        const deltaX = x - outputCenterX;
        const deltaY = y - outputCenterY;
        const sourceX = cosine * deltaX + sine * deltaY + sourceCenterX;
        const sourceY = -sine * deltaX + cosine * deltaY + sourceCenterY;
        output[y * bounds.width + x] = Math.round(sampler(
          resolved.data,
          resolved.width,
          resolved.height,
          sourceX,
          sourceY,
          background,
        ));
      }
    }
    return {
      data: output,
      width: bounds.width,
      height: bounds.height,
      angle: angleDegrees,
      expanded: expand,
    };
  }

  function createCanvas(width, height, canvasFactory) {
    if (typeof canvasFactory === "function") return canvasFactory(width, height);
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
    if (typeof document === "object" && typeof document.createElement === "function") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    throw new Error("No Canvas implementation is available; provide canvasFactory.");
  }

  /** Canvas-only wrapper. All angle and output-bound calculations remain pure. */
  function rotateCanvas(sourceCanvas, angleDegrees, options = {}) {
    if (!sourceCanvas || !Number.isFinite(sourceCanvas.width) || !Number.isFinite(sourceCanvas.height)) {
      throw new TypeError("sourceCanvas must expose finite width and height.");
    }
    assertDimensions(sourceCanvas.width, sourceCanvas.height);
    assertFiniteNumber(angleDegrees, "angleDegrees");
    const expand = options.expand !== false;
    const naturalBounds = expand
      ? calculateRotatedBounds(sourceCanvas.width, sourceCanvas.height, angleDegrees)
      : { width: sourceCanvas.width, height: sourceCanvas.height };
    const maximumPixels = Number(options.maximumPixels ?? Infinity);
    const maximumDimension = Number(options.maximumDimension ?? Infinity);
    if (
      Number.isNaN(maximumPixels)
      || Number.isNaN(maximumDimension)
      || maximumPixels <= 0
      || maximumDimension <= 0
    ) {
      throw new RangeError("rotation output limits must be positive numbers.");
    }
    const outputScale = Math.min(
      1,
      Math.sqrt(maximumPixels / (naturalBounds.width * naturalBounds.height)),
      maximumDimension / naturalBounds.width,
      maximumDimension / naturalBounds.height,
    );
    const bounds = {
      width: Math.max(1, Math.floor(naturalBounds.width * outputScale)),
      height: Math.max(1, Math.floor(naturalBounds.height * outputScale)),
    };
    const canvas = createCanvas(bounds.width, bounds.height, options.canvasFactory);
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = canvas.getContext?.("2d", { alpha: false });
    if (!context) throw new Error("A 2D Canvas context is required.");
    context.save();
    context.fillStyle = options.background ?? "#ffffff";
    context.fillRect(0, 0, bounds.width, bounds.height);
    context.imageSmoothingEnabled = options.imageSmoothingEnabled !== false;
    context.translate(bounds.width / 2, bounds.height / 2);
    if (outputScale < 1) context.scale(outputScale, outputScale);
    context.rotate(angleDegrees * DEG_TO_RAD);
    context.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
    context.restore();
    return canvas;
  }

  function readCanvasGrayscale(canvas, options = {}) {
    if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)) {
      throw new TypeError("canvas must expose finite width and height.");
    }
    assertDimensions(canvas.width, canvas.height);
    const context = canvas.getContext?.("2d", { willReadFrequently: true });
    if (!context) throw new Error("A 2D Canvas context is required.");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: toGrayscale(image, canvas.width, canvas.height, options),
      width: canvas.width,
      height: canvas.height,
    };
  }

  function normalizeText(text, normalization) {
    const value = String(text ?? "");
    return normalization ? value.normalize(normalization) : value;
  }

  function scoreRow(left, right) {
    let previous = new Uint32Array(right.length + 1);
    let current = new Uint32Array(right.length + 1);
    for (let column = 0; column <= right.length; column += 1) previous[column] = column;
    for (let row = 1; row <= left.length; row += 1) {
      current[0] = row;
      for (let column = 1; column <= right.length; column += 1) {
        current[column] = Math.min(
          previous[column] + 1,
          current[column - 1] + 1,
          previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
        );
      }
      [previous, current] = [current, previous];
    }
    return previous;
  }

  function alignSmall(left, right) {
    const rows = left.length + 1;
    const columns = right.length + 1;
    const costs = new Uint32Array(rows * columns);
    const at = (row, column) => row * columns + column;
    for (let row = 0; row < rows; row += 1) costs[at(row, 0)] = row;
    for (let column = 0; column < columns; column += 1) costs[at(0, column)] = column;
    for (let row = 1; row < rows; row += 1) {
      for (let column = 1; column < columns; column += 1) {
        costs[at(row, column)] = Math.min(
          costs[at(row - 1, column)] + 1,
          costs[at(row, column - 1)] + 1,
          costs[at(row - 1, column - 1)] + (left[row - 1] === right[column - 1] ? 0 : 1),
        );
      }
    }
    const pairs = [];
    let row = left.length;
    let column = right.length;
    while (row > 0 || column > 0) {
      if (
        row > 0
        && column > 0
        && costs[at(row, column)] === costs[at(row - 1, column - 1)]
          + (left[row - 1] === right[column - 1] ? 0 : 1)
      ) {
        pairs.push([left[row - 1], right[column - 1]]);
        row -= 1;
        column -= 1;
      } else if (row > 0 && costs[at(row, column)] === costs[at(row - 1, column)] + 1) {
        pairs.push([left[row - 1], null]);
        row -= 1;
      } else {
        pairs.push([null, right[column - 1]]);
        column -= 1;
      }
    }
    return pairs.reverse();
  }

  function hirschberg(left, right) {
    if (left.length === 0) return right.map((character) => [null, character]);
    if (right.length === 0) return left.map((character) => [character, null]);
    if (left.length === 1 || right.length === 1) return alignSmall(left, right);
    const middle = Math.floor(left.length / 2);
    const leftHalf = left.slice(0, middle);
    const rightHalf = left.slice(middle);
    const forward = scoreRow(leftHalf, right);
    const backward = scoreRow([...rightHalf].reverse(), [...right].reverse());
    let split = 0;
    let best = Infinity;
    for (let column = 0; column <= right.length; column += 1) {
      const cost = forward[column] + backward[right.length - column];
      if (cost < best) {
        best = cost;
        split = column;
      }
    }
    return [
      ...hirschberg(leftHalf, right.slice(0, split)),
      ...hirschberg(rightHalf, right.slice(split)),
    ];
  }

  function alignText(leftText, rightText, options = {}) {
    const normalization = options.normalization === undefined ? "NFC" : options.normalization;
    const left = [...normalizeText(leftText, normalization)];
    const right = [...normalizeText(rightText, normalization)];
    const pairs = hirschberg(left, right);
    const operations = [];
    let leftIndex = 0;
    let rightIndex = 0;
    let distance = 0;
    for (const [leftCharacter, rightCharacter] of pairs) {
      let type;
      if (leftCharacter === null) type = "insert";
      else if (rightCharacter === null) type = "delete";
      else if (leftCharacter === rightCharacter) type = "equal";
      else type = "replace";
      if (type !== "equal") distance += 1;
      operations.push(Object.freeze({
        type,
        left: leftCharacter,
        right: rightCharacter,
        leftIndex: leftCharacter === null ? null : leftIndex,
        rightIndex: rightCharacter === null ? null : rightIndex,
      }));
      if (leftCharacter !== null) leftIndex += 1;
      if (rightCharacter !== null) rightIndex += 1;
    }
    const denominator = Math.max(left.length, right.length);
    return Object.freeze({
      left: left.join(""),
      right: right.join(""),
      distance,
      similarity: denominator === 0 ? 1 : 1 - distance / denominator,
      operations: Object.freeze(operations),
    });
  }

  function addVote(map, token, weight) {
    map.set(token, (map.get(token) || 0) + weight);
  }

  function winningVote(votes, preferredToken) {
    let winner = preferredToken;
    let winningWeight = -1;
    for (const [token, weight] of votes) {
      if (weight > winningWeight + EPSILON) {
        winner = token;
        winningWeight = weight;
      } else if (Math.abs(weight - winningWeight) <= EPSILON && token === preferredToken) {
        winner = token;
      }
    }
    return { token: winner, weight: Math.max(0, winningWeight) };
  }

  function sampleTextForAgreement(text, maximumCharacters = 800) {
    const source = String(text ?? "");
    if (!source.trim()) return "";
    if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 9) {
      throw new TypeError("maximumCharacters must be a safe integer of at least 9.");
    }
    const characters = [...source];
    if (characters.length <= maximumCharacters) return source;
    const separator = ["\n", "…", "\n"];
    const available = maximumCharacters - separator.length * 2;
    const headLength = Math.ceil(available * 0.4);
    const middleLength = Math.floor(available * 0.2);
    const tailLength = available - headLength - middleLength;
    const middleStart = Math.max(
      headLength,
      Math.floor((characters.length - middleLength) / 2),
    );
    return [
      ...characters.slice(0, headLength),
      ...separator,
      ...characters.slice(middleStart, middleStart + middleLength),
      ...separator,
      ...characters.slice(-tailLength),
    ].join("");
  }

  function buildCandidateConsensus(candidates, options = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new TypeError("candidates must be a non-empty array.");
    }
    const normalization = options.normalization === undefined ? "NFC" : options.normalization;
    const prepared = candidates.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object") {
        throw new TypeError("Each candidate must be an object.");
      }
      const text = normalizeText(candidate.text, normalization);
      const numericConfidence = Number(candidate.confidence);
      const confidence = Number.isFinite(numericConfidence)
        ? clamp(numericConfidence, 0, 100) / 100
        : 0.5;
      return {
        candidate,
        originalIndex: index,
        text,
        confidence,
        weight: 0.5 + confidence * 0.5,
      };
    });
    const hasNonEmpty = prepared.some((entry) => entry.text.trim().length > 0);
    const active = options.ignoreEmpty === false || !hasNonEmpty
      ? prepared
      : prepared.filter((entry) => entry.text.trim().length > 0);
    const count = active.length;
    const similarities = Array.from({ length: count }, () => new Float64Array(count));
    for (let index = 0; index < count; index += 1) similarities[index][index] = 1;
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        const similarity = alignText(active[left].text, active[right].text, {
          normalization: null,
        }).similarity;
        similarities[left][right] = similarity;
        similarities[right][left] = similarity;
      }
    }
    const agreementWeight = Number(options.agreementWeight ?? 0.8);
    const confidenceWeight = Number(options.confidenceWeight ?? 0.2);
    if (
      !Number.isFinite(agreementWeight)
      || !Number.isFinite(confidenceWeight)
      || agreementWeight < 0
      || confidenceWeight < 0
      || agreementWeight + confidenceWeight <= 0
    ) {
      throw new RangeError("candidate scoring weights must be non-negative with a positive sum.");
    }
    const scoreTotal = agreementWeight + confidenceWeight;
    const evaluations = active.map((entry, index) => {
      let weightedAgreement = 0;
      let otherWeight = 0;
      for (let other = 0; other < count; other += 1) {
        if (other === index) continue;
        weightedAgreement += similarities[index][other] * active[other].weight;
        otherWeight += active[other].weight;
      }
      const agreement = otherWeight > 0 ? weightedAgreement / otherWeight : 1;
      const score = (
        agreement * agreementWeight + entry.confidence * confidenceWeight
      ) / scoreTotal;
      return { ...entry, activeIndex: index, agreement, score };
    });
    evaluations.sort((left, right) => (
      right.score - left.score
      || right.agreement - left.agreement
      || right.confidence - left.confidence
      || left.originalIndex - right.originalIndex
    ));
    const selected = evaluations[0];
    const anchorCharacters = [...selected.text];
    const positionVotes = anchorCharacters.map(() => new Map());
    const insertionVotes = Array.from({ length: anchorCharacters.length + 1 }, () => new Map());
    const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);

    for (const entry of active) {
      const alignment = alignText(selected.text, entry.text, { normalization: null });
      const insertions = Array.from({ length: anchorCharacters.length + 1 }, () => []);
      let anchorIndex = 0;
      for (const operation of alignment.operations) {
        if (operation.left === null) {
          insertions[anchorIndex].push(operation.right);
          continue;
        }
        addVote(positionVotes[anchorIndex], operation.right, entry.weight);
        anchorIndex += 1;
      }
      for (let gap = 0; gap < insertions.length; gap += 1) {
        addVote(insertionVotes[gap], insertions[gap].join(""), entry.weight);
      }
    }

    const minimumVoteRatio = Number(options.minimumVoteRatio ?? 0.5);
    if (!Number.isFinite(minimumVoteRatio) || minimumVoteRatio < 0 || minimumVoteRatio > 1) {
      throw new RangeError("minimumVoteRatio must be between 0 and 1.");
    }
    let consensusText = "";
    let supportedWeight = 0;
    let decisions = 0;
    const disagreements = [];
    for (let gap = 0; gap <= anchorCharacters.length; gap += 1) {
      const insertion = winningVote(insertionVotes[gap], "");
      const insertionRatio = totalWeight > 0 ? insertion.weight / totalWeight : 0;
      if (insertion.token && insertionRatio >= minimumVoteRatio) consensusText += insertion.token;
      const insertionChoices = insertionVotes[gap];
      const hasNonEmptyInsertion = [...insertionChoices.keys()].some((token) => token !== "");
      if (hasNonEmptyInsertion) {
        supportedWeight += insertion.weight;
        decisions += 1;
        if (insertionChoices.size > 1 || insertionRatio < minimumVoteRatio) {
          disagreements.push(Object.freeze({
            index: gap,
            kind: "insertion",
            anchor: "",
            selected: insertion.token && insertionRatio >= minimumVoteRatio
              ? insertion.token
              : "",
            support: insertionRatio,
          }));
        }
      }
      if (gap === anchorCharacters.length) break;
      const preferred = anchorCharacters[gap];
      const vote = winningVote(positionVotes[gap], preferred);
      const ratio = totalWeight > 0 ? vote.weight / totalWeight : 0;
      const token = ratio >= minimumVoteRatio ? vote.token : preferred;
      if (token !== null) consensusText += token;
      supportedWeight += vote.weight;
      decisions += 1;
      if (positionVotes[gap].size > 1 || ratio < minimumVoteRatio) {
        disagreements.push(Object.freeze({
          index: gap,
          anchor: preferred,
          selected: token,
          support: ratio,
        }));
      }
    }

    const publicEvaluations = evaluations
      .sort((left, right) => left.originalIndex - right.originalIndex)
      .map((entry) => Object.freeze({
        index: entry.originalIndex,
        candidate: entry.candidate,
        text: entry.text,
        agreement: entry.agreement,
        confidence: entry.confidence * 100,
        score: entry.score,
      }));
    const voteAgreement = decisions > 0 && totalWeight > 0
      ? supportedWeight / (decisions * totalWeight)
      : 1;
    return Object.freeze({
      consensusText,
      selectedIndex: selected.originalIndex,
      selectedCandidate: selected.candidate,
      activeCandidateCount: count,
      agreement: selected.agreement,
      voteAgreement,
      disagreements: Object.freeze(disagreements),
      evaluations: Object.freeze(publicEvaluations),
      pairwiseSimilarities: Object.freeze(similarities.map((row) => Object.freeze([...row]))),
    });
  }

  return Object.freeze({
    alignText,
    binarizeOtsu,
    binarizeSauvola,
    buildCandidateConsensus,
    calculateExpandedRoi,
    calculateRotatedBounds,
    computeImageStatistics,
    computeOtsuThreshold,
    createHistogram,
    enhanceRgbaPercentilesInPlace,
    estimateDeskewAngle,
    percentileFromHistogram,
    readCanvasGrayscale,
    rotateCanvas,
    rotateGrayscale,
    sampleTextForAgreement,
    stretchGrayscalePercentiles,
    toGrayscale,
  });
});
