import {
  analyzeProcessedForegroundComponents,
  analyzeProcessedMessageImageData,
  createMessageMaskFingerprint,
  detectMessageLineBands,
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
  lineDetectionOptions: MessageLineBandDetectionOptions;
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
  lineDetectionOptions: DEFAULT_MESSAGE_PRESENCE_LINE_DETECTION_OPTIONS,
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

    output.data[index] = value;
    output.data[index + 1] = value;
    output.data[index + 2] = value;
    output.data[index + 3] = 255;
  }

  return {
    imageData: output,
    whiteForegroundPixelCount,
    yellowForegroundPixelCount,
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

  return {
    present,
    presenceScore: createPresenceScore(
      metrics.foregroundPixelRatio,
      lineBands.length,
      componentMetrics.textLikeComponentCount,
      componentMetrics.largestComponentForegroundRatio,
      config,
    ),
    fingerprint: present
      ? createMessageMaskFingerprint(mask.imageData, preprocessOptions)
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
