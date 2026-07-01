import { describe, expect, it } from "vitest";
import { parseBattleMessage } from "../parser/seedParser";
import {
  CHAMPOUT_TEMPLATE_RULES,
  CHAMPOUT_TEMPLATE_SOURCE,
  CHAMPOUT_TEMPLATE_STATS,
} from "./generatedChampoutTemplateRules";

describe("generated champout template rules", () => {
  it("loads a compact generated rule pack with source metadata", () => {
    expect(CHAMPOUT_TEMPLATE_SOURCE).toMatchObject({
      name: "projectpokemon/champout",
      license: "MIT",
      language: "jpn",
      sourceCommit: "d2885a864f041744df1de1b35f4ab3d2e52cf4db",
      files: ["btl_attack_syn.json", "btl_std.json"],
    });
    expect(CHAMPOUT_TEMPLATE_STATS).toMatchObject({
      sourceFileCount: 2,
      extractedTextCount: 117,
      generatedRuleCount: 85,
    });
    expect(CHAMPOUT_TEMPLATE_RULES.length).toBe(85);
    expect(CHAMPOUT_TEMPLATE_RULES[0].source).toMatchObject({
      fileName: "btl_attack_syn.json",
      keyPath: "mSDataSet[1].OriginalText",
      labelName: "ATKMSG_E_0001_syn",
      sourceCommit: "d2885a864f041744df1de1b35f4ab3d2e52cf4db",
    });
  });

  it("uses stable generated rule ids for known source labels", () => {
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_STD_AffSGood_syn",
      ),
    ).toMatchObject({
      id: "champout_supereffective_3kxdfm",
      eventType: "supereffective",
      patterns: ["効果は ちょうバツグンだ!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_STD_PP_Short",
      ),
    ).toMatchObject({
      id: "champout_fail_mr3t98",
      eventType: "fail",
    });
  });

  it("does not bundle obvious non-battle UI text into active rules", () => {
    const allPatterns = CHAMPOUT_TEMPLATE_RULES.flatMap((rule) => rule.patterns).join("\n");

    expect(allPatterns).not.toContain("プレミアムバトルパス");
    expect(allPatterns).not.toContain("チームを編成する");
    expect(allPatterns).not.toContain("ボタン");
  });

  it("feeds generated rules into the parser default template set", () => {
    expect(parseBattleMessage("効果は ちょうバツグンだ!!")).toMatchObject({
      status: "event",
      event: {
        type: "supereffective",
        classification: {
          method: "template_dictionary",
          templateId: "champout_supereffective_3kxdfm",
        },
      },
    });
    expect(parseBattleMessage("しかし 技の 残りポイントが なかった！")).toMatchObject({
      status: "event",
      event: {
        type: "fail",
        classification: {
          method: "template_dictionary",
          templateId: "champout_fail_mr3t98",
        },
      },
    });
    expect(parseBattleMessage("日差しが 元に戻った！")).toMatchObject({
      status: "event",
      event: {
        type: "weather_end",
        classification: {
          method: "template_dictionary",
          templateId: "champout_weather_end_15lqdy4",
        },
      },
    });
  });

  it("leaves unrelated UI text as unknown", () => {
    expect(parseBattleMessage("プレミアムバトルパス購入")).toMatchObject({
      status: "unknown",
    });
  });
});
