import { describe, expect, it } from "vitest";
import {
  analyzeProcessedMessageImageData,
  areMessageMaskFingerprintsSimilar,
  choosePreferredMessagePreprocessVariant,
  createMessageMaskFingerprint,
  createMessageLineCropVariants,
  createMessagePreprocessVariants,
  detectMessageLineBands,
  getMessageMaskFingerprintDistance,
  isBrightYellowTextPixel,
  preprocessMessageImageData,
  preprocessMessageImageDataWithMetrics,
  type MessagePreprocessOptions,
} from "./messagePreprocess";

function pixelAt(image: ImageData, pixelIndex: number) {
  const index = pixelIndex * 4;

  return Array.from(image.data.slice(index, index + 4));
}

function createSolidProcessedImage(
  width: number,
  height: number,
  value: number,
) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  return new ImageData(data, width, height);
}

function createSolidSourceImage(
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    data[index + 3] = 255;
  }

  return new ImageData(data, width, height);
}

function setSourcePixel(
  image: ImageData,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
) {
  const index = (y * image.width + x) * 4;

  image.data[index] = red;
  image.data[index + 1] = green;
  image.data[index + 2] = blue;
  image.data[index + 3] = 255;
}

function setProcessedPixel(image: ImageData, x: number, y: number, value: number) {
  const index = (y * image.width + x) * 4;

  image.data[index] = value;
  image.data[index + 1] = value;
  image.data[index + 2] = value;
  image.data[index + 3] = 255;
}

function drawProcessedTextRow(
  image: ImageData,
  y: number,
  foregroundValue: number,
  xStart = 2,
  xEnd = image.width - 2,
) {
  for (let x = xStart; x < xEnd; x += 2) {
    setProcessedPixel(image, x, y, foregroundValue);
    setProcessedPixel(image, x + 1, y, foregroundValue);
  }
}

function drawYellowTextRow(image: ImageData, y: number, xStart = 4, xEnd = 46) {
  for (let x = xStart; x < xEnd; x += 3) {
    setSourcePixel(image, x, y, 244, 236, 42);
    setSourcePixel(image, x + 1, y, 244, 236, 42);
  }
}

