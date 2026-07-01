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
