import { describe, expect, it } from "vitest";
import type {
  BattleEvent,
  MessageObservation,
  OCRMessage,
} from "./schema";
import {
  decideObservationMerge,
  mergeMessageObservationPair,
  selectPrimaryLiveLogItems,
} from "./observationMerge";

const fingerprint = {
  columns: 4,
  rows: 2,
  cells: [8, 7, 6, 0, 0, 0, 0, 0],
  foregroundPixelRatio: 0.08,
};

function createObservation(
  id: string,
  options: Partial<MessageObservation> = {},
): MessageObservation {
  return {
    id,
    battleId: "battle_test",
    openedAtMs: 1_000,
    closedAtMs: 1_200,
    frameStart: 10,
    frameEnd: 12,
    lifecycle: "closed",
    resolution: "unread",
    visualFingerprint: {
      ...fingerprint,
      cells: [...fingerprint.cells],
    },
    maxPresenceScore: 0.7,
    bestFrameIndex: 11,
    bestEvidenceRef: `frame:${id}`,
    ocrAttemptCount: 1,
    ocrMessageIds: [],
    eventIds: [],
    unknownEventIds: [],
    failureReason: "parser_unknown",
    openedWhileOcrBusy: false,
    disposition: "primary",
    suppressionReason: null,
    commitScore: 0.75,
    persistentUiOverlapRatio: 0.1,
    dynamicForegroundRatio: 0.8,
    unknownGateReason: null,
    mergedIntoObservationId: null,
    ...options,
  };
}

function createOcrMessage(
  id: string,
  observationId: string,
  text: string,
  timestampMs: number,
): OCRMessage {
  return {
    id,
    battleId: "battle_test",
    observationId,
    rawText: text,
    normalizedText: text,
    matchText: text,
    ocrConfidence: 0.62,
    timestampMs,
    frameIndex: Math.floor(timestampMs / 100),
    roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
    lines: [],
  };
}

function createMoveEvent(
  id: string,
  observationId: string,
  actor: string,
  move: string,
  timestampMs: number,
): BattleEvent {
  const text = `${actor}の ${move}！`;

  return {
    id,
    battleId: "battle_test",
    observationId,
    turn: null,
    timestampMs,
    type: "move",
    actor: { name: actor, side: null },
    move,
    target: null,
    rawText: text,
    normalizedText: text,
    confidence: 0.93,
    classification: {
      method: "seed_rule",
      templateId: "attack_actor_move",
      alternatives: [],
    },
    source: {
      frameIndex: Math.floor(timestampMs / 100),
      timestampMs,
      cropObjectUrl: null,
    },
  };
}

function createNearbyResolvedAndNoisyPair() {
  const event = createMoveEvent(
    "evt_resolved",
    "obs_resolved",
    "ガブリアス",
    "じしん",
    1_100,
  );
  const resolved = createObservation("obs_resolved", {
    resolution: "resolved",
    failureReason: null,
    eventIds: [event.id],
  });
  const noisyMessage = createOcrMessage(
    "ocr_noisy",
    "obs_noisy",
    "ガフリアスの じじん！",
    1_450,
  );
  const noisy = createObservation("obs_noisy", {
    openedAtMs: 1_350,
    closedAtMs: 1_550,
    frameStart: 13,
    frameEnd: 15,
    ocrMessageIds: [noisyMessage.id],
    maxPresenceScore: 0.82,
    bestFrameIndex: 14,
    bestEvidenceRef: "frame:obs_noisy",
  });

  return { event, resolved, noisyMessage, noisy };
}

