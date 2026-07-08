import { describe, expect, it } from "vitest";
import type {
  BattleEvent,
  FrameSampleDiagnostic,
  OCRMessage,
  UnknownEvent,
} from "../core/events/schema";
import {
  createBattleLogDocument,
  createEventsCsv,
  createUnknownsCsv,
  parseBattleLogJson,
  serializeBattleLogDocument,
} from "./export";

const ocrMessage: OCRMessage = {
  id: "ocr_1",
  battleId: "battle_test",
  rawText: "ミミッキュの\nじゃれつく！",
  normalizedText: "ミミッキュのじゃれつく!",
  matchText: "ミミッキュのじゃれつく",
  ocrConfidence: 0.92,
  timestampMs: 1200,
  frameIndex: 4,
  roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
  lines: [],
};

const battleEvent: BattleEvent = {
  id: "evt_1",
  battleId: "battle_test",
  turn: null,
  timestampMs: 1200,
  type: "move",
  actor: { name: "ミミッキュ", side: "player" },
  move: "じゃれつく",
  target: null,
  rawText: ocrMessage.rawText,
  normalizedText: ocrMessage.normalizedText,
  confidence: 0.96,
  classification: {
    method: "seed_rule",
    templateId: "attack_actor_move",
    alternatives: [],
  },
  source: {
    frameIndex: 4,
    timestampMs: 1200,
    cropObjectUrl: null,
  },
};

const unknownEvent: UnknownEvent = {
  id: "unk_1",
  battleId: "battle_test",
  timestampMs: 1800,
  afterEventId: "evt_1",
  rawText: "まだ分類できない",
  normalizedText: "まだ分類できない",
  ocrConfidence: 0.61,
  candidateMatches: ["candidate:a"],
  sourceFrameRef: "frame:5:1800",
  reviewStatus: "reviewed",
};

const sampleDiagnostic: FrameSampleDiagnostic = {
  id: "sample_diag_1",
  battleId: "battle_test",
  frameIndex: 4,
  timestampMs: 1200,
  stage: "skippedBusy",
  detail: "pending OCR jobs 1",
  preprocessVariantId: "default",
  preprocessRejectReason: null,
  ocrVariantId: "default",
  ocrForegroundPixelRatio: 0.032,
  pendingOcrJobs: 1,
  ocrJobId: null,
  ocrConfidence: null,
  lineCount: null,
};

