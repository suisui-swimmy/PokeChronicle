import { describe, expect, it } from "vitest";
import { parseBattleMessage } from "../parser/seedParser";
import {
  createSourceFrameRef,
  createTimelineObservation,
  shouldSuppressTimelineObservation,
} from "./timeline";

const roi = { x: 0.1, y: 0.7, w: 0.8, h: 0.2 };

function createObservation(rawText: string, id = "ocr-1", timestampMs = 1000) {
  return createTimelineObservation({
    id,
    battleId: "battle_test",
    rawText,
    parseResult: parseBattleMessage(rawText),
    ocrConfidence: 0.91,
    lines: [{ text: rawText, confidence: 0.91, bbox: null }],
    frameIndex: 12,
    timestampMs,
    roi,
    afterEventId: "evt_previous",
  });
}

describe("timeline observation", () => {
  it("creates an OCR message and parsed battle event from a parser result", () => {
    const observation = createObservation("ガブリアスの じしん！");

    expect(observation.ocrMessage.rawText).toBe("ガブリアスの じしん！");
    expect(observation.ocrMessage.matchText).toBe("ガブリアスのじしん");
    expect(observation.event).toMatchObject({
      id: "evt_ocr-1",
      battleId: "battle_test",
      type: "move",
      actor: { name: "ガブリアス", side: null },
      move: "じしん",
      source: { frameIndex: 12, timestampMs: 1000, cropObjectUrl: null },
    });
    expect(observation.unknown).toBeNull();
  });

  it("keeps unsupported OCR text as a reviewable unknown", () => {
    const observation = createObservation("まだ分類できないメッセージ");

    expect(observation.event).toBeNull();
    expect(observation.unknown).toMatchObject({
      id: "unk_ocr-1",
      battleId: "battle_test",
      afterEventId: "evt_previous",
      reviewStatus: "unreviewed",
      sourceFrameRef: createSourceFrameRef(12, 1000),
    });
    expect(observation.unknown?.rawText).toBe("まだ分類できないメッセージ");
  });

  it("does not create an unknown bucket item for empty OCR output", () => {
    const observation = createObservation("");

    expect(observation.ocrMessage.normalizedText).toBe("");
    expect(observation.event).toBeNull();
    expect(observation.unknown).toBeNull();
    expect(observation.dedupe).toBeNull();
  });

  it("suppresses same-message timeline repeats in a short time window", () => {
    const first = createObservation("ガブリアスの じしん！", "ocr-1", 1000);
    const repeated = createObservation("ガブリアスの じしん！", "ocr-2", 1800);
    const later = createObservation("ガブリアスの じしん！", "ocr-3", 5000);
    const different = createObservation("効果は バツグンだ！", "ocr-4", 1900);

    expect(shouldSuppressTimelineObservation(first.dedupe, repeated.dedupe)).toBe(true);
    expect(shouldSuppressTimelineObservation(first.dedupe, later.dedupe)).toBe(false);
    expect(shouldSuppressTimelineObservation(first.dedupe, different.dedupe)).toBe(false);
  });
});