describe("preprocessMessageImageData", () => {
  const defaultOptions: MessagePreprocessOptions = {
    whiteThreshold: 180,
    background: "black",
    invert: false,
  };

  it("extracts bright low-chroma pixels onto a solid background", () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        245, 246, 244, 255,
        32, 36, 42, 255,
      ]),
      2,
      1,
    );

    const result = preprocessMessageImageData(source, defaultOptions);

    expect(pixelAt(result, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(result, 1)).toEqual([0, 0, 0, 255]);
  });

  it("can invert the output colors for OCR preview checks", () => {
    const source = new ImageData(new Uint8ClampedArray([235, 235, 236, 255]), 1, 1);

    const result = preprocessMessageImageData(source, {
      whiteThreshold: 180,
      background: "black",
      invert: true,
    });

    expect(pixelAt(result, 0)).toEqual([0, 0, 0, 255]);
  });

  it("reports a low foreground ratio for an all-background crop", () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        24, 24, 24, 255,
        48, 48, 48, 255,
        66, 60, 58, 255,
        0, 0, 0, 255,
      ]),
      2,
      2,
    );

    const { metrics } = preprocessMessageImageDataWithMetrics(source, defaultOptions);

    expect(metrics).toEqual({
      foregroundPixelCount: 0,
      totalPixelCount: 4,
      foregroundPixelRatio: 0,
    });
  });

  it("counts synthetic white text-like pixels as foreground", () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        245, 245, 245, 255,
        16, 16, 16, 255,
        240, 242, 241, 255,
        64, 64, 64, 255,
      ]),
      2,
      2,
    );

    const { metrics } = preprocessMessageImageDataWithMetrics(source, defaultOptions);

    expect(metrics.foregroundPixelCount).toBe(2);
    expect(metrics.foregroundPixelRatio).toBe(0.5);
  });

  it("keeps foreground detection stable across background and invert settings", () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        240, 240, 240, 255,
        24, 24, 24, 255,
      ]),
      2,
      1,
    );
    const variants: MessagePreprocessOptions[] = [
      { whiteThreshold: 180, background: "black", invert: false },
      { whiteThreshold: 180, background: "black", invert: true },
      { whiteThreshold: 180, background: "white", invert: false },
      { whiteThreshold: 180, background: "white", invert: true },
    ];

    for (const options of variants) {
      const { imageData, metrics } = preprocessMessageImageDataWithMetrics(source, options);
      const analyzed = analyzeProcessedMessageImageData(imageData, options);

      expect(metrics.foregroundPixelCount).toBe(1);
      expect(metrics.foregroundPixelRatio).toBe(0.5);
      expect(analyzed).toEqual(metrics);
    }
  });

  it("extracts high-luminance yellow text pixels when the yellow mask is enabled", () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        244, 236, 42, 255,
        245, 245, 245, 255,
        24, 28, 36, 255,
      ]),
      3,
      1,
    );

    const whiteOnly = preprocessMessageImageData(source, defaultOptions);
    const yellowOnly = preprocessMessageImageData(source, {
      ...defaultOptions,
      textMask: "yellow",
    });
    const whiteAndYellow = preprocessMessageImageData(source, {
      ...defaultOptions,
      textMask: "white-yellow",
    });

    expect(pixelAt(whiteOnly, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(yellowOnly, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(yellowOnly, 1)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(whiteAndYellow, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(whiteAndYellow, 1)).toEqual([255, 255, 255, 255]);
  });

  it("keeps dark yellow and blue effect colors out of the yellow text mask", () => {
    expect(isBrightYellowTextPixel(122, 112, 18, 255)).toBe(false);
    expect(isBrightYellowTextPixel(42, 88, 238, 255)).toBe(false);
    expect(isBrightYellowTextPixel(244, 236, 42, 255)).toBe(true);

    const source = new ImageData(
      new Uint8ClampedArray([
        122, 112, 18, 255,
        42, 88, 238, 255,
      ]),
      2,
      1,
    );
    const { metrics } = preprocessMessageImageDataWithMetrics(source, {
      ...defaultOptions,
      textMask: "yellow",
    });

    expect(metrics.foregroundPixelCount).toBe(0);
  });

  it("prefers a yellow-capable OCR variant when white extraction would produce an empty crop", () => {
    const source = createSolidSourceImage(64, 20, 14, 18, 30);

    drawYellowTextRow(source, 5);
    drawYellowTextRow(source, 6);
    drawYellowTextRow(source, 13);
    drawYellowTextRow(source, 14);

    const variants = createMessagePreprocessVariants(source, defaultOptions, {
      minForegroundPixelRatio: 0.004,
      maxForegroundPixelRatio: 0.18,
    });
    const white = variants.find((variant) => variant.id === "white");
    const yellow = variants.find((variant) => variant.id === "yellow");
    const selected = choosePreferredMessagePreprocessVariant(variants);

    expect(white?.metrics.foregroundPixelRatio).toBe(0);
    expect(yellow).toMatchObject({ isOcrCandidate: true, rejectReason: null });
    expect(yellow?.metrics.foregroundPixelRatio).toBeGreaterThan(0);
    expect(yellow?.lineCropVariants[0]?.lineCount).toBe(2);
    expect(selected?.id).not.toBe("white");
    expect(selected?.id).toMatch(/yellow/);
  });

  it("rejects solid yellow blocks as OCR candidates even when the yellow mask is non-empty", () => {
    const source = createSolidSourceImage(64, 20, 14, 18, 30);

    for (let y = 6; y < 9; y += 1) {
      for (let x = 8; x < 28; x += 1) {
        setSourcePixel(source, x, y, 244, 236, 42);
      }
    }

    const yellow = createMessagePreprocessVariants(source, defaultOptions, {
      minForegroundPixelRatio: 0.004,
      maxForegroundPixelRatio: 0.18,
    }).find((variant) => variant.id === "yellow");

    expect(yellow?.metrics.foregroundPixelCount).toBeGreaterThan(0);
    expect(yellow?.isOcrCandidate).toBe(false);
    expect(yellow?.rejectReason).toBe("component");
  });
});

describe("message mask fingerprint", () => {
  const options: MessagePreprocessOptions = {
    whiteThreshold: 180,
    background: "black",
    invert: false,
  };

  it("treats the same message mask as the same fingerprint", () => {
    const first = createSolidProcessedImage(64, 32, 0);
    const second = createSolidProcessedImage(64, 32, 0);

    for (const image of [first, second]) {
      drawProcessedTextRow(image, 8, 255, 4, 30);
      drawProcessedTextRow(image, 22, 255, 8, 44);
    }

    const firstFingerprint = createMessageMaskFingerprint(first, options);
    const secondFingerprint = createMessageMaskFingerprint(second, options);

    expect(getMessageMaskFingerprintDistance(firstFingerprint, secondFingerprint)).toBe(0);
    expect(areMessageMaskFingerprintsSimilar(firstFingerprint, secondFingerprint)).toBe(true);
  });

  it("separates masks whose text occupies different regions", () => {
    const leftMessage = createSolidProcessedImage(64, 32, 0);
    const rightMessage = createSolidProcessedImage(64, 32, 0);
    drawProcessedTextRow(leftMessage, 8, 255, 2, 24);
    drawProcessedTextRow(leftMessage, 22, 255, 4, 28);
    drawProcessedTextRow(rightMessage, 8, 255, 38, 62);
    drawProcessedTextRow(rightMessage, 22, 255, 34, 60);

    const leftFingerprint = createMessageMaskFingerprint(leftMessage, options);
    const rightFingerprint = createMessageMaskFingerprint(rightMessage, options);

    expect(getMessageMaskFingerprintDistance(leftFingerprint, rightFingerprint)).toBeGreaterThan(
      0.16,
    );
    expect(areMessageMaskFingerprintsSimilar(leftFingerprint, rightFingerprint)).toBe(false);
  });
});

