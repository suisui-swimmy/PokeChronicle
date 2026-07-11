export type PreprocessBackground = "black" | "white";
export type MessageTextMask = "white" | "yellow" | "white-yellow";

export interface MessagePreprocessOptions {
  whiteThreshold: number;
  background: PreprocessBackground;
  invert: boolean;
  textMask?: MessageTextMask;
}

export interface MessagePreprocessMetrics {
  foregroundPixelCount: number;
  totalPixelCount: number;
  foregroundPixelRatio: number;
}

export interface MessageForegroundComponentMetrics {
  componentCount: number;
  largestComponentPixelCount: number;
  largestComponentForegroundRatio: number;
  textLikeComponentCount: number;
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
  id:
    | "full"
    | `top-${number}-lines`
    | `line-${number}`
    | `annotation-suppressed-top-${number}-lines`
    | `annotation-suppressed-line-${number}`;
  imageData: ImageData;
  y: number;
  height: number;
  lineCount: number;
  bands: MessageLineBand[];
  metrics: MessagePreprocessMetrics;
}

export interface MessagePreprocessVariant {
  id: MessageTextMask;
  imageData: ImageData;
  metrics: MessagePreprocessMetrics;
  componentMetrics: MessageForegroundComponentMetrics;
  lineCropVariants: MessageLineCropVariant[];
  isOcrCandidate: boolean;
  rejectReason: "density" | "component" | "line-band" | null;
  score: number;
}

export interface MessagePreprocessVariantOptions {
  minForegroundPixelRatio?: number;
  maxForegroundPixelRatio?: number;
  maxLargestComponentForegroundRatio?: number;
  detectionOptions?: MessageLineBandDetectionOptions;
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

function getTextMask(options: MessagePreprocessOptions): MessageTextMask {
  return options.textMask ?? "white";
}

export function isBrightWhiteTextPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  threshold: number,
) {
  const minChannel = Math.min(red, green, blue);
  const maxChannel = Math.max(red, green, blue);

  return alpha > 0 && minChannel >= threshold && maxChannel - minChannel <= 72;
}

export function isBrightYellowTextPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
) {
  if (alpha <= 0) {
    return false;
  }

  const redGreenFloor = Math.min(red, green);
  const redGreenDelta = Math.abs(red - green);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

  return (
    redGreenFloor >= 145 &&
    blue <= 150 &&
    red - blue >= 55 &&
    green - blue >= 45 &&
    redGreenDelta <= 82 &&
    luminance >= 140 &&
    chroma >= 48
  );
}

function isTextMaskPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  options: MessagePreprocessOptions,
) {
  const textMask = getTextMask(options);
  const isWhite = textMask !== "yellow" &&
    isBrightWhiteTextPixel(red, green, blue, alpha, clampByte(options.whiteThreshold));
  const isYellow = textMask !== "white" && isBrightYellowTextPixel(red, green, blue, alpha);

  return isWhite || isYellow;
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
    const isBrightTextCandidate = isTextMaskPixel(red, green, blue, alpha, {
      ...options,
      whiteThreshold: threshold,
    });
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

export function analyzeProcessedForegroundComponents(
  processed: ImageData,
  options: MessagePreprocessOptions,
): MessageForegroundComponentMetrics {
  const { foregroundValue } = getOutputValues(options.background, options.invert);
  const width = processed.width;
  const height = processed.height;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  let componentCount = 0;
  let largestComponentPixelCount = 0;
  let textLikeComponentCount = 0;
  let foregroundPixelCount = 0;

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;

    if (isProcessedForegroundPixel(processed.data, dataIndex, foregroundValue)) {
      foregroundPixelCount += 1;
    }
  }

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    if (visited[pixelIndex]) {
      continue;
    }

    const startDataIndex = pixelIndex * 4;

    if (!isProcessedForegroundPixel(processed.data, startDataIndex, foregroundValue)) {
      visited[pixelIndex] = 1;
      continue;
    }

    componentCount += 1;
    queue.length = 0;
    queue.push(pixelIndex);
    visited[pixelIndex] = 1;

    let componentPixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const current = queue[queueIndex];
      const x = current % width;
      const y = Math.floor(current / width);

      componentPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor]) {
          continue;
        }

        const neighborDataIndex = neighbor * 4;

        if (!isProcessedForegroundPixel(processed.data, neighborDataIndex, foregroundValue)) {
          visited[neighbor] = 1;
          continue;
        }

        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    largestComponentPixelCount = Math.max(largestComponentPixelCount, componentPixelCount);

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const componentArea = componentWidth * componentHeight;
    const fillRatio = componentArea === 0 ? 1 : componentPixelCount / componentArea;

    if (
      componentPixelCount >= 2 &&
      componentWidth >= 2 &&
      componentHeight >= 1 &&
      (componentArea <= 6 || fillRatio <= 0.92)
    ) {
      textLikeComponentCount += 1;
    }
  }

  return {
    componentCount,
    largestComponentPixelCount,
    largestComponentForegroundRatio:
      foregroundPixelCount === 0 ? 0 : largestComponentPixelCount / foregroundPixelCount,
    textLikeComponentCount,
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

function scorePreprocessVariant(
  id: MessageTextMask,
  metrics: MessagePreprocessMetrics,
  componentMetrics: MessageForegroundComponentMetrics,
  lineCropVariants: MessageLineCropVariant[],
  isOcrCandidate: boolean,
) {
  const preferredMaskBias =
    id === "white" ? 0.03 : id === "white-yellow" ? 0.02 : 0.01;

  if (!isOcrCandidate) {
    return preferredMaskBias + metrics.foregroundPixelRatio;
  }

  const lineBandCount = lineCropVariants[0]?.lineCount ?? 0;
  const densityScore = Math.min(metrics.foregroundPixelRatio, 0.04) * 10;
  const componentPenalty = componentMetrics.largestComponentForegroundRatio * 0.04;

  return preferredMaskBias + lineBandCount * 0.08 + densityScore - componentPenalty;
}

export function createMessagePreprocessVariants(
  source: ImageData,
  options: MessagePreprocessOptions,
  variantOptions: MessagePreprocessVariantOptions = {},
): MessagePreprocessVariant[] {
  const minForegroundPixelRatio = variantOptions.minForegroundPixelRatio ?? 0.002;
  const maxForegroundPixelRatio = variantOptions.maxForegroundPixelRatio ?? 0.22;
  const maxLargestComponentForegroundRatio =
    variantOptions.maxLargestComponentForegroundRatio ?? 0.72;
  const variantIds: MessageTextMask[] = ["white", "yellow", "white-yellow"];

  return variantIds.map((id) => {
    const variantPreprocessOptions = { ...options, textMask: id };
    const { imageData, metrics } = preprocessMessageImageDataWithMetrics(
      source,
      variantPreprocessOptions,
    );
    const componentMetrics = analyzeProcessedForegroundComponents(
      imageData,
      variantPreprocessOptions,
    );
    const lineCropVariants = createMessageLineCropVariants(
      imageData,
      variantPreprocessOptions,
      variantOptions.detectionOptions,
    );
    const hasUsableDensity =
      metrics.foregroundPixelRatio >= minForegroundPixelRatio &&
      metrics.foregroundPixelRatio <= maxForegroundPixelRatio;
    const hasTextLikeComponents =
      componentMetrics.componentCount > 0 &&
      componentMetrics.textLikeComponentCount > 0 &&
      componentMetrics.largestComponentForegroundRatio <=
        maxLargestComponentForegroundRatio;
    const hasLineBand = (lineCropVariants[0]?.lineCount ?? 0) > 0;
    const rejectReason = !hasUsableDensity
      ? "density"
      : !hasTextLikeComponents
        ? "component"
        : !hasLineBand
          ? "line-band"
          : null;
    const isOcrCandidate = rejectReason === null;

    return {
      id,
      imageData,
      metrics,
      componentMetrics,
      lineCropVariants,
      isOcrCandidate,
      rejectReason,
      score: scorePreprocessVariant(
        id,
        metrics,
        componentMetrics,
        lineCropVariants,
        isOcrCandidate,
      ),
    };
  });
}

export function choosePreferredMessagePreprocessVariant(
  variants: readonly MessagePreprocessVariant[],
) {
  const candidates = variants.filter((variant) => variant.isOcrCandidate);
  const source = candidates.length > 0 ? candidates : variants;

  return [...source].sort((left, right) => right.score - left.score)[0] ?? null;
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
  return analyzeMessageLineBands(processed, preprocessOptions, detectionOptions).bands;
}

function detectRawMessageLineBands(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  detectionOptions: MessageLineBandDetectionOptions = {},
) {
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

  const detectedBands = bands
    .map((band) => {
      const paddedStart = Math.max(0, band.start - options.verticalPaddingPx);
      const paddedEnd = Math.min(processed.height, band.end + options.verticalPaddingPx);

      return {
        band: analyzeProcessedBand(
          processed,
          preprocessOptions,
          paddedStart,
          paddedEnd - paddedStart,
          rowForegroundCounts,
        ),
        rawY: band.start,
        rawHeight: band.end - band.start,
      };
    })
    .filter(
      (entry) =>
        entry.band.height >= options.minBandHeightPx &&
        entry.band.foregroundPixelCount >= options.minBandForegroundPixelCount &&
        entry.band.foregroundPixelRatio <= options.maxBandForegroundPixelRatio,
    )
    .sort((left, right) => left.band.y - right.band.y);

  return {
    bands: detectedBands.map((entry) => entry.band),
    rawRanges: detectedBands.map((entry) => ({ y: entry.rawY, height: entry.rawHeight })),
    rowForegroundCounts,
  };
}

function findAnnotationBandIndexes(bands: readonly MessageLineBand[], width: number) {
  const indexes = new Set<number>();

  for (let index = 0; index < bands.length - 1; index += 1) {
    const band = bands[index];
    const next = bands[index + 1];
    const gap = next.y - (band.y + band.height);
    const isSmallHeight = band.height <= Math.max(3, next.height * 0.62);
    const isSparse = band.foregroundPixelCount <= next.foregroundPixelCount * 0.45;
    const isWideEnough = band.peakRowForegroundPixelCount >= Math.max(3, Math.ceil(width * 0.006));
    const isNearby = gap <= Math.max(4, Math.ceil(next.height * 0.45));

    if (
      next.height >= 6 &&
      band.foregroundPixelCount >= 8 &&
      isSmallHeight &&
      isSparse &&
      isWideEnough &&
      isNearby
    ) {
      indexes.add(index);
    }
  }

  return indexes;
}

function mergeAnnotationBands(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  bands: readonly MessageLineBand[],
  annotationIndexes: ReadonlySet<number>,
  rowForegroundCounts: readonly number[],
) {
  const merged: MessageLineBand[] = [];

  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];

    if (annotationIndexes.has(index) && bands[index + 1]) {
      const next = bands[index + 1];
      const y = band.y;
      const endY = Math.max(band.y + band.height, next.y + next.height);

      merged.push(
        analyzeProcessedBand(
          processed,
          preprocessOptions,
          y,
          endY - y,
          rowForegroundCounts,
        ),
      );
      index += 1;
      continue;
    }

    merged.push(band);
  }

  return merged;
}

