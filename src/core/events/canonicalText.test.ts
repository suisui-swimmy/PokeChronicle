import { describe, expect, it } from "vitest";
import type { BattleEvent } from "./schema";
import { renderBattleEventCanonicalText } from "./canonicalText";

function event(overrides: Partial<BattleEvent>): BattleEvent {
  return {
    id: "evt_test",
    battleId: "battle_test",
    turn: null,
    timestampMs: 0,
    type: "move",
    actor: { name: null, side: null },
    move: null,
    target: null,
    rawText: "",
    normalizedText: "",
    confidence: null,
    classification: { method: "seed_rule", templateId: null, alternatives: [] },
    source: { frameIndex: null, timestampMs: 0, cropObjectUrl: null },
    ...overrides,
  };
}

describe("renderBattleEventCanonicalText", () => {
  it("renders canonical text for user-facing battle events", () => {
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "move",
          actor: { name: "イダイトウ", side: "opponent" },
          move: "アクアジェット",
        }),
      ),
    ).toBe("相手の イダイトウの アクアジェット!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "switch_in", actor: { name: "ガブリアス", side: null } }),
      ),
    ).toBe("ゆけっ! ガブリアス!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "switch_out", actor: { name: "マフォクシー", side: null } }),
      ),
    ).toBe("マフォクシー 戻れ!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "protect",
          actor: { name: "マフォクシー", side: null },
          classification: {
            method: "seed_rule",
            templateId: "protect_block",
            alternatives: [],
          },
        }),
      ),
    ).toBe("マフォクシーは 攻撃から 身を守った!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "protect",
          actor: { name: "マフォクシー", side: null },
          classification: {
            method: "seed_rule",
            templateId: "protect_stance",
            alternatives: [],
          },
        }),
      ),
    ).toBe("マフォクシーは 守りの 体勢に 入った!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "supereffective",
          target: { name: "マフォクシー", side: null },
        }),
      ),
    ).toBe("マフォクシーに 効果は バツグンだ!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "faint", actor: { name: "エルフーン", side: null } }),
      ),
    ).toBe("エルフーンは たおれた!");
  });
});
