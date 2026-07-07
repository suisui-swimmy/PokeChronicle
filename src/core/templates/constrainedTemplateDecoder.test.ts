import { describe, expect, it } from "vitest";
import { BATTLE_DICTIONARY } from "../dictionary/generatedBattleDictionary";
import { STAT_DICTIONARY } from "../dictionary/statDictionary";
import { createOcrMatchText } from "../normalize/ocrText";
import { STANDARD_TEMPLATE_RULES } from "./standardTemplateRules";
import { decodeConstrainedTemplate } from "./constrainedTemplateDecoder";

function surface(rawText: string, priority = 0) {
  return {
    id: "full",
    matchText: createOcrMatchText(rawText),
    priority,
  };
}

const BATTLE_DICTIONARY_WITH_STATS = {
  ...BATTLE_DICTIONARY,
  stats: STAT_DICTIONARY,
};

describe("decodeConstrainedTemplate", () => {
  it("projects a noisy opponent move onto the champout attack template", () => {
    const result = decodeConstrainedTemplate({
      surfaces: [surface("相手の キュウコンの\nオーパーヒードト/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.86,
    });

    expect(result).toMatchObject({
      accepted: true,
      eventType: "move",
      actor: { name: "キュウコン", side: "opponent" },
      move: "オーバーヒート",
      rule: { id: "champout_move_1pbrfiv" },
    });
    expect(result?.evidence).toContain("constrained:champout_move_1pbrfiv");
    expect(result?.placeholderResolutions.map((resolution) => resolution.value)).toEqual(
      expect.arrayContaining(["キュウコン", "オーバーヒート"]),
    );
  });

  it("uses free text only as evidence for trainer/noise segments", () => {
    const result = decodeConstrainedTemplate({
      surfaces: [surface("Mercysanは 國論謀キュウコンを 繰り出した!")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.82,
    });

    expect(result).toMatchObject({
      accepted: true,
      eventType: "switch_in",
      actor: { name: "キュウコン" },
    });
    expect(result?.placeholderResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "text", method: "free_text" }),
        expect.objectContaining({ kind: "pokemon", value: "キュウコン" }),
      ]),
    );
  });

  it("accepts noisy switch call and return templates when the dictionary margin is clear", () => {
    const switchIn = decodeConstrainedTemplate({
      surfaces: [surface("ゆけつ/ ガブプリアス/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.82,
    });
    const switchOut = decodeConstrainedTemplate({
      surfaces: [surface("ドドグザフン\n戻れ/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.84,
    });

    expect(switchIn).toMatchObject({
      accepted: true,
      eventType: "switch_in",
      actor: { name: "ガブリアス" },
    });
    expect(switchOut).toMatchObject({
      accepted: true,
      eventType: "switch_out",
      actor: { name: "ドドゲザン" },
    });
  });

  it("projects noisy btl_set status and faint messages onto narrow generated templates", () => {
    const status = decodeConstrainedTemplate({
      surfaces: [surface("マフォジシーはやけどを 負った/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.88,
    });
    const faint = decodeConstrainedTemplate({
      surfaces: [surface("ガプリアスは たおれだ/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.86,
    });

    expect(status).toMatchObject({
      accepted: true,
      eventType: "status",
      actor: { name: "マフォクシー" },
      rule: { id: "champout_status_x7pe38" },
    });
    expect(faint).toMatchObject({
      accepted: true,
      eventType: "faint",
      actor: { name: "ガブリアス" },
      rule: { id: "champout_faint_1yphd8" },
    });
  });

  it("projects noisy generated btl_set effect templates for real-log OCR variants", () => {
    const rules = STANDARD_TEMPLATE_RULES.filter((rule) =>
      [
        "BTL_STRID_SET_MegaEvo_E",
        "BTL_STRID_SET_Konoyubi",
        "BTL_STRID_SET_AffGood_1",
      ].includes(rule.source?.labelName ?? ""),
    );
    const megaEvolution = decodeConstrainedTemplate({
      surfaces: [surface("相手の バンギラスは\nメ力八ンギラスに メガシン力した/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.82,
    });
    const redirection = decodeConstrainedTemplate({
      surfaces: [surface("ヤハバソチヤは\n注目の的に なった/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.9,
    });
    const supereffective = decodeConstrainedTemplate({
      surfaces: [surface("ヤハソチヤに\n効果は バウツグンただ/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.83,
    });

    expect(megaEvolution).toMatchObject({
      accepted: true,
      eventType: "activate",
      actor: { name: "バンギラス", side: "opponent" },
      rule: { id: "champout_activate_5yixin" },
    });
    expect(redirection).toMatchObject({
      accepted: true,
      eventType: "redirection",
      actor: { name: "ヤバソチャ" },
      rule: { id: "champout_redirection_zp3lh" },
    });
    expect(supereffective).toMatchObject({
      accepted: true,
      eventType: "supereffective",
      target: { name: "ヤバソチャ" },
      rule: { id: "champout_supereffective_hqpe25" },
    });
  });

  it("projects noisy generated flinch and priority-item templates only from narrow surfaces", () => {
    const rules = STANDARD_TEMPLATE_RULES.filter((rule) =>
      [
        "BTL_STRID_SET_ShrinkExe_E",
        "BTL_STRID_SET_UseItem_PriorityUpOnce_E",
      ].includes(rule.source?.labelName ?? ""),
    );
    const flinch = decodeConstrainedTemplate({
      surfaces: [surface("相手の ガメノデスは ひるんで 技が だせない/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.88,
    });
    const priorityItem = decodeConstrainedTemplate({
      surfaces: [surface("相手の ガメノデスは せんせいのツメで 行動が はやくなつた/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.88,
    });

    expect(flinch).toMatchObject({
      accepted: true,
      eventType: "flinch",
      actor: { name: "ガメノデス", side: "opponent" },
      rule: { id: "champout_flinch_1fbzyy3" },
    });
    expect(priorityItem).toMatchObject({
      accepted: true,
      eventType: "item",
      actor: { name: "ガメノデス", side: "opponent" },
      rule: { id: "champout_item_1s665oh" },
    });
  });

  it("keeps short suffix noise as evidence without contaminating placeholders", () => {
    const result = decodeConstrainedTemplate({
      surfaces: [surface("相手の キュウコンの オームーヒードヒ/ bh、亜")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.86,
    });

    expect(result).toMatchObject({
      accepted: true,
      eventType: "move",
      actor: { name: "キュウコン", side: "opponent" },
      move: "オーバーヒート",
      suffixNoise: expect.stringContaining("bh"),
    });
    expect(result?.identity).toContain("キュウコン");
    expect(result?.evidence).toContain("suffixNoise=");
  });

  it("keeps weak fuzzy candidates reviewable instead of accepted", () => {
    const result = decodeConstrainedTemplate({
      surfaces: [surface("相手の キュウの\nオーパーヒードト/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.42,
    });

    expect(result?.accepted).toBe(false);
    expect(result?.evidence).toContain("constrained:");
  });

  it("resolves stat placeholders only when the stat dictionary match is safe", () => {
    const rules = STANDARD_TEMPLATE_RULES.filter((rule) =>
      [
        "BTL_STRID_SET_RankupLv2_1_E_syn",
        "BTL_STRID_SET_RankdownLv2_1_E_syn",
      ].includes(rule.source?.labelName ?? ""),
    );
    const boost = decodeConstrainedTemplate({
      surfaces: [surface("相手の ガメノデスの 防御が ぐーんと上がった/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.88,
    });
    const weakStat = decodeConstrainedTemplate({
      surfaces: [surface("相手の ガメノデスの 防衛が ぐーんと上がった/")],
      dictionary: BATTLE_DICTIONARY_WITH_STATS,
      rules,
      ocrConfidence: 0.42,
    });

    expect(boost).toMatchObject({
      accepted: true,
      eventType: "boost",
      actor: { name: "ガメノデス", side: "opponent" },
      rule: { source: { labelName: "BTL_STRID_SET_RankupLv2_1_E_syn" } },
    });
    expect(boost?.placeholderResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stat", value: "防御", method: "exact" }),
      ]),
    );
    expect(boost?.evidence).toContain("stat:防御->防御:accepted");
    expect(weakStat?.accepted ?? false).toBe(false);
  });
});
