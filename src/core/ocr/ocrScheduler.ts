import {
  areMessageMaskFingerprintsSimilar,
  type MessageMaskFingerprint,
} from "../preprocess/messagePreprocess";

export const MAX_DEFERRED_OCR_SAMPLES = 3;

export interface FingerprintedOcrSample {
  messageFingerprint: MessageMaskFingerprint;
  observationId?: string | null;
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
  droppedSample: T | null;
}

type ActiveOcrSample = FingerprintedOcrSample | MessageMaskFingerprint;

function hasMessageFingerprint(value: ActiveOcrSample): value is FingerprintedOcrSample {
  return "messageFingerprint" in value;
}

function getObservationId(sample: ActiveOcrSample) {
  return hasMessageFingerprint(sample) ? sample.observationId ?? null : null;
}

function getMessageFingerprint(sample: ActiveOcrSample) {
  return hasMessageFingerprint(sample) ? sample.messageFingerprint : sample;
}

function hasSameObservationIdentity(
  left: FingerprintedOcrSample,
  right: ActiveOcrSample,
) {
  const leftObservationId = left.observationId ?? null;
  const rightObservationId = getObservationId(right);

  if (leftObservationId === null || rightObservationId === null) {
    return leftObservationId === null && rightObservationId === null;
  }

  return leftObservationId === rightObservationId;
}

function areSamplesDuplicates(
  left: FingerprintedOcrSample,
  right: ActiveOcrSample,
) {
  return (
    hasSameObservationIdentity(left, right) &&
    areMessageMaskFingerprintsSimilar(
      left.messageFingerprint,
      getMessageFingerprint(right),
    )
  );
}

export function enqueueDeferredOcrSample<T extends FingerprintedOcrSample>(
  currentQueue: readonly T[],
  sample: T,
  activeSample: ActiveOcrSample | null,
  maxQueueLength = MAX_DEFERRED_OCR_SAMPLES,
): DeferredOcrEnqueueResult<T> {
  if (activeSample && areSamplesDuplicates(sample, activeSample)) {
    return {
      queue: [...currentQueue],
      action: "ignored_active_duplicate",
      replacedIndex: null,
      droppedSample: null,
    };
  }

  const duplicateIndex = currentQueue.findIndex((queuedSample) =>
    areSamplesDuplicates(sample, queuedSample),
  );

  if (duplicateIndex >= 0) {
    const nextQueue = [...currentQueue];
    nextQueue[duplicateIndex] = sample;

    return {
      queue: nextQueue,
      action: "replaced_deferred_duplicate",
      replacedIndex: duplicateIndex,
      droppedSample: null,
    };
  }

  if (currentQueue.length >= Math.max(0, maxQueueLength)) {
    return {
      queue: [...currentQueue],
      action: "dropped_queue_full",
      replacedIndex: null,
      droppedSample: sample,
    };
  }

  return {
    queue: [...currentQueue, sample],
    action: "queued_distinct",
    replacedIndex: null,
    droppedSample: null,
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
