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

export type OCRPageSegMode = "single_block" | "single_line" | "sparse_text";

export interface OCRRecognizeOptions {
  pageSegMode?: OCRPageSegMode;
}

export interface OCRProvider {
  recognize(
    image: OCRImageInput,
    options?: OCRRecognizeOptions,
    jobId?: string,
  ): Promise<OCRResult>;
  terminate?(): Promise<void>;
}
