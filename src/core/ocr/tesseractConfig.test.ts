import { describe, expect, it } from "vitest";
import {
  DEFAULT_TESSERACT_LANG_PATH,
  createTesseractWorkerConfig,
  resolveTesseractAssetPath,
} from "./tesseractConfig";

describe("tesseractConfig", () => {
  it("resolves relative asset paths against the Vite base path", () => {
    expect(resolveTesseractAssetPath("tessdata", "/PokeChronicle/")).toBe(
      "/PokeChronicle/tessdata",
    );
  });

  it("leaves absolute urls untouched apart from a trailing slash", () => {
    expect(resolveTesseractAssetPath("https://example.test/tessdata/", "/PokeChronicle/")).toBe(
      "https://example.test/tessdata",
    );
  });

  it("uses Japanese OCR and a stable language data path by default", () => {
    expect(createTesseractWorkerConfig({}, "/PokeChronicle/")).toEqual({
      language: "jpn",
      workerPath: undefined,
      corePath: undefined,
      langPath: DEFAULT_TESSERACT_LANG_PATH,
    });
  });

  it("allows language data path overrides", () => {
    expect(
      createTesseractWorkerConfig(
        {
          VITE_TESSERACT_LANG_PATH: "tessdata",
        },
        "/PokeChronicle/",
      ).langPath,
    ).toBe("/PokeChronicle/tessdata");
  });
});
