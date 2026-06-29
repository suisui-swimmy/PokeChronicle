import "@testing-library/jest-dom/vitest";

if (!globalThis.ImageData) {
  class TestImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: PredefinedColorSpace = "srgb";

    constructor(width: number, height: number);
    constructor(data: Uint8ClampedArray, width: number, height?: number);
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      height?: number,
    ) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
        return;
      }

      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / this.width;
      this.data = dataOrWidth;
    }
  }

  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    value: TestImageData,
  });
}
