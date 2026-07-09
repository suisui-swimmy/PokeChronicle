export interface WaitIndicatorSignal {
  score: number;
  isVisible: boolean;
  yellowIconScore: number;
  whiteTextScore: number;
  contrastScore: number;
  yellowPixelRatio: number;
  whitePixelRatio: number;
  whiteRowBandScore: number;
}

const WAIT_VISIBLE_SCORE = 0.58;
const WAIT_MIN_WHITE_TEXT_SCORE = 0.22;
const WAIT_MIN_ICON_OR_TEXT_SCORE = 0.35;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function scoreRange(value: number, min: number, max: number) {
  if (max <= min) {
    return value >= max ? 1 : 0;
  }

  return clamp01((value - min) / (max - min));
}

function getLuminance(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function getSaturation(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  if (max === 0) {
    return 0;
  }

  return (max - min) / max;
}

function isWaitYellowPixel(red: number, green: number, blue: number) {
  const saturation = getSaturation(red, green, blue);
  const luminance = getLuminance(red, green, blue);

  return (
    luminance >= 95 &&
    saturation >= 0.45 &&
    red >= 140 &&
    green >= 95 &&
    blue <= 130 &&
    red >= blue + 45 &&
    green >= blue + 20
  );
}

function isWaitWhiteTextPixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return luminance >= 165 && saturation <= 0.28 && Math.abs(red - green) <= 34;
}

function createRowBandScore(rowCounts: readonly number[], width: number) {
  const rowThreshold = Math.max(2, Math.ceil(width * 0.035));
  let longestRun = 0;
  let currentRun = 0;

  for (const count of rowCounts) {
    if (count >= rowThreshold) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return scoreRange(longestRun / Math.max(1, rowCounts.length), 0.08, 0.34);
}

export function analyzeWaitIndicatorImage(imageData: ImageData): WaitIndicatorSignal {
  const { data, width, height } = imageData;
  const topLimit = Math.max(1, Math.floor(height * 0.48));
  const bottomStart = Math.min(height - 1, Math.floor(height * 0.28));
  const textRowCounts = new Array(Math.max(1, height - bottomStart)).fill(0) as number[];
  let yellowPixels = 0;
  let yellowAreaPixels = 0;
  let whitePixels = 0;
  let whiteAreaPixels = 0;
  let luminanceSum = 0;
  let luminanceSqSum = 0;
  let totalPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const luminance = getLuminance(red, green, blue);

      luminanceSum += luminance;
      luminanceSqSum += luminance * luminance;
      totalPixels += 1;

      if (y < topLimit) {
        yellowAreaPixels += 1;

        if (isWaitYellowPixel(red, green, blue)) {
          yellowPixels += 1;
        }
      }

      if (y >= bottomStart) {
        whiteAreaPixels += 1;

        if (isWaitWhiteTextPixel(red, green, blue)) {
          whitePixels += 1;
          textRowCounts[y - bottomStart] += 1;
        }
      }
    }
  }

  const yellowPixelRatio = yellowAreaPixels === 0 ? 0 : yellowPixels / yellowAreaPixels;
  const whitePixelRatio = whiteAreaPixels === 0 ? 0 : whitePixels / whiteAreaPixels;
  const whiteRowBandScore = createRowBandScore(textRowCounts, width);
  const yellowIconScore = scoreRange(yellowPixelRatio, 0.008, 0.055);
  const whiteRatioScore = scoreRange(whitePixelRatio, 0.012, 0.072);
  const whiteTextScore = clamp01(whiteRatioScore * 0.58 + whiteRowBandScore * 0.42);
  const mean = totalPixels === 0 ? 0 : luminanceSum / totalPixels;
  const variance = totalPixels === 0 ? 0 : luminanceSqSum / totalPixels - mean * mean;
  const contrastScore = scoreRange(Math.sqrt(Math.max(0, variance)) / 255, 0.10, 0.28);
  const score = clamp01(yellowIconScore * 0.35 + whiteTextScore * 0.45 + contrastScore * 0.2);
  const iconOrTextScore = Math.max(yellowIconScore, whiteTextScore);
  const isVisible =
    score >= WAIT_VISIBLE_SCORE &&
    whiteTextScore >= WAIT_MIN_WHITE_TEXT_SCORE &&
    iconOrTextScore >= WAIT_MIN_ICON_OR_TEXT_SCORE;

  return {
    score,
    isVisible,
    yellowIconScore,
    whiteTextScore,
    contrastScore,
    yellowPixelRatio,
    whitePixelRatio,
    whiteRowBandScore,
  };
}
