import type { NormalizedRoi } from "../events/schema";
import type { TesseractWorkerConfig } from "./tesseractConfig";
import type { OCRResult } from "./types";
import type { OCRPageSegMode } from "./types";

export interface OCRWorkerJobMeta {
  cropHeight: number;
  cropWidth: number;
  frameIndex: number;
  observationId?: string | null;
  roi: NormalizedRoi;
  timestampMs: number;
}

export type OCRCandidateStrategy = "block" | "linewise" | "sparse";

export interface OCRWorkerCandidateSegment {
  id: string;
  imageDataUrl: string;
  pageSegMode: OCRPageSegMode;
}

export interface OCRWorkerRecognitionCandidate {
  id: string;
  variantId: string;
  strategy: OCRCandidateStrategy;
  segments: OCRWorkerCandidateSegment[];
}

export type OCRWorkerRequest =
  | {
      type: "recognize";
      jobId: string;
      candidate: OCRWorkerRecognitionCandidate;
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
      candidate: OCRWorkerRecognitionCandidate;
      result: OCRResult;
      segmentResults: OCRResult[];
      durationMs: number;
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
