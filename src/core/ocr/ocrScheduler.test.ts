import { describe, expect, it } from "vitest";
import type { MessageMaskFingerprint } from "../preprocess/messagePreprocess";
import {
  enqueueDeferredOcrSample,
  shouldPreemptOcrRetry,
  takeNextDeferredOcrSample,
} from "./ocrScheduler";

interface TestSample {
  id: string;
  messageFingerprint: MessageMaskFingerprint;
}

function createFingerprint(value: number): MessageMaskFingerprint {
  return {
    columns: 2,
    rows: 2,
    cells: [value, value, value, value],
    foregroundPixelRatio: value / 100,
  };
}

function createSample(id: string, value: number): TestSample {
  return { id, messageFingerprint: createFingerprint(value) };
}

describe("OCR scheduler", () => {
  it("ignores a frame that matches the active message", () => {
    const result = enqueueDeferredOcrSample(
      [],
      createSample("same", 10),
      createFingerprint(10),
    );

    expect(result.action).toBe("ignored_active_duplicate");
    expect(result.queue).toEqual([]);
  });

  it("replaces a queued duplicate without changing FIFO order", () => {
    const first = createSample("first", 10);
    const second = createSample("second", 50);
    const replacement = createSample("replacement", 11);
    const result = enqueueDeferredOcrSample([first, second], replacement, null);

    expect(result.action).toBe("replaced_deferred_duplicate");
    expect(result.replacedIndex).toBe(0);
    expect(result.queue.map((sample) => sample.id)).toEqual(["replacement", "second"]);
  });

  it("keeps at most three distinct frames and preserves older queued messages", () => {
    const queued = [
      createSample("one", 5),
      createSample("two", 40),
      createSample("three", 75),
    ];
    const result = enqueueDeferredOcrSample(queued, createSample("four", 100), null, 3);

    expect(result.action).toBe("dropped_queue_full");
    expect(result.queue.map((sample) => sample.id)).toEqual(["one", "two", "three"]);
  });

  it("dequeues in FIFO order and preempts retry while a distinct frame waits", () => {
    const queued = [createSample("one", 5), createSample("two", 50)];

    expect(shouldPreemptOcrRetry(queued)).toBe(true);
    const next = takeNextDeferredOcrSample(queued);
    expect(next.sample?.id).toBe("one");
    expect(next.queue.map((sample) => sample.id)).toEqual(["two"]);
    expect(shouldPreemptOcrRetry([])).toBe(false);
  });
});
