export interface HpHudSignal {
  score: number;
  isVisible: boolean;
  greenBarScore: number;
  frameScore: number;
  nameplateScore: number;
  darkBandScore: number;
  greenPixelRatio: number;
  whitePixelRatio: number;
  nameplatePixelRatio: number;
  darkPixelRatio: number;
}

export interface VsSplashSignal {
  score: number;
  isVisible: boolean;
  purpleScore: number;
  edgeScore: number;
  largeComponentScore: number;
  purplePixelRatio: number;
  brightPixelRatio: number;
}

const HP_HUD_VISIBLE_SCORE = 0.56;
const HP_HUD_MIN_GREEN_SCORE = 0.40;
const HP_HUD_MIN_STRUCTURE_SCORE = 0.20;
const VS_SPLASH_VISIBLE_SCORE = 0.58;
const VS_SPLASH_MIN_PURPLE_SCORE = 0.34;
const VS_SPLASH_MIN_COMPONENT_SCORE = 0.34;

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

function isHpGreenPixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return (
    luminance >= 88 &&
    saturation >= 0.52 &&
    green >= 138 &&
    red <= 175 &&
    blue <= 145 &&
    green >= red + 34 &&
    green >= blue + 42
  );
}

function isWhiteFramePixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return luminance >= 182 && saturation <= 0.26 && Math.abs(red - green) <= 42;
}

function isNameplatePixel(red: number, green: number, blue: number) {
  const saturation = getSaturation(red, green, blue);
  const luminance = getLuminance(red, green, blue);
  const isGreen = isHpGreenPixel(red, green, blue);
  const isPinkOrRed = red >= 128 && red >= green + 32 && blue >= 52;
  const isPurpleOrBlue = blue >= 112 && red >= 74 && blue >= green + 28;

  return !isGreen && luminance >= 44 && saturation >= 0.38 && (isPinkOrRed || isPurpleOrBlue);
}

function isDarkHudPixel(red: number, green: number, blue: number) {
  return getLuminance(red, green, blue) <= 72;
}

function isVsPurplePixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return (
    luminance >= 62 &&
    saturation >= 0.42 &&
    red >= 105 &&
    blue >= 120 &&
    red >= green + 22 &&
    blue >= green + 26
  );
}

function isVsBrightPixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return luminance >= 138 && saturation >= 0.30 && red >= 125 && blue >= 135;
}

function createHorizontalBandScore(rowCounts: readonly number[], width: number) {
  const threshold = Math.max(2, Math.ceil(width * 0.16));
  let strongestRows = 0;

  for (const count of rowCounts) {
    if (count >= threshold) {
      strongestRows += 1;
    }
  }

  return scoreRange(strongestRows / Math.max(1, rowCounts.length), 0.06, 0.24);
}

function createLargeAreaScore(rowCounts: readonly number[], columnCounts: readonly number[], area: number) {
  const rowThreshold = Math.max(2, Math.ceil(columnCounts.length * 0.08));
  const columnThreshold = Math.max(2, Math.ceil(rowCounts.length * 0.08));
  const activeRows = rowCounts.filter((count) => count >= rowThreshold).length;
  const activeColumns = columnCounts.filter((count) => count >= columnThreshold).length;
  const rowCoverage = activeRows / Math.max(1, rowCounts.length);
  const columnCoverage = activeColumns / Math.max(1, columnCounts.length);
  const coverageScore = Math.min(rowCoverage, columnCoverage);

  return clamp01(scoreRange(coverageScore, 0.18, 0.58) * 0.72 + scoreRange(area, 0.08, 0.34) * 0.28);
}