describe("observation merge", () => {
  it("merges a nearby noisy observation into its resolved counterpart", () => {
    const { event, resolved, noisyMessage, noisy } =
      createNearbyResolvedAndNoisyPair();

    const decision = decideObservationMerge({
      candidate: noisy,
      observations: [resolved, noisy],
      ocrMessages: [noisyMessage],
      events: [event],
    });

    expect(decision).toMatchObject({
      merge: true,
      targetObservationId: resolved.id,
      secondaryObservationId: noisy.id,
    });
    expect(decision.score).toBeGreaterThanOrEqual(0.72);
    expect(decision.reasons).toContain("nearby");
  });

  it("keeps the merged secondary linked to the primary observation", () => {
    const { event, resolved, noisyMessage, noisy } =
      createNearbyResolvedAndNoisyPair();
    const merged = mergeMessageObservationPair(resolved, noisy);

    expect(merged.secondary).toMatchObject({
      disposition: "suppressed",
      suppressionReason: "merged_duplicate",
      mergedIntoObservationId: resolved.id,
    });
    expect(merged.target).toMatchObject({
      disposition: "primary",
      mergedIntoObservationId: null,
      eventIds: [event.id],
      ocrMessageIds: [noisyMessage.id],
      bestEvidenceRef: noisy.bestEvidenceRef,
    });
  });

  it("selects one live-log row for a merged observation pair", () => {
    const { event, resolved, noisy } = createNearbyResolvedAndNoisyPair();
    const merged = mergeMessageObservationPair(resolved, noisy);

    const items = selectPrimaryLiveLogItems({
      observations: [merged.target, merged.secondary],
      events: [event],
      limit: 48,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "observation",
      id: `observation:${resolved.id}`,
      observation: { id: resolved.id },
      events: [{ id: event.id }],
    });
  });

  it("does not merge a noisy observation that names a different actor and move", () => {
    const { event, resolved, noisy } = createNearbyResolvedAndNoisyPair();
    const differentMessage = createOcrMessage(
      "ocr_different",
      noisy.id,
      "サーフゴーの ゴールドラッシュ！",
      1_450,
    );
    const different = {
      ...noisy,
      ocrMessageIds: [differentMessage.id],
    };

    const decision = decideObservationMerge({
      candidate: different,
      observations: [resolved, different],
      ocrMessages: [differentMessage],
      events: [event],
    });

    expect(decision.merge).toBe(false);
  });

  it("does not merge a different move from the same actor", () => {
    const { event, resolved, noisy } = createNearbyResolvedAndNoisyPair();
    const differentMoveMessage = createOcrMessage(
      "ocr_same_actor_different_move",
      noisy.id,
      "ガブリアスの げきりん！",
      1_450,
    );
    const differentMove = {
      ...noisy,
      ocrMessageIds: [differentMoveMessage.id],
    };

    const decision = decideObservationMerge({
      candidate: differentMove,
      observations: [resolved, differentMove],
      ocrMessages: [differentMoveMessage],
      events: [event],
    });

    expect(decision.merge).toBe(false);
  });

  it("does not merge two resolved observations", () => {
    const { event, resolved } = createNearbyResolvedAndNoisyPair();
    const secondEvent = createMoveEvent(
      "evt_resolved_second",
      "obs_resolved_second",
      "ガブリアス",
      "じしん",
      1_450,
    );
    const secondResolved = createObservation("obs_resolved_second", {
      openedAtMs: 1_350,
      closedAtMs: 1_550,
      frameStart: 13,
      frameEnd: 15,
      resolution: "resolved",
      failureReason: null,
      eventIds: [secondEvent.id],
    });

    const decision = decideObservationMerge({
      candidate: secondResolved,
      observations: [resolved, secondResolved],
      ocrMessages: [],
      events: [event, secondEvent],
    });

    expect(decision.merge).toBe(false);
  });

  it("does not merge observations beyond the maximum time gap", () => {
    const { event, resolved, noisyMessage, noisy } =
      createNearbyResolvedAndNoisyPair();
    const lateMessage = {
      ...noisyMessage,
      timestampMs: 3_200,
      frameIndex: 32,
    };
    const late = {
      ...noisy,
      openedAtMs: 3_100,
      closedAtMs: 3_300,
      frameStart: 31,
      frameEnd: 33,
    };

    const decision = decideObservationMerge({
      candidate: late,
      observations: [resolved, late],
      ocrMessages: [lateMessage],
      events: [event],
    });

    expect(decision.merge).toBe(false);
  });

  it("does not merge across an intervening resolved observation", () => {
    const { event, resolved, noisyMessage, noisy } =
      createNearbyResolvedAndNoisyPair();
    const interveningEvent = createMoveEvent(
      "evt_intervening",
      "obs_intervening",
      "サーフゴー",
      "ゴールドラッシュ",
      1_300,
    );
    const intervening = createObservation("obs_intervening", {
      openedAtMs: 1_250,
      closedAtMs: 1_325,
      frameStart: 12,
      frameEnd: 13,
      resolution: "resolved",
      failureReason: null,
      eventIds: [interveningEvent.id],
    });

    const decision = decideObservationMerge({
      candidate: noisy,
      observations: [resolved, intervening, noisy],
      ocrMessages: [noisyMessage],
      events: [event, interveningEvent],
    });

    expect(decision.merge).toBe(false);
  });
});