describe("battle log export", () => {
  it("builds a schema-versioned document with durable manual corrections", () => {
    const document = createBattleLogDocument(
      {
        battleId: "battle_test",
        title: "Test battle",
        startedAt: null,
        media: {
          sourceKind: "video-file",
          videoLabel: "clip.mp4",
          audioLabel: "音声なし",
          width: 1280,
          height: 720,
          frameRate: null,
        },
        roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
        roiName: "Battle message ROI",
        ocrMessages: [ocrMessage],
        events: [battleEvent],
        unknowns: [unknownEvent],
        frameEvidence: [
          {
            id: "frame_1",
            battleId: "battle_test",
            sourceFrameRef: "frame:5:1800",
            rawDataUrl: "data:image/png;base64,raw",
            processedDataUrl: "data:image/png;base64,processed",
            cropWidth: 640,
            cropHeight: 120,
            capturedAt: "12:00:00",
          },
        ],
        sampleDiagnostics: [sampleDiagnostic],
        reviewNotes: { unk_1: "あとでrule化" },
      },
      new Date("2026-06-30T00:00:00.000Z"),
    );

    expect(document.exportedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(document.media.sourceKind).toBe("video-file");
    expect(document.frameEvidence).toHaveLength(1);
    expect(document.sampleDiagnostics).toEqual([sampleDiagnostic]);
    expect(document.manualCorrections).toEqual([
      {
        id: "cor_unk_1",
        battleId: "battle_test",
        targetType: "unknown",
        targetId: "unk_1",
        note: "あとでrule化",
        reviewStatus: "reviewed",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ]);
  });

  it("round-trips valid JSON and rejects unsupported documents", () => {
    const document = createBattleLogDocument(
      {
        battleId: "battle_test",
        title: "Test battle",
        startedAt: null,
        media: {
          sourceKind: "none",
          videoLabel: null,
          audioLabel: null,
          width: null,
          height: null,
          frameRate: null,
        },
        roi: { x: 0, y: 0, w: 1, h: 1 },
        roiName: "Battle message ROI",
        ocrMessages: [],
        events: [],
        unknowns: [],
        frameEvidence: [],
        sampleDiagnostics: [sampleDiagnostic],
        reviewNotes: {},
      },
      new Date("2026-06-30T00:00:00.000Z"),
    );

    expect(parseBattleLogJson(serializeBattleLogDocument(document))).toMatchObject({
      ok: true,
      document: {
        battle: { id: "battle_test" },
        sampleDiagnostics: [{ stage: "skippedBusy", pendingOcrJobs: 1 }],
      },
    });
    expect(parseBattleLogJson("{")).toEqual({ ok: false, error: "JSONとして読めません。" });
    expect(parseBattleLogJson(JSON.stringify({ schemaVersion: "9.9.9" }))).toEqual({
      ok: false,
      error: "対応していないBattle Log形式です。",
    });
  });

  it("imports older JSON without sample diagnostics as an empty diagnostic list", () => {
    const document = createBattleLogDocument(
      {
        battleId: "battle_test",
        title: "Test battle",
        startedAt: null,
        media: {
          sourceKind: "none",
          videoLabel: null,
          audioLabel: null,
          width: null,
          height: null,
          frameRate: null,
        },
        roi: { x: 0, y: 0, w: 1, h: 1 },
        roiName: "Battle message ROI",
        ocrMessages: [],
        events: [],
        unknowns: [],
        frameEvidence: [],
        reviewNotes: {},
      },
      new Date("2026-06-30T00:00:00.000Z"),
    );
    const olderDocument = { ...document } as Partial<typeof document>;
    delete olderDocument.sampleDiagnostics;

    const result = parseBattleLogJson(JSON.stringify(olderDocument));

    expect(result).toMatchObject({
      ok: true,
      document: { sampleDiagnostics: [] },
      warnings: ["sample diagnosticsがないためサンプラー診断なしで読み込みます。"],
    });
  });

  it("exports event and unknown rows as escaped CSV", () => {
    const eventsCsv = createEventsCsv([battleEvent]);
    const unknownsCsv = createUnknownsCsv([unknownEvent], [
      {
        id: "cor_unk_1",
        battleId: "battle_test",
        targetType: "unknown",
        targetId: "unk_1",
        note: "候補,確認",
        reviewStatus: "reviewed",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ]);

    expect(eventsCsv).toContain("id,battleId,timestampMs,type");
    expect(eventsCsv).toContain("\"ミミッキュの\nじゃれつく！\"");
    expect(unknownsCsv).toContain("unk_1,battle_test,1800,reviewed");
    expect(unknownsCsv).toContain("\"候補,確認\"");
  });

  it("exports simultaneous switch-in events with stable ids and shared source text", () => {
    const firstSwitch: BattleEvent = {
      ...battleEvent,
      id: "evt_ocr-double_1",
      timestampMs: 1400,
      type: "switch_in",
      actor: { name: "エルフーン", side: null },
      move: null,
      rawText: "ゆけっ! エルフーン!\nマフォクシー!",
      normalizedText: "ゆけっ! エルフーン!マフォクシー!",
      classification: {
        method: "template_dictionary",
        templateId: "switch_in_double_call",
        alternatives: [],
      },
      source: { frameIndex: 8, timestampMs: 1400, cropObjectUrl: null },
    };
    const secondSwitch: BattleEvent = {
      ...firstSwitch,
      id: "evt_ocr-double_2",
      actor: { name: "マフォクシー", side: null },
    };
    const eventsCsv = createEventsCsv([secondSwitch, firstSwitch]);
    const firstIndex = eventsCsv.indexOf("evt_ocr-double_1");
    const secondIndex = eventsCsv.indexOf("evt_ocr-double_2");

    expect(firstIndex).toBeGreaterThan(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(eventsCsv).toContain("\"ゆけっ! エルフーン!\nマフォクシー!\"");
    expect(
      eventsCsv
        .split("\n")
        .filter((row) => row.includes(",switch_in,")),
    ).toHaveLength(2);
  });
});