describe("message line band detection", () => {
  const defaultOptions: MessagePreprocessOptions = {
    whiteThreshold: 180,
    background: "black",
    invert: false,
  };

  it("does not detect line bands from an all-background processed image", () => {
    const processed = createSolidProcessedImage(24, 14, 0);

    expect(detectMessageLineBands(processed, defaultOptions)).toEqual([]);
  });

  it("detects text-like horizontal bands and creates top line crop variants", () => {
    const processed = createSolidProcessedImage(24, 18, 0);

    drawProcessedTextRow(processed, 3, 255);
    drawProcessedTextRow(processed, 4, 255);
    drawProcessedTextRow(processed, 10, 255);
    drawProcessedTextRow(processed, 11, 255);

    const bands = detectMessageLineBands(processed, defaultOptions);
    const variants = createMessageLineCropVariants(processed, defaultOptions);

    expect(bands).toHaveLength(2);
    expect(variants.map((variant) => variant.id)).toEqual([
      "full",
      "top-1-lines",
      "top-2-lines",
      "line-1",
      "line-2",
    ]);
    expect(variants[1]).toMatchObject({ y: 1, lineCount: 1 });
    expect(variants[2].height).toBeLessThan(processed.height);
    expect(variants[2].metrics.foregroundPixelRatio).toBeGreaterThan(0);
  });

  it("merges a small ruby band into the following main line and creates suppressed fallbacks", () => {
    const processed = createSolidProcessedImage(48, 32, 0);

    drawProcessedTextRow(processed, 2, 255, 16, 26);
    drawProcessedTextRow(processed, 3, 255, 16, 26);
    for (let y = 8; y <= 13; y += 1) {
      drawProcessedTextRow(processed, y, 255, 3, 31);
    }
    for (let y = 21; y <= 26; y += 1) {
      drawProcessedTextRow(processed, y, 255, 3, 31);
    }

    const bands = detectMessageLineBands(processed, defaultOptions);
    const variants = createMessageLineCropVariants(processed, defaultOptions);
    const primaryLine = variants.find((variant) => variant.id === "line-1");
    const suppressedLine = variants.find(
      (variant) => variant.id === "annotation-suppressed-line-1",
    );

    expect(bands).toHaveLength(2);
    expect(primaryLine?.metrics.foregroundPixelCount).toBeGreaterThan(
      suppressedLine?.metrics.foregroundPixelCount ?? Number.POSITIVE_INFINITY,
    );
    expect(variants.map((variant) => variant.id)).toContain(
      "annotation-suppressed-top-2-lines",
    );
    expect(suppressedLine?.metrics.foregroundPixelCount).toBeGreaterThan(80);
  });

  it("keeps nearby dakuten-like pixels in the main line instead of suppressing them", () => {
    const processed = createSolidProcessedImage(48, 24, 0);

    setProcessedPixel(processed, 12, 5, 255);
    setProcessedPixel(processed, 14, 5, 255);
    setProcessedPixel(processed, 12, 6, 255);
    setProcessedPixel(processed, 14, 6, 255);
    for (let y = 8; y <= 14; y += 1) {
      drawProcessedTextRow(processed, y, 255, 3, 31);
    }

    const variants = createMessageLineCropVariants(processed, defaultOptions);

    expect(variants.map((variant) => variant.id)).not.toContain(
      "annotation-suppressed-line-1",
    );
    expect(variants.find((variant) => variant.id === "line-1")?.metrics.foregroundPixelCount)
      .toBeGreaterThan(120);
  });

  it("filters tiny isolated foreground noise out of line bands", () => {
    const processed = createSolidProcessedImage(24, 12, 0);

    setProcessedPixel(processed, 4, 8, 255);

    expect(detectMessageLineBands(processed, defaultOptions)).toEqual([]);
  });

  it("keeps foreground line detection stable for white and invert output settings", () => {
    const variants: Array<{ options: MessagePreprocessOptions; background: number; foreground: number }> = [
      {
        options: { whiteThreshold: 180, background: "black", invert: false },
        background: 0,
        foreground: 255,
      },
      {
        options: { whiteThreshold: 180, background: "black", invert: true },
        background: 255,
        foreground: 0,
      },
      {
        options: { whiteThreshold: 180, background: "white", invert: false },
        background: 255,
        foreground: 0,
      },
      {
        options: { whiteThreshold: 180, background: "white", invert: true },
        background: 0,
        foreground: 255,
      },
    ];

    for (const variant of variants) {
      const processed = createSolidProcessedImage(24, 10, variant.background);

      drawProcessedTextRow(processed, 4, variant.foreground);
      drawProcessedTextRow(processed, 5, variant.foreground);

      expect(detectMessageLineBands(processed, variant.options)).toHaveLength(1);
      expect(createMessageLineCropVariants(processed, variant.options)).toHaveLength(3);
    }
  });
});
