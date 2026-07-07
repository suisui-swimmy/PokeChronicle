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
      configFile: "data/champout/champout-template-sources.ja.json",
      files: ["btl_attack_syn.json", "btl_std.json", "btl_set.json"],
    });
    expect(CHAMPOUT_TEMPLATE_STATS).toMatchObject({
      sourceFileCount: 3,
      extractedTextCount: 851,
      generatedRuleCount: 167,
      eventTypeDistribution: {
        activate: 4,
        boost: 11,
        damage: 5,
        fail: 14,
        flinch: 2,
        status: 14,
        status_cure: 28,
        faint: 2,
        immune: 2,
        item: 7,
        protect: 6,
        redirection: 2,
        supereffective: 4,
        unboost: 4,
        weather_end: 5,
        weather_start: 4,
      },
    });
    expect(CHAMPOUT_TEMPLATE_RULES.length).toBe(167);
    expect(CHAMPOUT_TEMPLATE_RULES[0].source).toMatchObject({
      fileName: "btl_attack_syn.json",
      keyPath: "mSDataSet[0].OriginalText",
      labelName: "ATKMSG_M_0001_syn",
      sourceCommit: "d2885a864f041744df1de1b35f4ab3d2e52cf4db",
    });
    expect(CHAMPOUT_TEMPLATE_STATS.perFile).toContainEqual(
      expect.objectContaining({
        fileName: "btl_set.json",
        reason:
          "narrow live battle resolution messages for status, stat rank, faint, flinch, item priority/endure, effectiveness, fail, protection, redirection, mega evolution, weather/poison damage, and tea effect",
        generatedRuleCount: 80,
        eventTypeDistribution: expect.objectContaining({
          boost: 4,
          damage: 4,
          fail: 6,
          item: 4,
          protect: 2,
          unboost: 4,
        }),
      }),
    );
  });

  it("uses stable generated rule ids for known source labels", () => {
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "ATKMSG_M_0001_syn",
      ),
    ).toMatchObject({
      id: "champout_move_1oj9w2v",
      eventType: "move",
      patterns: ["{pokemon}の{move}!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_STD_BackChange2",
      ),
    ).toMatchObject({
      id: "champout_switch_out_1n5e30m",
      eventType: "switch_out",
      patterns: ["{pokemon}戻れ!"],
    });
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
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_STD_ShineStart",
      ),
    ).toMatchObject({
      id: "champout_weather_start_17zypp5",
      eventType: "weather_start",
      patterns: ["日差しが 強くなった!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_STD_RainEnd",
      ),
    ).toMatchObject({
      id: "champout_weather_end_nslmzx",
      eventType: "weather_end",
      patterns: ["雨が 上がった!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_YakedoGet",
      ),
    ).toMatchObject({
      id: "champout_status_x7pe38",
      eventType: "status",
      patterns: ["{pokemon}はやけどを 負った!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_NoEffect",
      ),
    ).toMatchObject({
      id: "champout_immune_j84h1z",
      eventType: "immune",
      patterns: ["{target}には効果が ないようだ..."],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_AffGood_1",
      ),
    ).toMatchObject({
      id: "champout_supereffective_hqpe25",
      eventType: "supereffective",
      patterns: ["{target}に効果は バツグンだ!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_DokuDamage",
      ),
    ).toMatchObject({
      id: "champout_damage_10w2owf",
      eventType: "damage",
      patterns: ["{target}は毒の ダメージを受けた!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_WazaFailPoke",
      ),
    ).toMatchObject({
      id: "champout_fail_le5yfc",
      eventType: "fail",
      patterns: ["しかし {target}にはうまく 決まらなかった!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_WideGuard_E",
      ),
    ).toMatchObject({
      id: "champout_protect_zhkg73",
      eventType: "protect",
      patterns: ["相手の {pokemon}はワイドガードで 守られた!"],
      constants: { "actor.side": "opponent" },
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_CantAction",
      ),
    ).toMatchObject({
      id: "champout_fail_1hf9z25",
      eventType: "fail",
      patterns: ["{pokemon}は攻撃の 反動で 動けない!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_ShrinkExe_E",
      ),
    ).toMatchObject({
      id: "champout_flinch_1fbzyy3",
      eventType: "flinch",
      patterns: ["相手の {pokemon}はひるんで 技が だせない!"],
      constants: { "actor.side": "opponent" },
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_UseItem_PriorityUpOnce_E",
      ),
    ).toMatchObject({
      id: "champout_item_1s665oh",
      eventType: "item",
      patterns: ["相手の {pokemon}は {text}で行動が はやくなった!"],
      constants: { "actor.side": "opponent" },
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_KoraeItem",
      ),
    ).toMatchObject({
      id: "champout_item_cckg8l",
      eventType: "item",
      patterns: ["{pokemon}は{text}で もちこたえた!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_Konoyubi",
      ),
    ).toMatchObject({
      id: "champout_redirection_zp3lh",
      eventType: "redirection",
      patterns: ["{pokemon}は注目の的に なった!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_MegaEvo_E",
      ),
    ).toMatchObject({
      id: "champout_activate_5yixin",
      eventType: "activate",
      patterns: ["相手の {pokemon}はメガ{text}に メガシンカした!"],
      constants: { "actor.side": "opponent" },
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_WeatherDmg_Sand_E",
      ),
    ).toMatchObject({
      id: "champout_damage_1fu6qsj",
      eventType: "damage",
      patterns: ["砂あらしが相手の {target}を 襲う!"],
      constants: { "target.side": "opponent" },
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_MotenashiNoKokoro",
      ),
    ).toMatchObject({
      id: "champout_activate_1gp6nis",
      eventType: "activate",
      patterns: ["{pokemon}が たてた お茶を{target}は 飲みほした!"],
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_RankupLv2_1_E_syn",
      ),
    ).toMatchObject({
      id: "champout_boost_aog3mc",
      eventType: "boost",
      patterns: ["相手の {pokemon}の{stat}が ぐーんと上がった!"],
      constants: { "actor.side": "opponent" },
    });
    expect(
      CHAMPOUT_TEMPLATE_RULES.find(
        (rule) => rule.source?.labelName === "BTL_STRID_SET_RankdownLv2_1_P_syn",
      ),
    ).toMatchObject({
      id: "champout_unboost_1k5gaz2",
      eventType: "unboost",
      patterns: ["{pokemon}の{stat}が がくっと下がった!"],
    });
  });

  it("does not bundle obvious non-battle UI text into active rules", () => {
    const allPatterns = CHAMPOUT_TEMPLATE_RULES.flatMap((rule) => rule.patterns).join("\n");
    const labels = CHAMPOUT_TEMPLATE_RULES.map((rule) => rule.source?.labelName ?? "");

    expect(allPatterns).not.toContain("プレミアムバトルパス");
    expect(allPatterns).not.toContain("チームを編成する");
    expect(allPatterns).not.toContain("ボタン");
    expect(allPatterns).not.toContain("こおりタイプの防御が1.5倍");
    expect(labels.some((label) => /Already|Act$/.test(label))).toBe(false);
    expect(labels.some((label) => label.includes("btl_state_syn"))).toBe(false);
    expect(labels).not.toContain("BTL_STRID_SET_RankupLv3_1_P_syn");
    expect(labels).not.toContain("BTL_STRID_SET_RankupLv1_2_P_syn");
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
    expect(parseBattleMessage("日差しが 強くなった！")).toMatchObject({
      status: "event",
      event: {
        type: "weather_start",
        classification: {
          method: "template_dictionary",
          templateId: "champout_weather_start_17zypp5",
        },
      },
    });
    expect(parseBattleMessage("マフォクシーはやけどを 負った！")).toMatchObject({
      status: "event",
      event: {
        type: "status",
        actor: { name: "マフォクシー" },
        classification: {
          method: "template_dictionary",
          templateId: "champout_status_x7pe38",
        },
      },
    });
    expect(parseBattleMessage("マフォクシーには効果が ないようだ...")).toMatchObject({
      status: "event",
      event: {
        type: "immune",
        target: { name: "マフォクシー" },
      },
    });
    expect(parseBattleMessage("ヤバソチャは注目の的に なった!")).toMatchObject({
      status: "event",
      event: {
        type: "redirection",
        actor: { name: "ヤバソチャ" },
      },
    });
    expect(parseBattleMessage("相手の バンギラスはメガバンギラスに メガシンカした!")).toMatchObject({
      status: "event",
      event: {
        type: "activate",
        actor: { name: "バンギラス", side: "opponent" },
      },
    });
    expect(parseBattleMessage("相手の ガメノデスは ひるんで 技が だせない!")).toMatchObject({
      status: "event",
      event: {
        type: "flinch",
        actor: { name: "ガメノデス", side: "opponent" },
        classification: {
          method: "template_dictionary",
        },
      },
    });
    expect(parseBattleMessage("ニンフィアは 毒の ダメージを受けた!")).toMatchObject({
      status: "event",
      event: {
        type: "damage",
        target: { name: "ニンフィア" },
        classification: {
          method: "template_dictionary",
          templateId: "champout_damage_10w2owf",
        },
      },
    });
    expect(parseBattleMessage("相手の ドヒドイデは ワイドガードで 守られた!")).toMatchObject({
      status: "event",
      event: {
        type: "protect",
        actor: { name: "ドヒドイデ", side: "opponent" },
      },
    });
    expect(parseBattleMessage("エルフーンは きあいのタスキで もちこたえた!")).toMatchObject({
      status: "event",
      event: {
        type: "item",
        actor: { name: "エルフーン" },
      },
    });
    expect(parseBattleMessage("ニンフィアは 攻撃の 反動で 動けない!")).toMatchObject({
      status: "event",
      event: {
        type: "fail",
        actor: { name: "ニンフィア" },
      },
    });
    expect(
      parseBattleMessage("相手の ガメノデスは せんせいのツメで 行動が はやくなった!"),
    ).toMatchObject({
      status: "event",
      event: {
        type: "item",
        actor: { name: "ガメノデス", side: "opponent" },
        classification: {
          method: "template_dictionary",
        },
      },
    });
    expect(parseBattleMessage("相手の ガメノデスの 防御が ぐーんと 上がった!")).toMatchObject({
      status: "event",
      event: {
        type: "boost",
        actor: { name: "ガメノデス", side: "opponent" },
        classification: {
          alternatives: expect.arrayContaining([
            expect.stringContaining("stat:防御->防御:accepted"),
          ]),
        },
      },
    });
    expect(parseBattleMessage("ランドロスの 攻撃が がくっと 下がった!")).toMatchObject({
      status: "event",
      event: {
        type: "unboost",
        actor: { name: "ランドロス" },
      },
    });
  }, 30000);

  it("leaves unrelated UI text as unknown", () => {
    expect(parseBattleMessage("プレミアムバトルパス購入")).toMatchObject({
      status: "unknown",
    });
    expect(parseBattleMessage("こおりタイプの防御が1.5倍になる。")).toMatchObject({
      status: "unknown",
    });
  });
});
