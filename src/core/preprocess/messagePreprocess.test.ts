import { describe, expect, it } from "vitest";
import {
  analyzeProcessedMessageImageData,
  preprocessMessageImageData,
  preprocessMessageImageDataWithMetrics,
  type MessagePreprocessOptions,
} from "./messagePreprocess";

function pixelAt(image: ImageData, pixelIndex: number) {
  const index = pixelIndex * 4;

  return Array.from(image.data.slice(index, index + 4));
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
