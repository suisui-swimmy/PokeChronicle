import Tesseract from "tesseract.js";
import type {
  OCRImageInput,
  OCRPageSegMode,
  OCRProvider,
  OCRRecognizeOptions,
  OCRResult,
} from "./types";
import type { TesseractWorkerConfig } from "./tesseractConfig";

type TesseractLine = Tesseract.Line;
type TesseractLogger = Tesseract.WorkerOptions["logger"];

export interface TesseractOCRProviderOptions extends TesseractWorkerConfig {
  logger?: TesseractLogger;
}

const PAGE_SEG_MODE_BY_ID: Record<OCRPageSegMode, Tesseract.PSM> = {
  single_block: Tesseract.PSM.SINGLE_BLOCK,
  single_line: Tesseract.PSM.SINGLE_LINE,
  sparse_text: Tesseract.PSM.SPARSE_TEXT,
};

function toUnitConfidence(confidence: number | null | undefined) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }

  return Math.max(0, Math.min(1, confidence / 100));
}

function mapLine(line: TesseractLine) {
  return {
    text: line.text,
    confidence: toUnitConfidence(line.confidence),
    bbox: line.bbox
      ? {
          x: line.bbox.x0,
          y: line.bbox.y0,
          width: line.bbox.x1 - line.bbox.x0,
          height: line.bbox.y1 - line.bbox.y0,
        }
      : null,
  };
}

function getLines(page: Tesseract.Page) {
  return (
    page.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.map(mapLine)),
    ) ?? []
  );
}

export class TesseractOCRProvider implements OCRProvider {
  private workerPromise: Promise<Tesseract.Worker> | null = null;

  constructor(private readonly options: TesseractOCRProviderOptions) {}

  async recognize(
    image: OCRImageInput,
    options: OCRRecognizeOptions = {},
    jobId?: string,
  ): Promise<OCRResult> {
    const worker = await this.getWorker();
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PAGE_SEG_MODE_BY_ID[options.pageSegMode ?? "single_block"],
    });
    const result = await worker.recognize(
      image as Tesseract.ImageLike,
      undefined,
      { text: true, blocks: true },
      jobId,
    );

    return {
      rawText: result.data.text.trim(),
      confidence: toUnitConfidence(result.data.confidence),
      lines: getLines(result.data),
    };
  }

  async terminate() {
    if (!this.workerPromise) {
      return;
    }

    const worker = await this.workerPromise;
    await worker.terminate();
    this.workerPromise = null;
  }

  private getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = this.createWorker();
    }

    return this.workerPromise;
  }

  private async createWorker() {
    const workerOptions: Partial<Tesseract.WorkerOptions> = {};

    if (this.options.workerPath) {
      workerOptions.workerPath = this.options.workerPath;
    }

    if (this.options.corePath) {
      workerOptions.corePath = this.options.corePath;
    }

    if (this.options.langPath) {
      workerOptions.langPath = this.options.langPath;
    }

    if (this.options.logger) {
      workerOptions.logger = this.options.logger;
    }

    const worker = await Tesseract.createWorker(
      this.options.language,
      Tesseract.OEM.LSTM_ONLY,
      workerOptions,
    );

    return worker;
  }
}
