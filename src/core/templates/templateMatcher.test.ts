import { describe, expect, it } from "vitest";
import { BATTLE_DICTIONARY } from "../dictionary/generatedBattleDictionary";
import { SEED_TEMPLATE_RULES } from "./seedTemplateRules";
import { matchTemplateRules } from "./templateMatcher";
import type { BattleTemplateRule } from "./types";

describe("matchTemplateRules", () => {
  it("matches noisy HP loss text by anchoring on a pokemon span and fixed template text", () => {
    const result = matchTemplateRules(
      [
        {
          id: "full",
          matchText: "尼手のイダイトウは命が少し削られたーー9",
          priority: 0,
        },
      ],
      BATTLE_DICTIONARY,
      SEED_TEMPLATE_RULES,
    );

    expect(result).toMatchObject({
      rule: { id: "hp_loss_life_cost", eventType: "damage" },
      actor: { name: "イダイトウ", side: null },
      move: null,
    });
  });

  it("keeps opponent side when the opponent prefix is recognized exactly", () => {
    const result = matchTemplateRules(
      [
        {
          id: "full",
          matchText: "相手のイダイトウは命が少し削られた",
          priority: 0,
        },
      ],
      BATTLE_DICTIONARY,
      SEED_TEMPLATE_RULES,
    );

    expect(result).toMatchObject({
      rule: { id: "hp_loss_life_cost_opponent", eventType: "damage" },
      actor: { name: "イダイトウ", side: "opponent" },
    });
  });

  it("matches field context templates without requiring pokemon captures", () => {
    const result = matchTemplateRules(
      [{ id: "line:1", matchText: "エレキフィールドになった", priority: 1 }],
      BATTLE_DICTIONARY,
      SEED_TEMPLATE_RULES,
    );

    expect(result).toMatchObject({
      rule: { id: "terrain_start", eventType: "terrain_start" },
      actor: { name: null, side: null },
    });
  });

  it("supports bounded free text placeholders for ability-like templates", () => {
    const rules: readonly BattleTemplateRule[] = [
      {
        id: "ability_text_test",
        eventType: "ability",
        priority: 1,
        patterns: ["{pokemon}の特性{text}が発動した"],
      },
    ];
    const result = matchTemplateRules(
      [{ id: "full", matchText: "カラマネロの特性あまのじゃくが発動した", priority: 0 }],
      BATTLE_DICTIONARY,
      rules,
    );

    expect(result).toMatchObject({
      rule: { id: "ability_text_test", eventType: "ability" },
      actor: { name: "カラマネロ", side: null },
    });
    expect(result?.evidence).toContain("text=あまのじゃく");
  });
});
