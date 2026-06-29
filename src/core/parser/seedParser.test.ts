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

  it("keeps unsupported messages as reviewable unknowns", () => {
    expect(parseBattleMessage("まだ知らない特殊メッセージ")).toMatchObject({
      status: "unknown",
      reviewStatus: "unreviewed",
      classification: { method: "unknown" },
    });
  });
});