export function analyzeHpHudImage(imageData: ImageData): HpHudSignal {
  const { data, width, height } = imageData;
  const totalPixels = Math.max(1, width * height);
  const topLimit = Math.max(1, Math.floor(height * 0.54));
  const lowerStart = Math.min(height - 1, Math.floor(height * 0.32));
  const greenRows = new Array(height).fill(0) as number[];
  let greenPixels = 0;
  let whitePixels = 0;
  let nameplatePixels = 0;
  let darkPixels = 0;
  let lowerPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;

      if (isHpGreenPixel(red, green, blue)) {
        greenPixels += 1;
        greenRows[y] += 1;
      }

      if (isWhiteFramePixel(red, green, blue)) {
        whitePixels += 1;
      }

      if (y < topLimit && isNameplatePixel(red, green, blue)) {
        nameplatePixels += 1;
      }

      if (y >= lowerStart) {
        lowerPixels += 1;

        if (isDarkHudPixel(red, green, blue)) {
          darkPixels += 1;
        }
      }
    }
  }

  const greenPixelRatio = greenPixels / totalPixels;
  const whitePixelRatio = whitePixels / totalPixels;
  const nameplatePixelRatio = nameplatePixels / Math.max(1, width * topLimit);
  const darkPixelRatio = darkPixels / Math.max(1, lowerPixels);
  const greenBandScore = createHorizontalBandScore(greenRows, width);
  const greenRatioScore = scoreRange(greenPixelRatio, 0.012, 0.105);
  const greenBarScore = clamp01(greenBandScore * 0.62 + greenRatioScore * 0.38);
  const frameScore = scoreRange(whitePixelRatio, 0.010, 0.095);
  const nameplateScore = scoreRange(nameplatePixelRatio, 0.040, 0.255);
  const darkBandScore = scoreRange(darkPixelRatio, 0.22, 0.72);
  const score = clamp01(
    greenBarScore * 0.46 + frameScore * 0.20 + nameplateScore * 0.22 + darkBandScore * 0.12,
  );
  const structureScore = Math.max(frameScore, nameplateScore);
  const isVisible =
    score >= HP_HUD_VISIBLE_SCORE &&
    greenBarScore >= HP_HUD_MIN_GREEN_SCORE &&
    structureScore >= HP_HUD_MIN_STRUCTURE_SCORE;

  return {
    score,
    isVisible,
    greenBarScore,
    frameScore,
    nameplateScore,
    darkBandScore,
    greenPixelRatio,
    whitePixelRatio,
    nameplatePixelRatio,
    darkPixelRatio,
  };
}

export function analyzeVsSplashImage(imageData: ImageData): VsSplashSignal {
  const { data, width, height } = imageData;
  const totalPixels = Math.max(1, width * height);
  const rowCounts = new Array(height).fill(0) as number[];
  const columnCounts = new Array(width).fill(0) as number[];
  let purplePixels = 0;
  let brightPixels = 0;
  let contrastEdges = 0;

  for (let y = 0; y < height; y += 1) {
    let previousLuminance: number | null = null;

    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const luminance = getLuminance(red, green, blue);

      if (isVsPurplePixel(red, green, blue)) {
        purplePixels += 1;
        rowCounts[y] += 1;
        columnCounts[x] += 1;
      }

      if (isVsBrightPixel(red, green, blue)) {
        brightPixels += 1;
      }

      if (previousLuminance !== null && Math.abs(luminance - previousLuminance) >= 70) {
        contrastEdges += 1;
      }

      previousLuminance = luminance;
    }
  }

  const purplePixelRatio = purplePixels / totalPixels;
  const brightPixelRatio = brightPixels / totalPixels;
  const purpleScore = scoreRange(purplePixelRatio, 0.050, 0.270);
  const edgeScore = scoreRange(contrastEdges / totalPixels, 0.030, 0.180);
  const largeComponentScore = createLargeAreaScore(rowCounts, columnCounts, purplePixelRatio);
  const brightScore = scoreRange(brightPixelRatio, 0.020, 0.160);
  const score = clamp01(
    purpleScore * 0.42 + largeComponentScore * 0.34 + edgeScore * 0.16 + brightScore * 0.08,
  );
  const isVisible =
    score >= VS_SPLASH_VISIBLE_SCORE &&
    purpleScore >= VS_SPLASH_MIN_PURPLE_SCORE &&
    largeComponentScore >= VS_SPLASH_MIN_COMPONENT_SCORE;

  return {
    score,
    isVisible,
    purpleScore,
    edgeScore,
    largeComponentScore,
    purplePixelRatio,
    brightPixelRatio,
  };
}
