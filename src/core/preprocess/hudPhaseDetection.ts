export type BattleHudSide = "opponent" | "player";

export interface BattleHudSignal {
  score: number;
  isVisible: boolean;
  plateScore: number;
  frameScore: number;
  darkBandScore: number;
  hpBandScore: number;
  platePixelRatio: number;
  whitePixelRatio: number;
  darkPixelRatio: number;
  hpBandPixelRatio: number;
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

const BATTLE_HUD_VISIBLE_SCORE = 0.52;
const BATTLE_HUD_MIN_PLATE_SCORE = 0.38;
const BATTLE_HUD_MIN_FRAME_SCORE = 0.12;
const BATTLE_HUD_MIN_DARK_SCORE = 0.12;
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

function isOpponentPlatePixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return (
    luminance >= 48 &&
    saturation >= 0.42 &&
    red >= 128 &&
    red >= green + 42 &&
    blue >= 42
  );
}

function isPlayerPlatePixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return (
    luminance >= 38 &&
    saturation >= 0.38 &&
    blue >= 102 &&
    blue >= green + 30 &&
    blue >= red + 28 &&
    red >= 42
  );
}

function isPlatePixel(side: BattleHudSide, red: number, green: number, blue: number) {
  return side === "opponent"
    ? isOpponentPlatePixel(red, green, blue)
    : isPlayerPlatePixel(red, green, blue);
}

function isWhiteFramePixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);

  return luminance >= 180 && saturation <= 0.3 && Math.abs(red - green) <= 46;
}

function isDarkHudPixel(red: number, green: number, blue: number) {
  return getLuminance(red, green, blue) <= 76;
}

function isHpBandPixel(red: number, green: number, blue: number) {
  const luminance = getLuminance(red, green, blue);
  const saturation = getSaturation(red, green, blue);
  const vividGreen = green >= 128 && green >= red + 12 && green >= blue + 28;
  const vividYellowOrOrange = red >= 145 && green >= 78 && red >= blue + 54;
  const vividRed = red >= 150 && red >= green + 48 && red >= blue + 48;

  return luminance >= 70 && saturation >= 0.46 && (vividGreen || vividYellowOrOrange || vividRed);
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

  return luminance >= 138 && saturation >= 0.3 && red >= 125 && blue >= 135;
}

function createHorizontalBandScore(
  rowCounts: readonly number[],
  width: number,
  minRowCoverage = 0.16,
) {
  const threshold = Math.max(2, Math.ceil(width * minRowCoverage));
  let strongestRows = 0;

  for (const count of rowCounts) {
    if (count >= threshold) {
      strongestRows += 1;
    }
  }

  return scoreRange(strongestRows / Math.max(1, rowCounts.length), 0.06, 0.24);
}

function createLargeAreaScore(
  rowCounts: readonly number[],
  columnCounts: readonly number[],
  area: number,
) {
  const rowThreshold = Math.max(2, Math.ceil(columnCounts.length * 0.08));
  const columnThreshold = Math.max(2, Math.ceil(rowCounts.length * 0.08));
  const activeRows = rowCounts.filter((count) => count >= rowThreshold).length;
  const activeColumns = columnCounts.filter((count) => count >= columnThreshold).length;
  const rowCoverage = activeRows / Math.max(1, rowCounts.length);
  const columnCoverage = activeColumns / Math.max(1, columnCounts.length);
  const coverageScore = Math.min(rowCoverage, columnCoverage);

  return clamp01(scoreRange(coverageScore, 0.18, 0.58) * 0.72 + scoreRange(area, 0.08, 0.34) * 0.28);
}

export function analyzeBattleHudImage(
  imageData: ImageData,
  side: BattleHudSide,
): BattleHudSignal {
  const { data, width, height } = imageData;
  const totalPixels = Math.max(1, width * height);
  const plateLimit = Math.max(1, Math.floor(height * 0.62));
  const lowerStart = Math.min(height - 1, Math.floor(height * 0.32));
  const hpStart = Math.min(height - 1, Math.floor(height * 0.46));
  const plateRows = new Array(plateLimit).fill(0) as number[];
  const hpRows = new Array(Math.max(1, height - hpStart)).fill(0) as number[];
  let platePixels = 0;
  let whitePixels = 0;
  let darkPixels = 0;
  let lowerPixels = 0;
  let hpBandPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;

      if (y < plateLimit && isPlatePixel(side, red, green, blue)) {
        platePixels += 1;
        plateRows[y] += 1;
      }

      if (isWhiteFramePixel(red, green, blue)) {
        whitePixels += 1;
      }

      if (y >= lowerStart) {
        lowerPixels += 1;

        if (isDarkHudPixel(red, green, blue)) {
          darkPixels += 1;
        }
      }

      if (y >= hpStart && isHpBandPixel(red, green, blue)) {
        hpBandPixels += 1;
        hpRows[y - hpStart] += 1;
      }
    }
  }

  const platePixelRatio = platePixels / Math.max(1, width * plateLimit);
  const whitePixelRatio = whitePixels / totalPixels;
  const darkPixelRatio = darkPixels / Math.max(1, lowerPixels);
  const hpBandPixelRatio = hpBandPixels / Math.max(1, width * (height - hpStart));
  const plateBandScore = createHorizontalBandScore(plateRows, width, 0.2);
  const plateRatioScore = scoreRange(platePixelRatio, 0.035, 0.28);
  const plateScore = clamp01(plateBandScore * 0.68 + plateRatioScore * 0.32);
  const frameScore = scoreRange(whitePixelRatio, 0.008, 0.075);
  const darkBandScore = scoreRange(darkPixelRatio, 0.16, 0.68);
  const hpBandScore = clamp01(
    createHorizontalBandScore(hpRows, width, 0.13) * 0.7 +
      scoreRange(hpBandPixelRatio, 0.008, 0.12) * 0.3,
  );
  const score = clamp01(
    plateScore * 0.5 + frameScore * 0.24 + darkBandScore * 0.2 + hpBandScore * 0.06,
  );
  const isVisible =
    score >= BATTLE_HUD_VISIBLE_SCORE &&
    plateScore >= BATTLE_HUD_MIN_PLATE_SCORE &&
    frameScore >= BATTLE_HUD_MIN_FRAME_SCORE &&
    darkBandScore >= BATTLE_HUD_MIN_DARK_SCORE;

  return {
    score,
    isVisible,
    plateScore,
    frameScore,
    darkBandScore,
    hpBandScore,
    platePixelRatio,
    whitePixelRatio,
    darkPixelRatio,
    hpBandPixelRatio,
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
  const purpleScore = scoreRange(purplePixelRatio, 0.05, 0.27);
  const edgeScore = scoreRange(contrastEdges / totalPixels, 0.03, 0.18);
  const largeComponentScore = createLargeAreaScore(rowCounts, columnCounts, purplePixelRatio);
  const brightScore = scoreRange(brightPixelRatio, 0.02, 0.16);
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
