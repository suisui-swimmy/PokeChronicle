import { describe, expect, it } from "vitest";
import { BATTLE_DICTIONARY } from "../dictionary/generatedBattleDictionary";
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

describe("decodeConstrainedTemplate", () => {
  it("projects a noisy opponent move onto the champout attack template", () => {
    const result = decodeConstrainedTemplate({
      surfaces: [surface("相手の キュウコンの\nオーパーヒードト/")],
      dictionary: BATTLE_DICTIONARY,
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
      dictionary: BATTLE_DICTIONARY,
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
      dictionary: BATTLE_DICTIONARY,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.82,
    });
    const switchOut = decodeConstrainedTemplate({
      surfaces: [surface("ドドグザフン\n戻れ/")],
      dictionary: BATTLE_DICTIONARY,
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

  it("keeps short suffix noise as evidence without contaminating placeholders", () => {
    const result = decodeConstrainedTemplate({
      surfaces: [surface("相手の キュウコンの オームーヒードヒ/ bh、亜")],
      dictionary: BATTLE_DICTIONARY,
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
      dictionary: BATTLE_DICTIONARY,
      rules: STANDARD_TEMPLATE_RULES,
      ocrConfidence: 0.42,
    });

    expect(result?.accepted).toBe(false);
    expect(result?.evidence).toContain("constrained:");
  });
});
