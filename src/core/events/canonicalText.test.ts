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
          type: "protect",
          actor: { name: "ドヒドイデ", side: "opponent" },
          normalizedText: "相手の ドヒドイデは ワイドガードで 守られた!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_protect_zhkg73",
            alternatives: [],
          },
        }),
      ),
    ).toBe("相手の ドヒドイデは ワイドガードで 守られた!");
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
        event({
          type: "supereffective",
          target: { name: "サザンドラ", side: "opponent" },
          normalizedText: "相手の サザンドラに 効果は ちよょうバツグンだ!!",
        }),
      ),
    ).toBe("相手の サザンドラに 効果は ちょうバツグンだ!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "faint", actor: { name: "エルフーン", side: null } }),
      ),
    ).toBe("エルフーンは たおれた!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "miss",
          target: { name: "エルフーン", side: "opponent" },
        }),
      ),
    ).toBe("相手の エルフーンには 当たらなかった!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "redirection", actor: { name: "ヤバソチャ", side: null } }),
      ),
    ).toBe("ヤバソチャは 注目の的に なった!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "flinch", actor: { name: "ガメノデス", side: "opponent" } }),
      ),
    ).toBe("相手の ガメノデスは ひるんで 技が だせない!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "item",
          actor: { name: "ガメノデス", side: "opponent" },
          classification: {
            method: "template_dictionary",
            templateId: "champout_item_1s665oh",
            alternatives: ["template:champout_item_1s665oh:text=せんせいのツメ"],
          },
        }),
      ),
    ).toBe("相手の ガメノデスは せんせいのツメで 行動が はやくなった!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "item",
          actor: { name: "エルフーン", side: null },
          normalizedText: "エルフーンは きあいのタスキで もちこたえた!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_item_cckg8l",
            alternatives: ["template:champout_item_cckg8l:text=きあいのタスキ"],
          },
        }),
      ),
    ).toBe("エルフーンは きあいのタスキで もちこたえた!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "activate",
          actor: { name: "バンギラス", side: "opponent" },
          normalizedText: "相手の バンギラスは メガバンギラスに メガシンカした!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_activate_5yixin",
            alternatives: ["template:champout_activate_5yixin:text=バンギラス"],
          },
        }),
      ),
    ).toBe("相手の バンギラスは メガバンギラスに メガシンカした!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "activate",
          actor: { name: "マフォクシー", side: null },
          normalizedText: "マフォクシーは メカ力マフォクシーに メガシンカした!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_activate_1a20jv9",
            alternatives: ["template:champout_activate_1a20jv9:text=カ力マフォクシー"],
          },
        }),
      ),
    ).toBe("マフォクシーは メガマフォクシーに メガシンカした!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "activate",
          actor: { name: "リザードン", side: "opponent" },
          normalizedText: "相手の リザードンは メカカリザートンに メガシンカした!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_activate_1a20jv9",
            alternatives: ["template:champout_activate_1a20jv9:text=カカリザートン"],
          },
        }),
      ),
    ).toBe("相手の リザードンは メガシンカした!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "activate",
          actor: { name: "リザードン", side: "opponent" },
          normalizedText: "相手の リザードンは メガリザードンYに メガシンカした!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_activate_1a20jv9",
            alternatives: ["template:champout_activate_1a20jv9:text=リザードンY"],
          },
        }),
      ),
    ).toBe("相手の リザードンは メガリザードンYに メガシンカした!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "activate",
          actor: { name: "ヤバソチャ", side: null },
          target: { name: "メタグロス", side: null },
          normalizedText: "ヤバソチャが たてた お茶を メタグロスは 飲みほした!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_activate_1gp6nis",
            alternatives: [],
          },
        }),
      ),
    ).toBe("ヤバソチャが たてた お茶を メタグロスは 飲みほした!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "weather_start",
          normalizedText: "砂あらしが 吹き始めた!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_weather_start_19zhw7i",
            alternatives: [],
          },
        }),
      ),
    ).toBe("砂あらしが 吹き始めた!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "weather_start",
          normalizedText: "雨が 降り始めた!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_weather_start_1clktbb",
            alternatives: [],
          },
        }),
      ),
    ).toBe("雨が 降り始めた!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "fail", target: { name: "ヤバソチャ", side: null } }),
      ),
    ).toBe("しかし ヤバソチャには うまく 決まらなかった!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "damage",
          target: { name: "ニンフィア", side: null },
          normalizedText: "ニンフィアは 毒の ダメージを受けた!",
        }),
      ),
    ).toBe("ニンフィアは 毒の ダメージを 受けた!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "fail",
          actor: { name: "ニンフィア", side: null },
          normalizedText: "ニンフィアは 攻撃の 反動で 動けない!",
        }),
      ),
    ).toBe("ニンフィアは 攻撃の 反動で 動けない!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "side_start",
          actor: { name: null, side: "opponent" },
          normalizedText: "用手に 追い風か 吹き始めた!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_side_start_13nk4c5",
            alternatives: [],
          },
        }),
      ),
    ).toBe("相手に 追い風が 吹き始めた!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "side_end",
          normalizedText: "味方の 追い風が 止んだ!",
        }),
      ),
    ).toBe("味方の 追い風が 止んだ!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "battle_end",
          normalizedText: "降参か 選ばれました",
          classification: {
            method: "seed_rule",
            templateId: "battle_end_surrender",
            alternatives: [],
          },
        }),
      ),
    ).toBe("降参が 選ばれました!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "battle_end",
          normalizedText: "勝負に 口けた",
          classification: {
            method: "seed_rule",
            templateId: "battle_end_loss",
            alternatives: [],
          },
        }),
      ),
    ).toBe("勝負に 負けた!");
  });

  it("renders stat-aware rank changes and falls back when stat evidence is missing", () => {
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "boost",
          actor: { name: "ガブリアス", side: null },
          normalizedText: "ガブリアスの 攻撃が ぐーんと 上がった!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_boost_test",
            alternatives: ["constrained:champout_boost_test:stat:攻撃->攻撃:accepted:1.00"],
          },
        }),
      ),
    ).toBe("ガブリアスの 攻撃が ぐーんと 上がった!");
    expect(
      renderBattleEventCanonicalText(
        event({
          type: "unboost",
          actor: { name: "ランドロス", side: "opponent" },
          normalizedText: "相手の ランドロスの 特攻が がくっと 下がった!",
          classification: {
            method: "template_dictionary",
            templateId: "champout_unboost_test",
            alternatives: ["constrained:champout_unboost_test:stat:特攻->特攻:accepted:1.00"],
          },
        }),
      ),
    ).toBe("相手の ランドロスの 特攻が がくっと 下がった!");
    expect(
      renderBattleEventCanonicalText(
        event({ type: "boost", actor: { name: "ガメノデス", side: "opponent" } }),
      ),
    ).toBe("相手の ガメノデスの 能力が 上がった!");
    expect(renderBattleEventCanonicalText(event({ type: "unboost" }))).toBe("能力が 下がった!");
  });
});
