import { describe, expect, it } from "vitest";
import { analyzeWaitIndicatorImage } from "./waitIndicatorDetection";

function createImage(width: number, height: number, red = 24, green = 32, blue = 50) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    data[index + 3] = 255;
  }

  return new ImageData(data, width, height);
}

function setPixel(image: ImageData, x: number, y: number, red: number, green: number, blue: number) {
  const index = (y * image.width + x) * 4;

  image.data[index] = red;
  image.data[index + 1] = green;
  image.data[index + 2] = blue;
  image.data[index + 3] = 255;
}

function fillRect(
  image: ImageData,
  xStart: number,
  yStart: number,
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
) {
  for (let y = yStart; y < yStart + height; y += 1) {
    for (let x = xStart; x < xStart + width; x += 1) {
      setPixel(image, x, y, red, green, blue);
    }
  }
}

function drawSyntheticWaitText(image: ImageData) {
  for (let line = 0; line < 4; line += 1) {
    const y = 58 + line * 5;

    for (let x = 18; x < 95; x += 8) {
      fillRect(image, x, y, 5, 2, 230, 232, 235);
    }
  }

  for (let y = 76; y < 88; y += 3) {
    for (let x = 20; x < 92; x += 10) {
      fillRect(image, x, y, 6, 2, 228, 230, 236);
    }
  }
}

describe("analyzeWaitIndicatorImage", () => {
  it("detects a synthetic wait indicator with a yellow icon and white text rows", () => {
    const image = createImage(120, 96);

    fillRect(image, 46, 8, 26, 20, 232, 190, 24);
    fillRect(image, 52, 16, 14, 18, 245, 220, 38);
    drawSyntheticWaitText(image);

    const signal = analyzeWaitIndicatorImage(image);

    expect(signal.isVisible).toBe(true);
    expect(signal.score).toBeGreaterThan(0.58);
    expect(signal.yellowIconScore).toBeGreaterThan(0.5);
    expect(signal.whiteTextScore).toBeGreaterThan(0.35);
  });

  it("does not treat an empty dark crop as a wait indicator", () => {
    const image = createImage(120, 96);
    const signal = analyzeWaitIndicatorImage(image);

    expect(signal.isVisible).toBe(false);
    expect(signal.score).toBeLessThan(0.2);
  });

  it("keeps yellow-only effects below the visible threshold", () => {
    const image = createImage(120, 96);

    fillRect(image, 44, 6, 32, 28, 245, 210, 34);

    const signal = analyzeWaitIndicatorImage(image);

    expect(signal.isVisible).toBe(false);
    expect(signal.yellowIconScore).toBeGreaterThan(0.5);
    expect(signal.whiteTextScore).toBeLessThan(0.15);
  });
});
