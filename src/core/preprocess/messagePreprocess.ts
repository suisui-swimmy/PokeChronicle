export type PreprocessBackground = "black" | "white";

export interface MessagePreprocessOptions {
  whiteThreshold: number;
  background: PreprocessBackground;
  invert: boolean;
}

export interface MessagePreprocessMetrics {
  foregroundPixelCount: number;
  totalPixelCount: number;
  foregroundPixelRatio: number;
}

export interface MessageLineBandDetectionOptions {
  minRowForegroundPixelCount?: number;
  minRowForegroundPixelRatio?: number;
  mergeGapPx?: number;
  verticalPaddingPx?: number;
  minBandHeightPx?: number;
  minBandForegroundPixelCount?: number;
  maxBandForegroundPixelRatio?: number;
}

export interface MessageLineBand {
  y: number;
  height: number;
  foregroundPixelCount: number;
  totalPixelCount: number;
  foregroundPixelRatio: number;
  peakRowForegroundPixelCount: number;
}

export interface MessageLineCropVariant {
  id: "full" | `top-${number}-lines`;
  imageData: ImageData;
  y: number;
  height: number;
  lineCount: number;
  bands: MessageLineBand[];
  metrics: MessagePreprocessMetrics;
}

function clampByte(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function getOutputValues(background: PreprocessBackground, invert: boolean) {
  const backgroundValue = background === "black" ? 0 : 255;
  const foregroundValue = background === "black" ? 255 : 0;

  if (!invert) {
    return { backgroundValue, foregroundValue };
  }

  return {
    backgroundValue: foregroundValue,
    foregroundValue: backgroundValue,
  };
}

export function preprocessMessageImageData(
  source: ImageData,
  options: MessagePreprocessOptions,
) {
  const threshold = clampByte(options.whiteThreshold);
  const { backgroundValue, foregroundValue } = getOutputValues(
    options.background,
    options.invert,
  );
  const output = new ImageData(source.width, source.height);

  for (let index = 0; index < source.data.length; index += 4) {
    const red = source.data[index];
    const green = source.data[index + 1];
    const blue = source.data[index + 2];
    const alpha = source.data[index + 3];
    const minChannel = Math.min(red, green, blue);
    const maxChannel = Math.max(red, green, blue);
    const isBrightTextCandidate =
      alpha > 0 && minChannel >= threshold && maxChannel - minChannel <= 72;
    const value = isBrightTextCandidate ? foregroundValue : backgroundValue;

    output.data[index] = value;
    output.data[index + 1] = value;
    output.data[index + 2] = value;
    output.data[index + 3] = 255;
  }

  return output;
}

function isProcessedForegroundPixel(
  data: Uint8ClampedArray,
  index: number,
  foregroundValue: number,
) {
  const alpha = data[index + 3];

  if (alpha === 0) {
    return false;
  }

  const tolerance = 8;

  return (
    Math.abs(data[index] - foregroundValue) <= tolerance &&
    Math.abs(data[index + 1] - foregroundValue) <= tolerance &&
    Math.abs(data[index + 2] - foregroundValue) <= tolerance
  );
}

export function analyzeProcessedMessageImageData(
  processed: ImageData,
  options: MessagePreprocessOptions,
): MessagePreprocessMetrics {
  const { foregroundValue } = getOutputValues(options.background, options.invert);
  const totalPixelCount = processed.width * processed.height;
  let foregroundPixelCount = 0;

  for (let index = 0; index < processed.data.length; index += 4) {
    if (isProcessedForegroundPixel(processed.data, index, foregroundValue)) {
      foregroundPixelCount += 1;
    }
  }

  return {
    foregroundPixelCount,
    totalPixelCount,
    foregroundPixelRatio:
      totalPixelCount === 0 ? 0 : foregroundPixelCount / totalPixelCount,
  };
}

export function preprocessMessageImageDataWithMetrics(
  source: ImageData,
  options: MessagePreprocessOptions,
) {
  const imageData = preprocessMessageImageData(source, options);

  return {
    imageData,
    metrics: analyzeProcessedMessageImageData(imageData, options),
  };
}

function getLineBandDetectionOptions(
  width: number,
  options: MessageLineBandDetectionOptions = {},
) {
  return {
    minRowForegroundPixelCount:
      options.minRowForegroundPixelCount ?? Math.max(2, Math.ceil(width * 0.004)),
    minRowForegroundPixelRatio: options.minRowForegroundPixelRatio ?? 0.0025,
    mergeGapPx: options.mergeGapPx ?? 2,
    verticalPaddingPx: options.verticalPaddingPx ?? 2,
    minBandHeightPx: options.minBandHeightPx ?? 2,
    minBandForegroundPixelCount: options.minBandForegroundPixelCount ?? 6,
    maxBandForegroundPixelRatio: options.maxBandForegroundPixelRatio ?? 0.36,
  };
}

function cloneImageData(source: ImageData) {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

function cropImageData(source: ImageData, y: number, height: number) {
  const safeY = Math.max(0, Math.min(source.height, Math.floor(y)));
  const safeHeight = Math.max(0, Math.min(source.height - safeY, Math.ceil(height)));
  const output = new ImageData(source.width, safeHeight);
  const rowByteLength = source.width * 4;

  for (let row = 0; row < safeHeight; row += 1) {
    const sourceStart = (safeY + row) * rowByteLength;
    const sourceEnd = sourceStart + rowByteLength;
    output.data.set(source.data.slice(sourceStart, sourceEnd), row * rowByteLength);
  }

  return output;
}

function analyzeProcessedBand(
  processed: ImageData,
  options: MessagePreprocessOptions,
  y: number,
  height: number,
  rowForegroundCounts: readonly number[],
): MessageLineBand {
  const { foregroundValue } = getOutputValues(options.background, options.invert);
  const safeY = Math.max(0, Math.min(processed.height, Math.floor(y)));
  const safeHeight = Math.max(0, Math.min(processed.height - safeY, Math.ceil(height)));
  const totalPixelCount = processed.width * safeHeight;
  let foregroundPixelCount = 0;

  for (let row = safeY; row < safeY + safeHeight; row += 1) {
    const rowStart = row * processed.width * 4;

    for (let column = 0; column < processed.width; column += 1) {
      const index = rowStart + column * 4;

      if (isProcessedForegroundPixel(processed.data, index, foregroundValue)) {
        foregroundPixelCount += 1;
      }
    }
  }

  return {
    y: safeY,
    height: safeHeight,
    foregroundPixelCount,
    totalPixelCount,
    foregroundPixelRatio:
      totalPixelCount === 0 ? 0 : foregroundPixelCount / totalPixelCount,
    peakRowForegroundPixelCount: Math.max(
      0,
      ...rowForegroundCounts.slice(safeY, safeY + safeHeight),
    ),
  };
}

function collectRowForegroundCounts(
  processed: ImageData,
  options: MessagePreprocessOptions,
) {
  const { foregroundValue } = getOutputValues(options.background, options.invert);
  const rows = Array.from({ length: processed.height }, () => 0);

  for (let row = 0; row < processed.height; row += 1) {
    const rowStart = row * processed.width * 4;

    for (let column = 0; column < processed.width; column += 1) {
      const index = rowStart + column * 4;

      if (isProcessedForegroundPixel(processed.data, index, foregroundValue)) {
        rows[row] += 1;
      }
    }
  }

  return rows;
}

export function detectMessageLineBands(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  detectionOptions: MessageLineBandDetectionOptions = {},
): MessageLineBand[] {
  const options = getLineBandDetectionOptions(processed.width, detectionOptions);
  const rowForegroundCounts = collectRowForegroundCounts(processed, preprocessOptions);
  const activeRows = rowForegroundCounts.map((count) => {
    const ratio = processed.width === 0 ? 0 : count / processed.width;

    return (
      count >= options.minRowForegroundPixelCount ||
      ratio >= options.minRowForegroundPixelRatio
    );
  });
  const bands: Array<{ start: number; end: number }> = [];
  let activeStart: number | null = null;
  let lastActive = -1;

  activeRows.forEach((isActive, row) => {
    if (isActive) {
      if (activeStart === null) {
        activeStart = row;
      }

      lastActive = row;
      return;
    }

    if (activeStart !== null && row - lastActive > options.mergeGapPx) {
      bands.push({ start: activeStart, end: lastActive + 1 });
      activeStart = null;
      lastActive = -1;
    }
  });

  if (activeStart !== null) {
    bands.push({ start: activeStart, end: lastActive + 1 });
  }

  return bands
    .map((band) => {
      const paddedStart = Math.max(0, band.start - options.verticalPaddingPx);
      const paddedEnd = Math.min(processed.height, band.end + options.verticalPaddingPx);

      return analyzeProcessedBand(
        processed,
        preprocessOptions,
        paddedStart,
        paddedEnd - paddedStart,
        rowForegroundCounts,
      );
    })
    .filter(
      (band) =>
        band.height >= options.minBandHeightPx &&
        band.foregroundPixelCount >= options.minBandForegroundPixelCount &&
        band.foregroundPixelRatio <= options.maxBandForegroundPixelRatio,
    )
    .sort((left, right) => left.y - right.y);
}

function createLineCropVariant(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  bands: MessageLineBand[],
  lineCount: number,
): MessageLineCropVariant | null {
  const selectedBands = bands.slice(0, lineCount);

  if (selectedBands.length === 0) {
    return null;
  }

  const y = selectedBands[0].y;
  const endY = Math.max(...selectedBands.map((band) => band.y + band.height));
  const height = Math.max(1, endY - y);

  if (y === 0 && height === processed.height) {
    return null;
  }

  const imageData = cropImageData(processed, y, height);

  return {
    id: `top-${selectedBands.length}-lines`,
    imageData,
    y,
    height,
    lineCount: selectedBands.length,
    bands: selectedBands,
    metrics: analyzeProcessedMessageImageData(imageData, preprocessOptions),
  };
}

export function createMessageLineCropVariants(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  detectionOptions: MessageLineBandDetectionOptions = {},
): MessageLineCropVariant[] {
  const bands = detectMessageLineBands(processed, preprocessOptions, detectionOptions);
  const fullVariant: MessageLineCropVariant = {
    id: "full",
    imageData: cloneImageData(processed),
    y: 0,
    height: processed.height,
    lineCount: bands.length,
    bands,
    metrics: analyzeProcessedMessageImageData(processed, preprocessOptions),
  };
  const variants = [fullVariant];
  const seen = new Set([`0:${processed.height}`]);
  const maxLineVariants = Math.min(3, bands.length);

  for (let lineCount = 1; lineCount <= maxLineVariants; lineCount += 1) {
    const variant = createLineCropVariant(
      processed,
      preprocessOptions,
      bands,
      lineCount,
    );

    if (!variant) {
      continue;
    }

    const key = `${variant.y}:${variant.height}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    variants.push(variant);
  }

  return variants;
}
