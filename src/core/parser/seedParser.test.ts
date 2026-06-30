import { describe, expect, it } from "vitest";
import { parseBattleMessage } from "./seedParser";

describe("parseBattleMessage", () => {
  it("parses a basic move message", () => {
    const result = parseBattleMessage("エルフーンの\nおいかぜ！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "エルフーン" },
      move: "おいかぜ",
      classification: { method: "seed_rule" },
    });
  });

  it("parses protect as an observed move when it appears in actor move form", () => {
    const result = parseBattleMessage("マフォクシーの\nまもる！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "マフォクシー" },
      move: "まもる",
      classification: { method: "seed_rule" },
    });
  });

  it("uses the generated full name dictionaries by default", () => {
    const result = parseBattleMessage("ガブリアスの\nじしん！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "ガブリアス" },
      move: "じしん",
    });
  });

  it("parses noisy OCR prefixes by exact pokemon and move spans", () => {
    const result = parseBattleMessage({
      rawText: "きき\nにーー\nエルフーンの\nムーンフォース/",
      lines: ["きき", "にーー", "エルフーンの", "ムーンフォース/"],
      ocrConfidence: 0.74,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "エルフーン", side: null },
      move: "ムーンフォース",
      classification: {
        method: "template_dictionary",
        templateId: "attack_actor_move_span",
      },
    });
  });

  it("uses the same span extraction for arbitrary generated dictionary names", () => {
    const result = parseBattleMessage({
      rawText: "xx\nガブリアスの\nじしん/",
      lines: ["xx", "ガブリアスの", "じしん/"],
      ocrConfidence: 0.8,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "ガブリアス" },
      move: "じしん",
      classification: { method: "template_dictionary" },
    });
  });

  it("keeps opponent side only when 相手の is immediately before the actor span", () => {
    const result = parseBattleMessage({
      rawText: "ノイズ\n相手の\nカラマネロの\nばかぢから/",
      lines: ["ノイズ", "相手の", "カラマネロの", "ばかぢから/"],
      ocrConfidence: 0.82,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "カラマネロ", side: "opponent" },
      move: "ばかぢから",
    });
  });

  it("does not split on の characters inside move names", () => {
    const result = parseBattleMessage("ルカリオの\nいのちがけ！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "ルカリオ" },
      move: "いのちがけ",
    });
  });

  it("uses safe fuzzy dictionary correction for high-confidence OCR", () => {
    const result = parseBattleMessage({
      rawText: "マフォオクシーの\nまもる/",
      ocrConfidence: 0.9,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "マフォクシー" },
      move: "まもる",
      classification: { method: "fuzzy_dictionary" },
    });
  });

  it("does not silently accept fuzzy corrections from low-confidence OCR", () => {
    const result = parseBattleMessage({
      rawText: "マフォオクシーの\nまもる/",
      ocrConfidence: 0.52,
    });

    expect(result).toMatchObject({
      status: "unknown",
      reviewStatus: "unreviewed",
    });
    expect(result.candidateMatches.join("\n")).toContain("low-ocr-confidence");
  });

  it("parses effectiveness messages", () => {
    expect(parseBattleMessage("効果は バツグンだ！")).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
    expect(parseBattleMessage("相手の カラマネロと オーロングに\n効果は バッグンだ/")).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
    expect(parseBattleMessage("効果は いまひとつのようだ")).toMatchObject({
      status: "event",
      event: { type: "resisted" },
    });
    expect(parseBattleMessage("効果が ないようだ...")).toMatchObject({
      status: "event",
      event: { type: "immune" },
    });
  });

  it("parses noisy context messages before attempting span move matching", () => {
    expect(
      parseBattleMessage({
        rawText: "きき\n効果は バツグンだ/",
        lines: ["きき", "効果は バツグンだ/"],
        ocrConfidence: 0.7,
      }),
    ).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
  });

  it("parses noisy HP loss messages with seed template rules", () => {
    const result = parseBattleMessage({
      rawText: "尼手の イダイトウは\n命が 少し削られた/\nーー 9/",
      lines: ["尼手の イダイトウは", "命が 少し削られた/", "ーー 9/"],
      ocrConfidence: 0.67,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "damage",
      actor: { name: "イダイトウ", side: null },
      move: null,
      classification: {
        method: "template_dictionary",
        templateId: "hp_loss_life_cost",
      },
    });
  });

  it("parses exact opponent HP loss templates with opponent side", () => {
    const result = parseBattleMessage({
      rawText: "相手の イダイトウは\n命が 少し削られた/",
      lines: ["相手の イダイトウは", "命が 少し削られた/"],
      ocrConfidence: 0.86,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "damage",
      actor: { name: "イダイトウ", side: "opponent" },
      classification: { templateId: "hp_loss_life_cost_opponent" },
    });
  });

  it("parses seed weather and terrain templates", () => {
    expect(parseBattleMessage("雨が 降り始めた！")).toMatchObject({
      status: "event",
      event: {
        type: "weather_start",
        classification: { templateId: "weather_start" },
      },
    });
    expect(parseBattleMessage("エレキフィールドに なった！")).toMatchObject({
      status: "event",
      event: {
        type: "terrain_start",
        classification: { templateId: "terrain_start" },
      },
    });
  });

  it("parses simple stat boost and drop messages as context events", () => {
    expect(parseBattleMessage("相手の カラマネロの\n記導 習防が ごぐーんと上がった/")).toMatchObject({
      status: "event",
      event: { type: "boost" },
    });
    expect(parseBattleMessage("エルフーンの すばやさが 下がった！")).toMatchObject({
      status: "event",
      event: { type: "unboost" },
    });
  });

  it("keeps unrelated pokemon and move spans as unknown candidates", () => {
    const result = parseBattleMessage({
      rawText: "エルフーン\nムーンフォース/",
      lines: ["エルフーン", "ムーンフォース/"],
      ocrConfidence: 0.9,
    });

    expect(result.status).toBe("unknown");
    expect(result.candidateMatches.join("\n")).toContain("span:pokemon");
    expect(result.candidateMatches.join("\n")).toContain("span:move");
    expect(result.candidateMatches.join("\n")).toContain("missing-possessive-no");
  });

  it("keeps unsupported messages as reviewable unknowns", () => {
    expect(parseBattleMessage("まだ知らない特殊メッセージ")).toMatchObject({
      status: "unknown",
      reviewStatus: "unreviewed",
      classification: { method: "unknown" },
    });
  });
});
