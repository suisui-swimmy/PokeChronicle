import { describe, expect, it } from "vitest";
import type { BattleEvent, UnknownEvent } from "../events/schema";
import { summarizeBattleStats } from "./battleStats";

function createEvent(overrides: Partial<BattleEvent>): BattleEvent {
  return {
    id: overrides.id ?? "evt_test",
    battleId: "battle_test",
    turn: null,
    timestampMs: overrides.timestampMs ?? 1000,
    type: overrides.type ?? "move",
    actor: overrides.actor ?? { name: "ガブリアス", side: "player" },
    move: overrides.move ?? null,
    target: overrides.target ?? null,
    rawText: overrides.rawText ?? "raw",
    normalizedText: overrides.normalizedText ?? "normalized",
    confidence: overrides.confidence ?? 0.9,
    classification: overrides.classification ?? {
      method: "seed_rule",
      templateId: null,
      alternatives: [],
    },
    source: overrides.source ?? {
      frameIndex: 1,
      timestampMs: overrides.timestampMs ?? 1000,
      cropObjectUrl: null,
    },
  };
}

function createUnknown(overrides: Partial<UnknownEvent> = {}): UnknownEvent {
  return {
    id: overrides.id ?? "unk_test",
    battleId: "battle_test",
    timestampMs: overrides.timestampMs ?? 2000,
    afterEventId: null,
    rawText: "まだ分類できない",
    normalizedText: "まだ分類できない",
    ocrConfidence: 0.7,
    candidateMatches: [],
    sourceFrameRef: "frame:1:2000",
    reviewStatus: "unreviewed",
    ...overrides,
  };
}

describe("summarizeBattleStats", () => {
  it("counts MVP battle-log statistics from resolved events and unknowns", () => {
    const summary = summarizeBattleStats(
      [
        createEvent({
          id: "evt_move_1",
          type: "move",
          actor: { name: "ガブリアス", side: "player" },
          move: "じしん",
        }),
        createEvent({
          id: "evt_move_2",
          type: "move",
          actor: { name: "相手イダイトウ", side: "opponent" },
          move: "アクアジェット",
        }),
        createEvent({
          id: "evt_switch_out",
          type: "switch_out",
          actor: { name: "ガブリアス", side: "player" },
        }),
        createEvent({
          id: "evt_switch_in",
          type: "switch_in",
          actor: { name: "エルフーン", side: "player" },
        }),
        createEvent({
          id: "evt_faint",
          type: "faint",
          actor: { name: "相手イダイトウ", side: "opponent" },
        }),
        createEvent({ id: "evt_super", type: "supereffective" }),
        createEvent({ id: "evt_resisted", type: "resisted" }),
        createEvent({ id: "evt_immune", type: "immune" }),
        createEvent({ id: "evt_critical", type: "critical" }),
        createEvent({
          id: "evt_protect_without_actor",
          type: "protect",
          actor: { name: null, side: null },
        }),
      ],
      [createUnknown({ id: "unk_1" }), createUnknown({ id: "unk_2" })],
    );

    expect(summary).toMatchObject({
      totalResolvedEventCount: 10,
      totalClassifiedItemCount: 12,
      observedMoveCount: 2,
      pokemonActionCount: 4,
      switchCount: 2,
      faintCount: 1,
      unknownMessageCount: 2,
      criticalCount: 1,
      effectiveness: {
        supereffective: 1,
        resisted: 1,
        immune: 1,
        total: 3,
      },
    });
    expect(summary.unknownRate).toBeCloseTo(2 / 12);
    expect(summary.pokemonActionCounts[0]).toEqual({
      key: "player:ガブリアス",
      name: "ガブリアス",
      side: "player",
      count: 2,
    });
    expect(summary.pokemonActionCounts).toEqual(
      expect.arrayContaining([
        { key: "opponent:相手イダイトウ", name: "相手イダイトウ", side: "opponent", count: 1 },
        { key: "player:エルフーン", name: "エルフーン", side: "player", count: 1 },
      ]),
    );
  });

  it("returns zeroed statistics for an empty battle log", () => {
    expect(summarizeBattleStats([], [])).toMatchObject({
      totalResolvedEventCount: 0,
      totalClassifiedItemCount: 0,
      observedMoveCount: 0,
      pokemonActionCount: 0,
      switchCount: 0,
      faintCount: 0,
      unknownMessageCount: 0,
      unknownRate: 0,
      criticalCount: 0,
      effectiveness: {
        supereffective: 0,
        resisted: 0,
        immune: 0,
        total: 0,
      },
      pokemonActionCounts: [],
    });
  });

  it("counts simultaneous switch-in events independently", () => {
    const summary = summarizeBattleStats(
      [
        createEvent({
          id: "evt_ocr-double_1",
          type: "switch_in",
          actor: { name: "エルフーン", side: "player" },
          timestampMs: 1400,
        }),
        createEvent({
          id: "evt_ocr-double_2",
          type: "switch_in",
          actor: { name: "マフォクシー", side: "player" },
          timestampMs: 1400,
        }),
      ],
      [],
    );

    expect(summary).toMatchObject({
      totalResolvedEventCount: 2,
      pokemonActionCount: 2,
      switchCount: 2,
    });
    expect(summary.pokemonActionCounts).toEqual(
      expect.arrayContaining([
        { key: "player:エルフーン", name: "エルフーン", side: "player", count: 1 },
        { key: "player:マフォクシー", name: "マフォクシー", side: "player", count: 1 },
      ]),
    );
  });
});
