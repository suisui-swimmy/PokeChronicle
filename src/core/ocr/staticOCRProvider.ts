import type { OCRImageInput, OCRProvider, OCRResult } from "./types";

export class StaticOCRProvider implements OCRProvider {
  constructor(private readonly result: OCRResult) {}

  async recognize(_image: OCRImageInput): Promise<OCRResult> {
    return this.result;
  }
}
