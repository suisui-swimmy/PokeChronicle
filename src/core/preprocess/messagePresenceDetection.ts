import {
  analyzeProcessedForegroundComponents,
  analyzeProcessedMessageImageData,
  createMessageMaskFingerprint,
  detectMessageLineBands,
  getMessageMaskFingerprintDistance,
  isBrightWhiteTextPixel,
  isBrightYellowTextPixel,
  type MessageLineBandDetectionOptions,
  type MessageMaskFingerprint,
  type MessagePreprocessOptions,
} from "./messagePreprocess";

export type MessagePresenceRejectReason =
  | "density-low"
  | "density-high"
  | "component"
  | "line-band"
  | null;

export interface MessagePresenceAnalysis {
  present: boolean;
  presenceScore: number;
  fingerprint: MessageMaskFingerprint | null;
  visualSignature: MessageVisualSignature | null;
  foregroundRatio: number;
  whiteForegroundRatio: number;
  yellowForegroundRatio: number;
  lineBandCount: number;
  componentCount: number;
  largestComponentRatio: number;
  rejectReason: MessagePresenceRejectReason;
}

export interface MessagePresenceConfig {
  whiteThreshold: number;
  minForegroundRatio: number;
  maxForegroundRatio: number;
  maxLargestComponentRatio: number;
  minTextLikeComponentCount: number;
  minLineBandCount: number;
  signatureGridColumns: number;
  signatureGridRows: number;
  signatureCellMinForegroundRatio: number;
  lineDetectionOptions: MessageLineBandDetectionOptions;
}

export interface MessageForegroundBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MessageVisualSignature {
  fingerprint: MessageMaskFingerprint;
  occupancyGrid: number[];
  gridColumns: number;
  gridRows: number;
  foregroundBounds: MessageForegroundBounds | null;
  lineBandCount: number;
  foregroundCellCount: number;
}

export interface MessageVisualComparison {
  fingerprintDistance: number;
  intersectionOverUnion: number;
  retainedFromPrevious: number;
  retainedFromCurrent: number;
  sharedOverMinimumForeground: number;
  boundsOverlap: number;
  progressiveRender: boolean;
  likelySameMessage: boolean;
}

export interface MessageVisualComparisonConfig {
  sameFingerprintDistance: number;
  progressiveRetainedFromPrevious: number;
  containmentSharedMinimum: number;
  minimumBoundsOverlap: number;
  maximumLineBandDelta: number;
}

export const DEFAULT_MESSAGE_PRESENCE_LINE_DETECTION_OPTIONS: Readonly<
  MessageLineBandDetectionOptions
> = {
  minRowForegroundPixelCount: 3,
  minRowForegroundPixelRatio: 0.004,
  mergeGapPx: 2,
  verticalPaddingPx: 1,
  minBandHeightPx: 2,
  minBandForegroundPixelCount: 8,
  maxBandForegroundPixelRatio: 0.36,
};

export const DEFAULT_MESSAGE_PRESENCE_CONFIG: Readonly<MessagePresenceConfig> = {
  whiteThreshold: 180,
  minForegroundRatio: 0.004,
  maxForegroundRatio: 0.18,
  maxLargestComponentRatio: 0.72,
  minTextLikeComponentCount: 1,
  minLineBandCount: 1,
  signatureGridColumns: 32,
  signatureGridRows: 12,
  signatureCellMinForegroundRatio: 0.015,
  lineDetectionOptions: DEFAULT_MESSAGE_PRESENCE_LINE_DETECTION_OPTIONS,
};

export const DEFAULT_MESSAGE_VISUAL_COMPARISON_CONFIG: Readonly<
  MessageVisualComparisonConfig
> = {
  sameFingerprintDistance: 0.22,
  progressiveRetainedFromPrevious: 0.65,
  containmentSharedMinimum: 0.7,
  minimumBoundsOverlap: 0.45,
  maximumLineBandDelta: 1,
};

