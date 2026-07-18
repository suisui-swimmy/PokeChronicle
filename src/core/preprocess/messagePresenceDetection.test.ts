import { describe, expect, it } from "vitest";
import {
  isBrightWhiteTextPixel,
  isBrightYellowTextPixel,
  preprocessMessageImageData,
} from "./messagePreprocess";
import {
  analyzeMessagePresence,
  compareMessageVisualSignatures,
  DEFAULT_MESSAGE_PRESENCE_CONFIG,
} from "./messagePresenceDetection";

function createImage(
  width: number,
  height: number,
  red = 14,
  green = 18,
  blue = 30,
) {
  const image = new ImageData(width, height);

  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }

  return image;
}

function setPixel(
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

function drawTextLikeLine(
  image: ImageData,
  y: number,
  color: readonly [number, number, number],
) {
  drawTextLikeLineRange(image, y, 4, image.width - 12, color);
}

function drawTextLikeLineRange(
  image: ImageData,
  y: number,
  xStart: number,
  xEnd: number,
  color: readonly [number, number, number],
) {
  const [red, green, blue] = color;

  for (let x = xStart; x < xEnd; x += 6) {
    fillRect(image, x, y, 2, 2, red, green, blue);
  }
}

function readPixel(image: ImageData, pixelIndex: number) {
  const start = pixelIndex * 4;

  return Array.from(image.data.slice(start, start + 4));
}

describe("analyzeMessagePresence", () => {
  it("keeps an empty dark ROI absent", () => {
    const analysis = analyzeMessagePresence(createImage(96, 40));

    expect(analysis.present).toBe(false);
    expect(analysis.fingerprint).toBeNull();
    expect(analysis.foregroundRatio).toBe(0);
    expect(analysis.lineBandCount).toBe(0);
    expect(analysis.rejectReason).toBe("density-low");
  });

  it("detects two lines of white text-like foreground", () => {
    const image = createImage(96, 40);

    drawTextLikeLine(image, 8, [244, 244, 244]);
    drawTextLikeLine(image, 24, [244, 244, 244]);

    const analysis = analyzeMessagePresence(image);

    expect(analysis.present).toBe(true);
    expect(analysis.fingerprint).not.toBeNull();
    expect(analysis.whiteForegroundRatio).toBeGreaterThan(0);
    expect(analysis.yellowForegroundRatio).toBe(0);
    expect(analysis.lineBandCount).toBe(2);
    expect(analysis.componentCount).toBeGreaterThan(1);
    expect(analysis.rejectReason).toBeNull();
  });

  it("detects yellow text-like foreground", () => {
    const image = createImage(96, 40);

    drawTextLikeLine(image, 8, [244, 236, 42]);
    drawTextLikeLine(image, 24, [244, 236, 42]);

    const analysis = analyzeMessagePresence(image);

    expect(analysis.present).toBe(true);
    expect(analysis.fingerprint).not.toBeNull();
    expect(analysis.whiteForegroundRatio).toBe(0);
    expect(analysis.yellowForegroundRatio).toBeGreaterThan(0);
    expect(analysis.lineBandCount).toBe(2);
  });

  it("rejects a large yellow rectangle as non-text", () => {
    const image = createImage(96, 40);

    fillRect(image, 12, 10, 48, 12, 244, 236, 42);

    const analysis = analyzeMessagePresence(image);

    expect(analysis.foregroundRatio).toBeGreaterThan(0);
    expect(analysis.present).toBe(false);
    expect(analysis.fingerprint).toBeNull();
    expect(analysis.largestComponentRatio).toBe(1);
    expect(analysis.rejectReason).toBe("component");
  });

  it("rejects a giant single connected component", () => {
    const image = createImage(96, 40);

    fillRect(image, 10, 8, 60, 2, 244, 244, 244);
    fillRect(image, 10, 26, 60, 2, 244, 244, 244);
    fillRect(image, 10, 10, 2, 16, 244, 244, 244);
    fillRect(image, 68, 10, 2, 16, 244, 244, 244);

    const analysis = analyzeMessagePresence(image);

    expect(analysis.componentCount).toBe(1);
    expect(analysis.largestComponentRatio).toBe(1);
    expect(analysis.present).toBe(false);
    expect(analysis.rejectReason).toBe("component");
  });

  it("rejects background noise that does not form a line band", () => {
    const image = createImage(96, 40);

    for (let y = 1; y < image.height; y += 4) {
      fillRect(image, 4 + (y * 7) % 70, y, 2, 1, 244, 244, 244);
    }

    const analysis = analyzeMessagePresence(image);

    expect(analysis.foregroundRatio).toBeGreaterThanOrEqual(
      DEFAULT_MESSAGE_PRESENCE_CONFIG.minForegroundRatio,
    );
    expect(analysis.componentCount).toBeGreaterThan(1);
    expect(analysis.lineBandCount).toBe(0);
    expect(analysis.present).toBe(false);
    expect(analysis.rejectReason).toBe("line-band");
  });

  it("shares the existing white and yellow mask behavior", () => {
    expect(isBrightWhiteTextPixel(244, 244, 244, 255, 180)).toBe(true);
    expect(isBrightWhiteTextPixel(244, 236, 42, 255, 180)).toBe(false);
    expect(isBrightYellowTextPixel(244, 236, 42, 255)).toBe(true);
    expect(isBrightYellowTextPixel(122, 112, 18, 255)).toBe(false);
    expect(isBrightYellowTextPixel(42, 88, 238, 255)).toBe(false);

    const source = new ImageData(
      new Uint8ClampedArray([
        244, 244, 244, 255,
        244, 236, 42, 255,
        42, 88, 238, 255,
      ]),
      3,
      1,
    );
    const sharedMask = preprocessMessageImageData(source, {
      whiteThreshold: 180,
      background: "black",
      invert: false,
      textMask: "white-yellow",
    });
    const analysis = analyzeMessagePresence(source);

    expect(readPixel(sharedMask, 0)).toEqual([255, 255, 255, 255]);
    expect(readPixel(sharedMask, 1)).toEqual([255, 255, 255, 255]);
    expect(readPixel(sharedMask, 2)).toEqual([0, 0, 0, 255]);
    expect(analysis.whiteForegroundRatio).toBeCloseTo(1 / 3);
    expect(analysis.yellowForegroundRatio).toBeCloseTo(1 / 3);
    expect(analysis.foregroundRatio).toBeCloseTo(2 / 3);
  });

  it("recognizes a progressively rendered continuation as the same visual message", () => {
    const partialImage = createImage(96, 40);
    const completedImage = createImage(96, 40);

    drawTextLikeLineRange(partialImage, 8, 6, 48, [244, 244, 244]);
    drawTextLikeLineRange(partialImage, 24, 6, 48, [244, 244, 244]);
    drawTextLikeLineRange(completedImage, 8, 6, 78, [244, 244, 244]);
    drawTextLikeLineRange(completedImage, 24, 6, 78, [244, 244, 244]);

    const partial = analyzeMessagePresence(partialImage);
    const completed = analyzeMessagePresence(completedImage);

    expect(partial.present).toBe(true);
    expect(completed.present).toBe(true);
    expect(partial.visualSignature).not.toBeNull();
    expect(completed.visualSignature).not.toBeNull();

    const comparison = compareMessageVisualSignatures(
      partial.visualSignature!,
      completed.visualSignature!,
    );

    expect(comparison.retainedFromPrevious).toBe(1);
    expect(comparison.progressiveRender).toBe(true);
    expect(comparison.likelySameMessage).toBe(true);
  });

  it("recognizes a contained shorter rendering as the same visual message", () => {
    const completedImage = createImage(96, 40);
    const containedImage = createImage(96, 40);

    drawTextLikeLineRange(completedImage, 8, 6, 78, [244, 244, 244]);
    drawTextLikeLineRange(completedImage, 24, 6, 78, [244, 244, 244]);
    drawTextLikeLineRange(containedImage, 8, 6, 54, [244, 244, 244]);
    drawTextLikeLineRange(containedImage, 24, 6, 54, [244, 244, 244]);

    const completed = analyzeMessagePresence(completedImage);
    const contained = analyzeMessagePresence(containedImage);

    expect(completed.visualSignature).not.toBeNull();
    expect(contained.visualSignature).not.toBeNull();

    const comparison = compareMessageVisualSignatures(
      completed.visualSignature!,
      contained.visualSignature!,
    );

    expect(comparison.progressiveRender).toBe(false);
    expect(comparison.retainedFromCurrent).toBe(1);
    expect(comparison.sharedOverMinimumForeground).toBe(1);
    expect(comparison.boundsOverlap).toBeGreaterThanOrEqual(0.45);
    expect(comparison.likelySameMessage).toBe(true);
  });
});
