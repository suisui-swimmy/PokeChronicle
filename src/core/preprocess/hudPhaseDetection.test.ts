import { describe, expect, it } from "vitest";
import {
  analyzeBattleHudImage,
  analyzeVsSplashImage,
  type BattleHudSide,
} from "./hudPhaseDetection";

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

function drawSyntheticBattleHud(
  image: ImageData,
  side: BattleHudSide,
  hpColor: readonly [number, number, number] | null,
) {
  const plateColor = side === "opponent"
    ? ([220, 24, 122] as const)
    : ([96, 50, 210] as const);
  const [plateRed, plateGreen, plateBlue] = plateColor;

  fillRect(image, 6, 6, 136, 28, plateRed, plateGreen, plateBlue);
  fillRect(image, 8, 34, 132, 20, 8, 10, 26);
  fillRect(image, 5, 4, 140, 2, 240, 244, 246);
  fillRect(image, 5, 32, 140, 2, 240, 244, 246);
  fillRect(image, 5, 4, 2, 30, 240, 244, 246);
  fillRect(image, 143, 4, 2, 30, 240, 244, 246);
  fillRect(image, 21, 36, 118, 2, 240, 244, 246);
  fillRect(image, 21, 52, 118, 2, 240, 244, 246);

  if (hpColor) {
    const [red, green, blue] = hpColor;
    fillRect(image, 24, 40, 112, 9, red, green, blue);
  }
}

describe("analyzeBattleHudImage", () => {
  const hpColors = [
    [70, 236, 34],
    [236, 220, 34],
    [238, 132, 24],
    [224, 42, 36],
    null,
  ] as const;

  for (const side of ["opponent", "player"] as const) {
    for (const hpColor of hpColors) {
      const label = hpColor ? hpColor.join("-") : "empty";

      it(`detects ${side} HUD with ${label} HP`, () => {
        const image = createImage(160, 72);

        drawSyntheticBattleHud(image, side, hpColor);

        const signal = analyzeBattleHudImage(image, side);

        expect(signal.isVisible).toBe(true);
        expect(signal.score).toBeGreaterThan(0.52);
        expect(signal.plateScore).toBeGreaterThan(0.38);
        expect(signal.frameScore).toBeGreaterThan(0.12);
      });
    }
  }

  it("does not treat green floor dots as a battle HUD", () => {
    const image = createImage(160, 72);

    for (let y = 12; y < 68; y += 10) {
      for (let x = 8; x < 150; x += 13) {
        fillRect(image, x, y, 5, 3, 40, 226, 35);
      }
    }

    const signal = analyzeBattleHudImage(image, "opponent");

    expect(signal.isVisible).toBe(false);
    expect(signal.plateScore).toBeLessThan(0.38);
  });

  it("does not treat a flat side color or the opposite side plate as a HUD", () => {
    const flat = createImage(160, 72, 220, 24, 122);
    const opponentHud = createImage(160, 72);

    drawSyntheticBattleHud(opponentHud, "opponent", [70, 236, 34]);

    expect(analyzeBattleHudImage(flat, "opponent").isVisible).toBe(false);
    expect(analyzeBattleHudImage(opponentHud, "player").isVisible).toBe(false);
  });

  it("does not treat red and blue effect fragments as a HUD", () => {
    const image = createImage(160, 72);

    for (let y = 8; y < 68; y += 12) {
      fillRect(image, 8 + y, y, 14, 5, 226, 38, 42);
      fillRect(image, 132 - y, y + 3, 12, 4, 50, 70, 226);
    }

    expect(analyzeBattleHudImage(image, "opponent").isVisible).toBe(false);
    expect(analyzeBattleHudImage(image, "player").isVisible).toBe(false);
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
