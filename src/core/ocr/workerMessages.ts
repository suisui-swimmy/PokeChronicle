import type { NormalizedRoi } from "../events/schema";
import type { TesseractWorkerConfig } from "./tesseractConfig";
import type { OCRResult } from "./types";

export interface OCRWorkerJobMeta {
  cropHeight: number;
  cropWidth: number;
  frameIndex: number;
  roi: NormalizedRoi;
  timestampMs: number;
}

export type OCRWorkerRequest =
  | {
      type: "recognize";
      jobId: string;
      imageDataUrl: string;
      meta: OCRWorkerJobMeta;
      config: TesseractWorkerConfig;
    }
  | {
      type: "terminate";
      jobId: string;
    };

export type OCRWorkerResponse =
  | {
      type: "progress";
      jobId: string;
      progress: number;
      status: string;
    }
  | {
      type: "result";
      jobId: string;
      meta: OCRWorkerJobMeta;
      result: OCRResult;
    }
  | {
      type: "error";
      jobId: string;
      meta?: OCRWorkerJobMeta;
      recoverable?: boolean;
      message: string;
    }
  | {
      type: "terminated";
      jobId: string;
    };
