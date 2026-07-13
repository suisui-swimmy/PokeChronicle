import {
  areMessageMaskFingerprintsSimilar,
  type MessageMaskFingerprint,
} from "../preprocess/messagePreprocess";

export const MAX_DEFERRED_OCR_SAMPLES = 3;

export interface FingerprintedOcrSample {
  messageFingerprint: MessageMaskFingerprint;
}

export type DeferredOcrEnqueueAction =
  | "ignored_active_duplicate"
  | "replaced_deferred_duplicate"
  | "queued_distinct"
  | "dropped_queue_full";

export interface DeferredOcrEnqueueResult<T extends FingerprintedOcrSample> {
  queue: T[];
  action: DeferredOcrEnqueueAction;
  replacedIndex: number | null;
}

export function enqueueDeferredOcrSample<T extends FingerprintedOcrSample>(
  currentQueue: readonly T[],
  sample: T,
  activeFingerprint: MessageMaskFingerprint | null,
  maxQueueLength = MAX_DEFERRED_OCR_SAMPLES,
): DeferredOcrEnqueueResult<T> {
  if (
    activeFingerprint &&
    areMessageMaskFingerprintsSimilar(sample.messageFingerprint, activeFingerprint)
  ) {
    return {
      queue: [...currentQueue],
      action: "ignored_active_duplicate",
      replacedIndex: null,
    };
  }

  const duplicateIndex = currentQueue.findIndex((queuedSample) =>
    areMessageMaskFingerprintsSimilar(
      sample.messageFingerprint,
      queuedSample.messageFingerprint,
    ),
  );

  if (duplicateIndex >= 0) {
    const nextQueue = [...currentQueue];
    nextQueue[duplicateIndex] = sample;

    return {
      queue: nextQueue,
      action: "replaced_deferred_duplicate",
      replacedIndex: duplicateIndex,
    };
  }

  if (currentQueue.length >= Math.max(0, maxQueueLength)) {
    return {
      queue: [...currentQueue],
      action: "dropped_queue_full",
      replacedIndex: null,
    };
  }

  return {
    queue: [...currentQueue, sample],
    action: "queued_distinct",
    replacedIndex: null,
  };
}

export function takeNextDeferredOcrSample<T>(currentQueue: readonly T[]) {
  return {
    sample: currentQueue[0] ?? null,
    queue: currentQueue.slice(1),
  };
}

export function shouldPreemptOcrRetry(currentQueue: readonly unknown[]) {
  return currentQueue.length > 0;
}
