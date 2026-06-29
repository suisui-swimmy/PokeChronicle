import type { OCRLine } from "../events/schema";

export type OCRImageInput =
  | string
  | Blob
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas;

export interface OCRResult {
  lines: OCRLine[];
  rawText: string;
  confidence: number | null;
}

export interface OCRProvider {
  recognize(image: OCRImageInput): Promise<OCRResult>;
  terminate?(): Promise<void>;
}