const COMBINED_MASK_OPTIONS: MessagePreprocessOptions = {
  whiteThreshold: DEFAULT_MESSAGE_PRESENCE_CONFIG.whiteThreshold,
  background: "black",
  invert: false,
  textMask: "white-yellow",
};

const PRESENCE_SCORE_WEIGHTS = {
  density: 0.35,
  lineBands: 0.35,
  components: 0.3,
} as const;
const PRESENCE_DENSITY_SCORE_TARGET_MULTIPLIER = 4;
const PRESENCE_LINE_BAND_SCORE_TARGET = 2;
const PRESENCE_COMPONENT_SCORE_TARGET = 6;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function scoreRange(value: number, min: number, max: number) {
  if (max <= min) {
    return value >= max ? 1 : 0;
  }

  return clamp01((value - min) / (max - min));
}

function createCombinedMessageMask(
  source: ImageData,
  config: MessagePresenceConfig,
) {
  const output = new ImageData(source.width, source.height);
  let whiteForegroundPixelCount = 0;
  let yellowForegroundPixelCount = 0;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < source.data.length; index += 4) {
    const red = source.data[index];
    const green = source.data[index + 1];
    const blue = source.data[index + 2];
    const alpha = source.data[index + 3];
    const isWhite = isBrightWhiteTextPixel(
      red,
      green,
      blue,
      alpha,
      config.whiteThreshold,
    );
    const isYellow = isBrightYellowTextPixel(red, green, blue, alpha);
    const value = isWhite || isYellow ? 255 : 0;

    if (isWhite) {
      whiteForegroundPixelCount += 1;
    }

    if (isYellow) {
      yellowForegroundPixelCount += 1;
    }

    if (value > 0) {
      const pixelIndex = index / 4;
      const x = pixelIndex % source.width;
      const y = Math.floor(pixelIndex / source.width);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    output.data[index] = value;
    output.data[index + 1] = value;
    output.data[index + 2] = value;
    output.data[index + 3] = 255;
  }

  return {
    imageData: output,
    whiteForegroundPixelCount,
    yellowForegroundPixelCount,
    foregroundBounds:
      maxX < minX || maxY < minY
        ? null
        : {
            x: minX / Math.max(1, source.width),
            y: minY / Math.max(1, source.height),
            width: (maxX - minX + 1) / Math.max(1, source.width),
            height: (maxY - minY + 1) / Math.max(1, source.height),
          },
  };
}

function createOccupancyGrid(
  mask: ImageData,
  columns: number,
  rows: number,
  minimumForegroundRatio: number,
) {
  const safeColumns = Math.max(1, Math.round(columns));
  const safeRows = Math.max(1, Math.round(rows));
  const foregroundCounts = Array.from(
    { length: safeColumns * safeRows },
    () => 0,
  );
  const pixelCounts = Array.from(
    { length: safeColumns * safeRows },
    () => 0,
  );

  for (let y = 0; y < mask.height; y += 1) {
    const cellY = Math.min(
      safeRows - 1,
      Math.floor((y * safeRows) / Math.max(1, mask.height)),
    );

    for (let x = 0; x < mask.width; x += 1) {
      const cellX = Math.min(
        safeColumns - 1,
        Math.floor((x * safeColumns) / Math.max(1, mask.width)),
      );
      const cellIndex = cellY * safeColumns + cellX;
      const dataIndex = (y * mask.width + x) * 4;

      pixelCounts[cellIndex] += 1;
      if (mask.data[dataIndex] > 0) {
        foregroundCounts[cellIndex] += 1;
      }
    }
  }

  return foregroundCounts.map((count, index) => {
    const pixelCount = pixelCounts[index] ?? 0;
    const ratio = pixelCount === 0 ? 0 : count / pixelCount;

    return count > 0 && ratio >= minimumForegroundRatio ? 1 : 0;
  });
}

function getBoundsIntersectionOverUnion(
  left: MessageForegroundBounds | null,
  right: MessageForegroundBounds | null,
) {
  if (!left || !right) {
    return left === right ? 1 : 0;
  }

  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const unionArea =
    left.width * left.height +
    right.width * right.height -
    intersectionArea;

  return unionArea <= 0 ? 0 : intersectionArea / unionArea;
}

