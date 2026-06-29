import { describe, expect, it } from "vitest";
import { createOcrMatchText, normalizeOcrText } from "./ocrText";

describe("normalizeOcrText", () => {
  it("keeps raw OCR recoverable while deriving compact display text", () => {
    expect(normalizeOcrText("エルフーンの\n おいかぜ！ ")).toBe("エルフーンのおいかぜ!");
  });

  it("creates punctuation-light text for later parser matching", () => {
    expect(createOcrMatchText("相手の エルフーンの アンコール！")).toBe(
      "相手のエルフーンのアンコール",
    );
  });

  it("normalizes slash-like OCR noise as an exclamation candidate", () => {
    expect(normalizeOcrText("マフォオクシーの\nまもる/")).toBe("マフォオクシーのまもる!");
    expect(createOcrMatchText("マフォオクシーの\nまもる/")).toBe("マフォオクシーのまもる");
  });
});