function analyzeMessageLineBands(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  detectionOptions: MessageLineBandDetectionOptions = {},
) {
  const raw = detectRawMessageLineBands(processed, preprocessOptions, detectionOptions);
  const annotationIndexes = findAnnotationBandIndexes(raw.bands, processed.width);

  return {
    rawBands: raw.bands,
    rawRanges: raw.rawRanges,
    annotationIndexes,
    bands: mergeAnnotationBands(
      processed,
      preprocessOptions,
      raw.bands,
      annotationIndexes,
      raw.rowForegroundCounts,
    ),
  };
}

function suppressAnnotationBands(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  rawRanges: readonly { y: number; height: number }[],
  annotationIndexes: ReadonlySet<number>,
) {
  const output = cloneImageData(processed);
  const { backgroundValue, foregroundValue } = getOutputValues(
    preprocessOptions.background,
    preprocessOptions.invert,
  );

  for (const index of annotationIndexes) {
    const band = rawRanges[index];
    const endY = Math.min(output.height, band.y + band.height);

    for (let y = Math.max(0, band.y); y < endY; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        const dataIndex = (y * output.width + x) * 4;

        if (!isProcessedForegroundPixel(output.data, dataIndex, foregroundValue)) {
          continue;
        }

        output.data[dataIndex] = backgroundValue;
        output.data[dataIndex + 1] = backgroundValue;
        output.data[dataIndex + 2] = backgroundValue;
        output.data[dataIndex + 3] = 255;
      }
    }
  }

  return output;
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

function createSingleLineCropVariant(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  band: MessageLineBand,
  index: number,
  prefix = "",
): MessageLineCropVariant {
  const imageData = cropImageData(processed, band.y, band.height);

  return {
    id: `${prefix}line-${index + 1}` as MessageLineCropVariant["id"],
    imageData,
    y: band.y,
    height: band.height,
    lineCount: 1,
    bands: [band],
    metrics: analyzeProcessedMessageImageData(imageData, preprocessOptions),
  };
}

export function createMessageLineCropVariants(
  processed: ImageData,
  preprocessOptions: MessagePreprocessOptions,
  detectionOptions: MessageLineBandDetectionOptions = {},
): MessageLineCropVariant[] {
  const analysis = analyzeMessageLineBands(processed, preprocessOptions, detectionOptions);
  const bands = analysis.bands;
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

  bands.slice(0, maxLineVariants).forEach((band, index) => {
    variants.push(createSingleLineCropVariant(processed, preprocessOptions, band, index));
  });

  if (analysis.annotationIndexes.size > 0) {
    const suppressed = suppressAnnotationBands(
      processed,
      preprocessOptions,
      analysis.rawRanges,
      analysis.annotationIndexes,
    );
    const topVariant = createLineCropVariant(
      suppressed,
      preprocessOptions,
      bands,
      maxLineVariants,
    );

    if (topVariant) {
      variants.push({
        ...topVariant,
        id: `annotation-suppressed-top-${maxLineVariants}-lines`,
      });
    }

    bands.slice(0, maxLineVariants).forEach((band, index) => {
      variants.push(
        createSingleLineCropVariant(
          suppressed,
          preprocessOptions,
          band,
          index,
          "annotation-suppressed-",
        ),
      );
    });
  }

  return variants;
}