export function compareMessageVisualSignatures(
  previous: MessageVisualSignature,
  current: MessageVisualSignature,
  config: MessageVisualComparisonConfig =
    DEFAULT_MESSAGE_VISUAL_COMPARISON_CONFIG,
): MessageVisualComparison {
  const compatibleGrid =
    previous.gridColumns === current.gridColumns &&
    previous.gridRows === current.gridRows &&
    previous.occupancyGrid.length === current.occupancyGrid.length;
  let sharedCellCount = 0;
  let unionCellCount = 0;
  let previousCellCount = 0;
  let currentCellCount = 0;

  if (compatibleGrid) {
    previous.occupancyGrid.forEach((previousValue, index) => {
      const previousOccupied = previousValue > 0;
      const currentOccupied = (current.occupancyGrid[index] ?? 0) > 0;

      previousCellCount += previousOccupied ? 1 : 0;
      currentCellCount += currentOccupied ? 1 : 0;
      sharedCellCount += previousOccupied && currentOccupied ? 1 : 0;
      unionCellCount += previousOccupied || currentOccupied ? 1 : 0;
    });
  }

  const retainedFromPrevious =
    previousCellCount === 0 ? 0 : sharedCellCount / previousCellCount;
  const retainedFromCurrent =
    currentCellCount === 0 ? 0 : sharedCellCount / currentCellCount;
  const sharedOverMinimumForeground =
    Math.min(previousCellCount, currentCellCount) === 0
      ? 0
      : sharedCellCount / Math.min(previousCellCount, currentCellCount);
  const intersectionOverUnion =
    unionCellCount === 0 ? 0 : sharedCellCount / unionCellCount;
  const fingerprintDistance = getMessageMaskFingerprintDistance(
    previous.fingerprint,
    current.fingerprint,
  );
  const boundsOverlap = getBoundsIntersectionOverUnion(
    previous.foregroundBounds,
    current.foregroundBounds,
  );
  const lineBandDelta = Math.abs(
    previous.lineBandCount - current.lineBandCount,
  );
  const similarLineStructure =
    lineBandDelta <= config.maximumLineBandDelta;
  const progressiveRender =
    currentCellCount >= previousCellCount &&
    retainedFromPrevious >= config.progressiveRetainedFromPrevious &&
    boundsOverlap >= config.minimumBoundsOverlap &&
    similarLineStructure;
  const fadedSameMessage =
    previousCellCount > currentCellCount &&
    retainedFromCurrent >= config.progressiveRetainedFromPrevious &&
    boundsOverlap >= config.minimumBoundsOverlap &&
    similarLineStructure;
  const containedSameMessage =
    sharedOverMinimumForeground >= config.containmentSharedMinimum &&
    boundsOverlap >= config.minimumBoundsOverlap &&
    similarLineStructure;

  return {
    fingerprintDistance,
    intersectionOverUnion,
    retainedFromPrevious,
    retainedFromCurrent,
    sharedOverMinimumForeground,
    boundsOverlap,
    progressiveRender,
    likelySameMessage:
      fingerprintDistance <= config.sameFingerprintDistance ||
      progressiveRender ||
      fadedSameMessage ||
      containedSameMessage,
  };
}

