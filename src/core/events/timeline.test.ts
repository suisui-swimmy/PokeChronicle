import { describe, expect, it } from "vitest";
import { parseBattleMessage } from "../parser/seedParser";
import {
  createSourceFrameRef,
  createTimelineObservation,
  shouldCreateUnknownEvent,
  shouldSuppressTimelineObservation,
} from "./timeline";

const roi = { x: 0.1, y: 0.7, w: 0.8, h: 0.2 };

function createObservation(
  rawText: string,
  id = "ocr-1",
  timestampMs = 1000,
  ocrConfidence: number | null = 0.91,
) {
  return createTimelineObservation({
    id,
    battleId: "battle_test",
    rawText,
    parseResult: parseBattleMessage(rawText),
    ocrConfidence,
    lines: [{ text: rawText, confidence: ocrConfidence, bbox: null }],
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

  it("does not promote short OCR noise into unknown events", () => {
    for (const rawText of ["m", "ama", "に", "に、"]) {
      const observation = createObservation(rawText);

      expect(observation.event).toBeNull();
      expect(observation.unknown).toBeNull();
      expect(observation.dedupe).toBeNull();
    }
  });

  it("uses the unknown gate policy for reviewable OCR text", () => {
    expect(
      shouldCreateUnknownEvent({
        matchText: "m",
        normalizedText: "m",
        ocrConfidence: 0.99,
        candidateMatches: [],
      }),
    ).toBe(false);
    expect(
      shouldCreateUnknownEvent({
        matchText: "ama",
        normalizedText: "ama",
        ocrConfidence: 0.99,
        candidateMatches: [],
      }),
    ).toBe(false);
    expect(
      shouldCreateUnknownEvent({
        matchText: "まだ分類できないメッセージ",
        normalizedText: "まだ分類できないメッセージ",
        ocrConfidence: 0.91,
        candidateMatches: [],
      }),
    ).toBe(true);
    expect(
      shouldCreateUnknownEvent({
        matchText: "エルフーンムーンフォース",
        normalizedText: "エルフーン ムーンフォース",
        ocrConfidence: 0.45,
        candidateMatches: ["span:pokemon", "span:move"],
      }),
    ).toBe(true);
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

  it("deduplicates resolved events by structure instead of OCR match text", () => {
    const first = createObservation("ガブリアスの じしん！", "ocr-1", 1000);
    const noisySameMove = createObservation("ガブリアスの\nじしん/", "ocr-2", 1600);
    const differentMove = createObservation("ガブリアスの まもる！", "ocr-3", 1600);
    const differentActor = createObservation("ルカリオの じしん！", "ocr-4", 1600);

    expect(first.dedupe?.key).toBe(noisySameMove.dedupe?.key);
    expect(first.dedupe?.key).not.toBe(differentMove.dedupe?.key);
    expect(first.dedupe?.key).not.toBe(differentActor.dedupe?.key);
  });

  it("deduplicates noisy supereffective events to the same key", () => {
    const first = createObservation("効果は バツグンだ！", "ocr-1", 1000);
    const noisy = createObservation("効果は パツグンだ", "ocr-2", 1600);

    expect(first.dedupe?.key).toBe(noisy.dedupe?.key);
  });
});
