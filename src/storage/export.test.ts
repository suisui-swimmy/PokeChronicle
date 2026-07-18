import { describe, expect, it } from "vitest";
import type {
  BattleEvent,
  FrameSampleDiagnostic,
  MessageObservation,
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
  observationId: "msg_obs_1",
  rawText: "ミミッキュの\nじゃれつく！",
  normalizedText: "ミミッキュのじゃれつく!",
  matchText: "ミミッキュのじゃれつく",
  ocrConfidence: 0.92,
  timestampMs: 1200,
  frameIndex: 4,
  roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
  lines: [],
  recognitionCandidates: [
    {
      id: "primary",
      variantId: "white/top-2-lines",
      strategy: "block",
      pageSegModes: ["single_block"],
      rawText: "ミミッキュの\nじゃれつく！",
      confidence: 0.92,
      lineCount: 2,
      parseStatus: "event",
      eventSignatures: ["move|player|ミミッキュ|じゃれつく|unknown|"],
      score: 150,
      selected: true,
      selectionReason: "strong-event-selected",
      durationMs: 240,
    },
  ],
};

const battleEvent: BattleEvent = {
  id: "evt_1",
  battleId: "battle_test",
  observationId: "msg_obs_1",
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

const messageObservation: MessageObservation = {
  id: "msg_obs_1",
  battleId: "battle_test",
  openedAtMs: 1100,
  closedAtMs: 1500,
  frameStart: 3,
  frameEnd: 5,
  lifecycle: "closed",
  resolution: "resolved",
  visualFingerprint: {
    columns: 2,
    rows: 2,
    cells: [4, 4, 0, 0],
    foregroundPixelRatio: 0.08,
  },
  maxPresenceScore: 0.82,
  bestFrameIndex: 4,
  bestEvidenceRef: "frame:4:1200",
  ocrAttemptCount: 1,
  ocrMessageIds: ["ocr_1"],
  eventIds: ["evt_1"],
  unknownEventIds: [],
  failureReason: null,
  openedWhileOcrBusy: true,
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
        opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
        opponentHudRoiName: "Opponent battle HUD ROI",
        playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
        playerHudRoiName: "Player battle HUD ROI",
        vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
        vsRoiName: "VS splash ROI",
        ocrMessages: [ocrMessage],
        events: [battleEvent],
        unknowns: [unknownEvent],
        messageObservations: [messageObservation],
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
        phaseDetectionSummary: {
          opponentHud: { sampleCount: 10, visibleCount: 6, scoreTotal: 5.4, maxScore: 0.8 },
          playerHud: { sampleCount: 10, visibleCount: 5, scoreTotal: 4.9, maxScore: 0.76 },
          vsSplash: { sampleCount: 3, visibleCount: 2, scoreTotal: 1.8, maxScore: 0.72 },
          transitionCounts: {
            battleHudRose: 1,
            battleHudFell: 1,
            vsFell: 1,
            messagePhaseOpened: 2,
            messagePhaseClosed: 1,
          },
        },
        phaseTransitions: Array.from({ length: 70 }, (_, index) => ({
          id: `phase_transition_${index + 1}`,
          frameIndex: index + 1,
          timestampMs: index,
          stage: "battleHudFell" as const,
          detail: `score ${index}%`,
        })),
        reviewNotes: { unk_1: "あとでrule化" },
      },
      new Date("2026-06-30T00:00:00.000Z"),
    );

    expect(document.exportedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(document.media.sourceKind).toBe("video-file");
    expect(document.frameEvidence).toHaveLength(1);
    expect(document.phaseHudRoiProfile.roi).toEqual({ x: 0.55, y: 0.03, w: 0.43, h: 0.14 });
    expect(document.playerHudRoiProfile.roi).toEqual({ x: 0.02, y: 0.84, w: 0.46, h: 0.14 });
    expect(document.vsSplashRoiProfile.roi).toEqual({ x: 0.34, y: 0.32, w: 0.32, h: 0.32 });
    expect(document.waitIndicatorRoiProfile).toBeUndefined();
    expect(document.sampleDiagnostics).toEqual([sampleDiagnostic]);
    expect(document.messageObservations).toEqual([messageObservation]);
    expect(document.messageObservationSummary).toEqual({
      detectedCount: 1,
      resolvedCount: 1,
      ocrUnknownCount: 0,
      unreadCount: 0,
      openedWhileOcrBusyCount: 1,
    });
    expect(document.ocrMessages[0].recognitionCandidates?.[0]).toMatchObject({
      id: "primary",
      selected: true,
    });
    expect(document.ocrMessages[0].observationId).toBe("msg_obs_1");
    expect(document.events[0].observationId).toBe("msg_obs_1");
    expect(document.phaseDetectionSummary.opponentHud.sampleCount).toBe(10);
    expect(document.phaseTransitions).toHaveLength(64);
    expect(document.phaseTransitions[0]).toMatchObject({
      id: "phase_transition_7",
      timestampMs: 6,
    });
    expect(document.phaseTransitions.at(-1)).toMatchObject({
      id: "phase_transition_70",
      timestampMs: 69,
    });
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

  it("preserves session histories beyond the UI display limits in JSON and CSV", () => {
    const ocrMessages = Array.from({ length: 96 }, (_, index): OCRMessage => ({
      ...ocrMessage,
      id: `ocr_history_${index + 1}`,
      frameIndex: index + 1,
      timestampMs: index * 100,
    }));
    const events = Array.from({ length: 64 }, (_, index): BattleEvent => ({
      ...battleEvent,
      id: `evt_history_${index + 1}`,
      timestampMs: index * 100,
      source: {
        ...battleEvent.source,
        frameIndex: index + 1,
        timestampMs: index * 100,
      },
    }));
    const unknowns = Array.from({ length: 64 }, (_, index): UnknownEvent => ({
      ...unknownEvent,
      id: `unk_history_${index + 1}`,
      timestampMs: index * 100 + 50,
      sourceFrameRef: `frame:${index + 1}:${index * 100 + 50}`,
      reviewStatus: "unreviewed",
    }));
    const messageObservations = Array.from(
      { length: 64 },
      (_, index): MessageObservation => ({
        ...messageObservation,
        id: `msg_obs_history_${index + 1}`,
        openedAtMs: index * 100,
        closedAtMs: index * 100 + 80,
        frameStart: index + 1,
        frameEnd: index + 1,
        ocrMessageIds: [`ocr_history_${index + 1}`],
        eventIds: [`evt_history_${index + 1}`],
        openedWhileOcrBusy: index % 2 === 0,
      }),
    );
    const document = createBattleLogDocument({
      battleId: "battle_history",
      title: "History battle",
      startedAt: null,
      media: {
        sourceKind: "none",
        videoLabel: null,
        audioLabel: null,
        width: null,
        height: null,
        frameRate: null,
      },
      roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
      roiName: "Battle message ROI",
      opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      opponentHudRoiName: "Opponent battle HUD ROI",
      playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
      playerHudRoiName: "Player battle HUD ROI",
      vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
      vsRoiName: "VS splash ROI",
      ocrMessages,
      events,
      unknowns,
      messageObservations,
      frameEvidence: [],
      reviewNotes: {},
    });
    const parsed = parseBattleLogJson(serializeBattleLogDocument(document));
    const eventsCsv = createEventsCsv(document.events);
    const unknownsCsv = createUnknownsCsv(document.unknowns);

    expect(document.ocrMessages).toHaveLength(96);
    expect(document.events).toHaveLength(64);
    expect(document.unknowns).toHaveLength(64);
    expect(document.messageObservations).toHaveLength(64);
    expect(document.messageObservationSummary.openedWhileOcrBusyCount).toBe(32);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.document.ocrMessages).toHaveLength(96);
    expect(parsed.document.ocrMessages.some((message) => message.id === "ocr_history_96")).toBe(
      true,
    );
    expect(parsed.document.events).toHaveLength(64);
    expect(parsed.document.events.some((event) => event.id === "evt_history_64")).toBe(true);
    expect(parsed.document.unknowns).toHaveLength(64);
    expect(parsed.document.unknowns.some((unknown) => unknown.id === "unk_history_64")).toBe(
      true,
    );
    expect(parsed.document.messageObservations).toHaveLength(64);
    expect(
      parsed.document.messageObservations.some(
        (observation) => observation.id === "msg_obs_history_64",
      ),
    ).toBe(true);
    expect(eventsCsv.match(/evt_history_/g)).toHaveLength(64);
    expect(unknownsCsv.match(/unk_history_/g)).toHaveLength(64);
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
        opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
        opponentHudRoiName: "Opponent battle HUD ROI",
        playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
        playerHudRoiName: "Player battle HUD ROI",
        vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
        vsRoiName: "VS splash ROI",
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
        opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
        opponentHudRoiName: "Opponent battle HUD ROI",
        playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
        playerHudRoiName: "Player battle HUD ROI",
        vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
        vsRoiName: "VS splash ROI",
        ocrMessages: [ocrMessage],
        events: [],
        unknowns: [],
        frameEvidence: [],
        reviewNotes: {},
      },
      new Date("2026-06-30T00:00:00.000Z"),
    );
    const olderDocument = structuredClone(document) as Partial<typeof document>;
    delete olderDocument.ocrMessages?.[0]?.recognitionCandidates;
    delete olderDocument.messageObservations;
    delete olderDocument.messageObservationSummary;
    delete olderDocument.sampleDiagnostics;
    delete olderDocument.phaseDetectionSummary;
    delete olderDocument.phaseTransitions;

    const result = parseBattleLogJson(JSON.stringify(olderDocument));

    expect(result).toMatchObject({
      ok: true,
      document: {
        messageObservations: [],
        messageObservationSummary: {
          detectedCount: 0,
          resolvedCount: 0,
          ocrUnknownCount: 0,
          unreadCount: 0,
          openedWhileOcrBusyCount: 0,
        },
        sampleDiagnostics: [],
        phaseDetectionSummary: { opponentHud: { sampleCount: 0 } },
        phaseTransitions: [],
        phaseHudRoiProfile: { roi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 } },
        playerHudRoiProfile: { roi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 } },
        vsSplashRoiProfile: { roi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 } },
      },
      warnings: [
        "message observationsがないため検出履歴なしで読み込みます。",
        "message observation summaryがないため観測履歴から再集計します。",
        "sample diagnosticsがないためサンプラー診断なしで読み込みます。",
        "phase detection summaryがないため空集計として扱います。",
        "phase transitionsがないため遷移履歴なしで読み込みます。",
      ],
    });
    if (result.ok) {
      expect(result.document.ocrMessages[0].recognitionCandidates).toBeUndefined();
    }
  });

  it("backfills the durable OCR-busy flag and recomputes observation summary", () => {
    const document = createBattleLogDocument({
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
      opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      opponentHudRoiName: "Opponent battle HUD ROI",
      playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
      playerHudRoiName: "Player battle HUD ROI",
      vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
      vsRoiName: "VS splash ROI",
      ocrMessages: [],
      events: [],
      unknowns: [],
      messageObservations: [messageObservation],
      frameEvidence: [],
      reviewNotes: {},
    });
    const olderDocument = structuredClone(document) as unknown as Record<string, unknown>;
    const [olderObservation] = olderDocument.messageObservations as Array<
      Partial<MessageObservation>
    >;
    delete olderObservation.openedWhileOcrBusy;
    delete olderDocument.messageObservationSummary;

    const result = parseBattleLogJson(JSON.stringify(olderDocument));

    expect(result).toMatchObject({
      ok: true,
      document: {
        messageObservations: [{ id: "msg_obs_1", openedWhileOcrBusy: false }],
        messageObservationSummary: {
          detectedCount: 1,
          resolvedCount: 1,
          openedWhileOcrBusyCount: 0,
        },
      },
      warnings: ["message observation summaryがないため観測履歴から再集計します。"],
    });
  });

  it("imports legacy JSON with or without wait ROI profiles", () => {
    const legacyBase = {
      schemaVersion: "0.1.0",
      appVersion: "0.1.0",
      exportedAt: "2026-06-30T00:00:00.000Z",
      battle: { id: "battle_test", title: "Legacy battle", startedAt: null },
      media: {
        sourceKind: "none",
        videoLabel: null,
        audioLabel: null,
        width: null,
        height: null,
        frameRate: null,
      },
      roiProfile: {
        id: "roi_live_message",
        name: "Battle message ROI",
        roi: { x: 0, y: 0, w: 1, h: 1 },
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
      ocrMessages: [],
      events: [],
      unknowns: [],
      frameEvidence: [],
      sampleDiagnostics: [
        {
          ...sampleDiagnostic,
          stage: "waitSampled",
          imageSignal: {
            kind: "wait_indicator",
            roi: { x: 0.42, y: 0.18, w: 0.18, h: 0.16 },
            score: 0.8,
            isVisible: true,
            yellowIconScore: 0.7,
            whiteTextScore: 0.6,
            contrastScore: 0.5,
            yellowPixelRatio: 0.02,
            whitePixelRatio: 0.03,
            whiteRowBandScore: 0.6,
          },
        },
      ],
      manualCorrections: [],
    };
    const withWait = {
      ...legacyBase,
      waitIndicatorRoiProfile: {
        id: "roi_wait_indicator",
        name: "Legacy wait ROI",
        roi: { x: 0.42, y: 0.18, w: 0.18, h: 0.16 },
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    };

    expect(parseBattleLogJson(JSON.stringify(legacyBase))).toMatchObject({
      ok: true,
      document: {
        phaseHudRoiProfile: { roi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 } },
        sampleDiagnostics: [{ stage: "waitSampled" }],
      },
    });
    expect(parseBattleLogJson(JSON.stringify(withWait))).toMatchObject({
      ok: true,
      document: {
        waitIndicatorRoiProfile: { roi: { x: 0.42, y: 0.18, w: 0.18, h: 0.16 } },
        sampleDiagnostics: [{ stage: "waitSampled" }],
      },
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