function createPresenceScore(
  foregroundRatio: number,
  lineBandCount: number,
  textLikeComponentCount: number,
  largestComponentRatio: number,
  config: MessagePresenceConfig,
) {
  const densityTarget = Math.min(
    config.maxForegroundRatio,
    config.minForegroundRatio * PRESENCE_DENSITY_SCORE_TARGET_MULTIPLIER,
  );
  const densityScore = scoreRange(
    foregroundRatio,
    config.minForegroundRatio,
    densityTarget,
  );
  const lineBandScore = clamp01(lineBandCount / PRESENCE_LINE_BAND_SCORE_TARGET);
  const componentCountScore = clamp01(
    textLikeComponentCount / PRESENCE_COMPONENT_SCORE_TARGET,
  );
  const largestComponentScore =
    config.maxLargestComponentRatio <= 0
      ? 0
      : clamp01(1 - largestComponentRatio / config.maxLargestComponentRatio);
  const componentScore = componentCountScore * largestComponentScore;

  return clamp01(
    densityScore * PRESENCE_SCORE_WEIGHTS.density +
      lineBandScore * PRESENCE_SCORE_WEIGHTS.lineBands +
      componentScore * PRESENCE_SCORE_WEIGHTS.components,
  );
}

export function analyzeMessagePresence(
  source: ImageData,
  config: MessagePresenceConfig = DEFAULT_MESSAGE_PRESENCE_CONFIG,
): MessagePresenceAnalysis {
  const mask = createCombinedMessageMask(source, config);
  const preprocessOptions: MessagePreprocessOptions = {
    ...COMBINED_MASK_OPTIONS,
    whiteThreshold: config.whiteThreshold,
  };
  const metrics = analyzeProcessedMessageImageData(mask.imageData, preprocessOptions);
  const componentMetrics = analyzeProcessedForegroundComponents(
    mask.imageData,
    preprocessOptions,
  );
  const lineBands = detectMessageLineBands(
    mask.imageData,
    preprocessOptions,
    config.lineDetectionOptions,
  );
  const totalPixelCount = Math.max(1, metrics.totalPixelCount);
  const whiteForegroundRatio = mask.whiteForegroundPixelCount / totalPixelCount;
  const yellowForegroundRatio = mask.yellowForegroundPixelCount / totalPixelCount;
  const hasUsableDensity =
    metrics.foregroundPixelRatio >= config.minForegroundRatio &&
    metrics.foregroundPixelRatio <= config.maxForegroundRatio;
  const hasTextLikeComponents =
    componentMetrics.componentCount > 0 &&
    componentMetrics.textLikeComponentCount >= config.minTextLikeComponentCount &&
    componentMetrics.largestComponentForegroundRatio <=
      config.maxLargestComponentRatio;
  const hasLineBands = lineBands.length >= config.minLineBandCount;
  const rejectReason: MessagePresenceRejectReason =
    metrics.foregroundPixelRatio < config.minForegroundRatio
      ? "density-low"
      : metrics.foregroundPixelRatio > config.maxForegroundRatio
        ? "density-high"
        : !hasTextLikeComponents
          ? "component"
          : !hasLineBands
            ? "line-band"
            : null;
  const present = hasUsableDensity && hasTextLikeComponents && hasLineBands;
  const fingerprint = present
    ? createMessageMaskFingerprint(mask.imageData, preprocessOptions)
    : null;
  const occupancyGrid = present
    ? createOccupancyGrid(
        mask.imageData,
        config.signatureGridColumns,
        config.signatureGridRows,
        config.signatureCellMinForegroundRatio,
      )
    : [];

  return {
    present,
    presenceScore: createPresenceScore(
      metrics.foregroundPixelRatio,
      lineBands.length,
      componentMetrics.textLikeComponentCount,
      componentMetrics.largestComponentForegroundRatio,
      config,
    ),
    fingerprint,
    visualSignature:
      present && fingerprint
        ? {
            fingerprint,
            occupancyGrid,
            gridColumns: config.signatureGridColumns,
            gridRows: config.signatureGridRows,
            foregroundBounds: mask.foregroundBounds,
            lineBandCount: lineBands.length,
            foregroundCellCount: occupancyGrid.filter((cell) => cell > 0)
              .length,
          }
        : null,
    foregroundRatio: metrics.foregroundPixelRatio,
    whiteForegroundRatio,
    yellowForegroundRatio,
    lineBandCount: lineBands.length,
    componentCount: componentMetrics.componentCount,
    largestComponentRatio: componentMetrics.largestComponentForegroundRatio,
    rejectReason,
  };
}
