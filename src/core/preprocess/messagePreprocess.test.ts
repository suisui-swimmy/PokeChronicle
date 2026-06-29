import { describe, expect, it } from "vitest";
import { preprocessMessageImageData } from "./messagePreprocess";

function pixelAt(image: ImageData, pixelIndex: number) {
  const index = pixelIndex * 4;

  return Array.from(image.data.slice(index, index + 4));
}

describe("preprocessMessageImageData", () => {
  it("extracts bright low-chroma pixels onto a solid background", () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        245, 246, 244, 255,
        32, 36, 42, 255,
      ]),
      2,
      1,
    );

    const result = preprocessMessageImageData(source, {
      whiteThreshold: 180,
      background: "black",
      invert: false,
    });

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
});
