import { describe, expect, it } from "vitest";
import { StaticOCRProvider } from "./staticOCRProvider";

describe("StaticOCRProvider", () => {
  it("returns a deterministic OCR result for tests and UI doubles", async () => {
    const provider = new StaticOCRProvider({
      rawText: "ニンフィアの\nハイパーボイス!",
      confidence: 0.91,
      lines: [],
    });

    await expect(provider.recognize("data:image/png;base64,test")).resolves.toEqual({
      rawText: "ニンフィアの\nハイパーボイス!",
      confidence: 0.91,
      lines: [],
    });
  });
});
