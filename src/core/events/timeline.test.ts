import { describe, expect, it } from "vitest";
import { parseBattleMessage } from "../parser/seedParser";
import {
  createAcceptedEventRecord,
  createConstrainedCandidateRecord,
  createSourceFrameRef,
  createTimelineObservation,
  shouldCreateUnknownEvent,
  shouldSuppressTimelineObservation,
  type TimelineAcceptedEventRecord,
  type TimelineConstrainedCandidateRecord,
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

function createObservationFromParse(
  rawText: string,
  parseResult: ReturnType<typeof parseBattleMessage>,
  id: string,
  timestampMs: number,
  ocrConfidence: number | null,
  recentConstrainedCandidates: TimelineConstrainedCandidateRecord[] = [],
  recentAcceptedEvents: TimelineAcceptedEventRecord[] = [],
) {
  return createTimelineObservation({
    id,
    battleId: "battle_test",
    rawText,
    parseResult,
    ocrConfidence,
    lines: [{ text: rawText, confidence: ocrConfidence, bbox: null }],
    frameIndex: 12,
    timestampMs,
    roi,
    afterEventId: "evt_previous",
    recentConstrainedCandidates,
    recentAcceptedEvents,
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
    expect(observation.events).toHaveLength(1);
    expect(observation.unknown).toBeNull();
  });

  it("creates multiple battle events from one OCR observation", () => {
    const observation = createObservation(
      "ゆけっ! エルフーン!\nマフォクシー!",
      "ocr-double",
      1400,
      0.92,
    );

    expect(observation.ocrMessage.rawText).toBe("ゆけっ! エルフーン!\nマフォクシー!");
    expect(observation.events).toHaveLength(2);
    expect(observation.events.map((event) => event.id)).toEqual([
      "evt_ocr-double_1",
      "evt_ocr-double_2",
    ]);
    expect(observation.events.map((event) => event.actor.name)).toEqual([
      "エルフーン",
      "マフォクシー",
    ]);
    expect(observation.dedupes).toHaveLength(2);
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
    expect(observation.dedupes).toEqual([]);
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
    expect(
      shouldCreateUnknownEvent({
        matchText: "相手のキュウコンの",
        normalizedText: "相手の キュウコンの",
        ocrConfidence: 0.86,
        candidateMatches: ["partial-template;eventType=move"],
      }),
    ).toBe(false);
    expect(
      shouldCreateUnknownEvent({
        matchText: "特性持ち物",
        normalizedText: "特性 持ち物",
        ocrConfidence: 0.9,
        candidateMatches: [],
      }),
    ).toBe(false);
    expect(
      shouldCreateUnknownEvent({
        matchText: "05:39",
        normalizedText: "05:39",
        ocrConfidence: 0.9,
        candidateMatches: [],
      }),
    ).toBe(false);
  });

  it("keeps OCR raw messages while suppressing UI fragments from UnknownEvent", () => {
    for (const rawText of ["相手の キュウコンの", "味方の", "特性 持ち物", "ーー 05:39 h"]) {
      const observation = createObservation(rawText, `ocr-${rawText}`, 1800, 0.86);

      expect(observation.ocrMessage.rawText).toBe(rawText);
      expect(observation.event).toBeNull();
      expect(observation.unknown).toBeNull();
      expect(observation.dedupes).toEqual([]);
    }
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

  it("suppresses repeats against a recent dedupe record ring", () => {
    const first = createObservation("ガブリアスの じしん！", "ocr-1", 1000);
    const interveningUnknown = createObservation("まだ分類できないメッセージ", "ocr-2", 1400);
    const repeated = createObservation("ガブリアスの\nじしん/", "ocr-3", 1800);
    const recentRecords = [first.dedupe, interveningUnknown.dedupe].filter(
      (record): record is NonNullable<typeof record> => record !== null,
    );

    expect(shouldSuppressTimelineObservation(recentRecords, repeated.dedupe)).toBe(true);
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

  it("promotes repeated constrained review candidates within the duplicate window", () => {
    const rawText = "相手の キュウコンの\nオーパーヒードト/";
    const firstParse = parseBattleMessage({
      rawText,
      lines: ["相手の キュウコンの", "オーパーヒードト/"],
      ocrConfidence: 0.5,
    });
    const firstObservation = createObservationFromParse(
      rawText,
      firstParse,
      "ocr-1",
      1000,
      0.5,
    );
    const record = createConstrainedCandidateRecord(firstParse, 1000, 12);
    const secondParse = parseBattleMessage({
      rawText,
      lines: ["相手の キュウコンの", "オーパーヒードト/"],
      ocrConfidence: 0.5,
    });
    const secondObservation = createObservationFromParse(
      rawText,
      secondParse,
      "ocr-2",
      1600,
      0.5,
      record ? [record] : [],
    );

    expect(firstObservation.event).toBeNull();
    expect(record?.identity).toContain("キュウコン");
    expect(secondObservation.event).toMatchObject({
      type: "move",
      actor: { name: "キュウコン", side: "opponent" },
      move: "オーバーヒート",
      rawText,
    });
    expect(secondObservation.unknown).toBeNull();
  });

  it("suppresses partial template unknowns when a matching accepted event is nearby", () => {
    const accepted = createObservation("相手の キュウコンの オーバーヒート!", "ocr-1", 1000);
    const acceptedRecord = accepted.event ? createAcceptedEventRecord(accepted.event) : null;
    const partialRawText = "相手の キュウコンの";
    const partialParse = parseBattleMessage({
      rawText: partialRawText,
      ocrConfidence: 0.86,
    });
    const partial = createObservationFromParse(
      partialRawText,
      partialParse,
      "ocr-2",
      1500,
      0.86,
      [],
      acceptedRecord ? [acceptedRecord] : [],
    );

    expect(partialParse).toMatchObject({ status: "unknown" });
    expect(partialParse.candidateMatches.join("\n")).toContain("partial-template;");
    expect(partial.event).toBeNull();
    expect(partial.unknown).toBeNull();
    expect(partial.ocrMessage.rawText).toBe(partialRawText);
  });
});
