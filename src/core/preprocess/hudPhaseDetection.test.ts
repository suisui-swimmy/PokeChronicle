import { describe, expect, it } from "vitest";
import { analyzeHpHudImage, analyzeVsSplashImage } from "./hudPhaseDetection";

function createImage(width: number, height: number, red = 22, green = 24, blue = 36) {
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

function drawSyntheticHpHud(image: ImageData) {
  fillRect(image, 6, 6, 136, 28, 220, 24, 122);
  fillRect(image, 8, 34, 118, 18, 8, 10, 26);
  fillRect(image, 24, 39, 112, 10, 70, 236, 34);
  fillRect(image, 21, 36, 118, 2, 240, 244, 246);
  fillRect(image, 21, 50, 118, 2, 240, 244, 246);
  fillRect(image, 31, 36, 2, 14, 240, 244, 246);
  fillRect(image, 138, 36, 2, 16, 240, 244, 246);
}

describe("analyzeHpHudImage", () => {
  it("detects a synthetic HP bar HUD", () => {
    const image = createImage(160, 72);

    drawSyntheticHpHud(image);

    const signal = analyzeHpHudImage(image);

    expect(signal.isVisible).toBe(true);
    expect(signal.score).toBeGreaterThan(0.56);
    expect(signal.greenBarScore).toBeGreaterThan(0.4);
    expect(Math.max(signal.frameScore, signal.nameplateScore)).toBeGreaterThan(0.2);
  });

  it("does not treat green floor dots as an HP bar HUD", () => {
    const image = createImage(160, 72);

    for (let y = 12; y < 68; y += 10) {
      for (let x = 8; x < 150; x += 13) {
        fillRect(image, x, y, 5, 3, 40, 226, 35);
      }
    }

    const signal = analyzeHpHudImage(image);

    expect(signal.isVisible).toBe(false);
    expect(signal.nameplateScore).toBeLessThan(0.2);
  });
});

describe("analyzeVsSplashImage", () => {
  it("detects a synthetic VS splash with a large purple mark", () => {
    const image = createImage(160, 100, 32, 22, 58);

    fillRect(image, 20, 18, 34, 64, 190, 42, 240);
    fillRect(image, 54, 62, 24, 20, 190, 42, 240);
    fillRect(image, 92, 18, 42, 14, 194, 44, 244);
    fillRect(image, 84, 42, 44, 14, 194, 44, 244);
    fillRect(image, 78, 68, 50, 14, 194, 44, 244);
    fillRect(image, 18, 16, 118, 4, 244, 126, 255);
    fillRect(image, 18, 82, 118, 4, 244, 126, 255);

    const signal = analyzeVsSplashImage(image);

    expect(signal.isVisible).toBe(true);
    expect(signal.score).toBeGreaterThan(0.58);
    expect(signal.largeComponentScore).toBeGreaterThan(0.34);
  });

  it("does not treat a flat purple background as VS", () => {
    const image = createImage(160, 100, 90, 35, 130);

    const signal = analyzeVsSplashImage(image);

    expect(signal.isVisible).toBe(false);
    expect(signal.largeComponentScore).toBeLessThan(0.34);
  });

  it("does not treat thin purple UI text as VS", () => {
    const image = createImage(160, 100, 24, 24, 34);

    for (let y = 24; y < 76; y += 14) {
      fillRect(image, 62, y, 36, 3, 190, 42, 240);
    }

    const signal = analyzeVsSplashImage(image);

    expect(signal.isVisible).toBe(false);
    expect(signal.largeComponentScore).toBeLessThan(0.34);
  });
});
