import { TesseractOCRProvider } from "../core/ocr/tesseractProvider";
import type { TesseractWorkerConfig } from "../core/ocr/tesseractConfig";
import type { OCRWorkerRequest, OCRWorkerResponse } from "../core/ocr/workerMessages";

let provider: TesseractOCRProvider | null = null;
let providerConfigKey = "";

function postWorkerMessage(message: OCRWorkerResponse) {
  self.postMessage(message);
}

async function getProvider(config: TesseractWorkerConfig) {
  const nextConfigKey = JSON.stringify(config);

  if (provider && providerConfigKey === nextConfigKey) {
    return provider;
  }

  if (provider) {
    await provider.terminate();
  }

  providerConfigKey = nextConfigKey;
  provider = new TesseractOCRProvider({
    ...config,
    logger: (message) => {
      postWorkerMessage({
        type: "progress",
        jobId: message.userJobId || message.jobId,
        progress: message.progress,
        status: message.status,
      });
    },
  });

  return provider;
}

async function handleRecognize(request: Extract<OCRWorkerRequest, { type: "recognize" }>) {
  try {
    const ocrProvider = await getProvider(request.config);
    const startedAt = performance.now();
    const segmentResults = [];

    for (let index = 0; index < request.candidate.segments.length; index += 1) {
      const segment = request.candidate.segments[index];
      segmentResults.push(
        await ocrProvider.recognize(
          segment.imageDataUrl,
          { pageSegMode: segment.pageSegMode },
          `${request.jobId}-${index + 1}`,
        ),
      );
    }

    const nonNullConfidences = segmentResults
      .map((result) => result.confidence)
      .filter((confidence): confidence is number => confidence !== null);
    const result = {
      rawText: segmentResults
        .map((segmentResult) => segmentResult.rawText.trim())
        .filter(Boolean)
        .join("\n"),
      confidence: nonNullConfidences.length > 0
        ? nonNullConfidences.reduce((sum, confidence) => sum + confidence, 0) /
          nonNullConfidences.length
        : null,
      lines: segmentResults.flatMap((segmentResult) => segmentResult.lines),
    };

    postWorkerMessage({
      type: "result",
      jobId: request.jobId,
      meta: request.meta,
      candidate: request.candidate,
      result,
      segmentResults,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  } catch (error) {
    postWorkerMessage({
      type: "error",
      jobId: request.jobId,
      meta: request.meta,
      recoverable: true,
      message: error instanceof Error ? error.message : "OCR worker failed.",
    });
  }
}

self.addEventListener("message", (event: MessageEvent<OCRWorkerRequest>) => {
  const request = event.data;

  if (request.type === "recognize") {
    void handleRecognize(request);
    return;
  }

  if (request.type === "terminate") {
    const currentProvider = provider;

    provider = null;
    providerConfigKey = "";

    void Promise.resolve(currentProvider?.terminate()).finally(() => {
      provider = null;
      providerConfigKey = "";
      postWorkerMessage({ type: "terminated", jobId: request.jobId });
    });
  }
});
