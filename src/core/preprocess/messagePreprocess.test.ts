import { describe, expect, it } from "vitest";
import {
  analyzeProcessedMessageImageData,
  createMessageLineCropVariants,
  detectMessageLineBands,
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
    ]);
    expect(variants[1]).toMatchObject({ y: 1, lineCount: 1 });
    expect(variants[2].height).toBeLessThan(processed.height);
    expect(variants[2].metrics.foregroundPixelRatio).toBeGreaterThan(0);
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
      expect(createMessageLineCropVariants(processed, variant.options)).toHaveLength(2);
    }
  });
});
