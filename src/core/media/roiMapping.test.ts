import { describe, expect, it } from "vitest";
import { getContainedMediaRect, mapDisplayRoiToSourceRect } from "./roiMapping";

describe("roiMapping", () => {
  it("finds the centered media rect for object-fit contain", () => {
    expect(
      getContainedMediaRect({ width: 1400, height: 280 }, { width: 1920, height: 1080 }),
    ).toEqual({
      x: 451.1111111111111,
      y: 0,
      width: 497.77777777777777,
      height: 280,
    });
  });

  it("maps display ROI through the contained media rect instead of full letterboxed surface", () => {
    const crop = mapDisplayRoiToSourceRect(
      { x: 0.24, y: 0.2, w: 0.5, h: 0.7 },
      { width: 1920, height: 1080 },
      { width: 1400, height: 600 },
    );

    expect(crop).toEqual({
      x: 305,
      y: 216,
      width: 1260,
      height: 756,
    });
  });

  it("returns null when the ROI is completely outside the rendered media", () => {
    expect(
      mapDisplayRoiToSourceRect(
        { x: 0, y: 0, w: 0.05, h: 0.2 },
        { width: 1920, height: 1080 },
        { width: 1400, height: 600 },
      ),
    ).toBeNull();
  });
});
