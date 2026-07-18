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
  observationId?: string | null;
}

function createFingerprint(value: number): MessageMaskFingerprint {
  return {
    columns: 2,
    rows: 2,
    cells: [value, value, value, value],
    foregroundPixelRatio: value / 100,
  };
}

function createSample(
  id: string,
  value: number,
  observationId?: string | null,
): TestSample {
  return { id, messageFingerprint: createFingerprint(value), observationId };
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

  it("preserves an observation id through enqueue and dequeue", () => {
    const queued = enqueueDeferredOcrSample(
      [],
      createSample("observed", 10, "obs-1"),
      null,
    );
    const next = takeNextDeferredOcrSample(queued.queue);

    expect(queued.action).toBe("queued_distinct");
    expect(next.sample?.observationId).toBe("obs-1");
  });

  it("ignores a matching active frame from the same observation", () => {
    const active = createSample("active", 10, "obs-1");
    const repeated = createSample("repeated", 11, "obs-1");
    const result = enqueueDeferredOcrSample([], repeated, active);

    expect(result.action).toBe("ignored_active_duplicate");
    expect(result.queue).toEqual([]);
  });

  it("replaces a newer frame from the same observation in the same FIFO position", () => {
    const first = createSample("first", 10, "obs-1");
    const second = createSample("second", 50, "obs-2");
    const replacement = createSample("replacement", 11, "obs-1");
    const result = enqueueDeferredOcrSample([first, second], replacement, null);

    expect(result.action).toBe("replaced_deferred_duplicate");
    expect(result.replacedIndex).toBe(0);
    expect(result.queue.map((sample) => sample.id)).toEqual(["replacement", "second"]);
    expect(result.queue[0].observationId).toBe("obs-1");
  });

  it("keeps matching fingerprints from different observations distinct", () => {
    const active = createSample("active", 10, "obs-active");
    const queued = createSample("queued", 10, "obs-queued");
    const activeResult = enqueueDeferredOcrSample([], queued, active);
    const deferredResult = enqueueDeferredOcrSample(
      [createSample("first", 10, "obs-first")],
      queued,
      null,
    );

    expect(activeResult.action).toBe("queued_distinct");
    expect(activeResult.queue).toEqual([queued]);
    expect(deferredResult.action).toBe("queued_distinct");
    expect(deferredResult.queue.map((sample) => sample.observationId)).toEqual([
      "obs-first",
      "obs-queued",
    ]);
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

  it("returns the incoming observation when a full queue drops it", () => {
    const queued = [
      createSample("one", 5, "obs-1"),
      createSample("two", 40, "obs-2"),
      createSample("three", 75, "obs-3"),
    ];
    const incoming = createSample("four", 100, "obs-4");
    const result = enqueueDeferredOcrSample(queued, incoming, null, 3);

    expect(result.action).toBe("dropped_queue_full");
    expect(result.droppedSample).toBe(incoming);
    expect(result.droppedSample?.observationId).toBe("obs-4");
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
