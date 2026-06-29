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
    const result = await ocrProvider.recognize(request.imageDataUrl, request.jobId);

    postWorkerMessage({
      type: "result",
      jobId: request.jobId,
      meta: request.meta,
      result,
    });
  } catch (error) {
    postWorkerMessage({
      type: "error",
      jobId: request.jobId,
      meta: request.meta,
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
    void provider?.terminate().finally(() => {
      provider = null;
      providerConfigKey = "";
      postWorkerMessage({ type: "terminated", jobId: request.jobId });
    });
  }
});
