import { describe, expect, it } from "vitest";
import { matchDictionaryEntry, normalizedSimilarity } from "./fuzzyMatch";
import { SEED_POKEMON_DICTIONARY } from "./seedBattleDictionary";

describe("matchDictionaryEntry", () => {
  it("accepts exact dictionary matches", () => {
    expect(matchDictionaryEntry("エルフーン", SEED_POKEMON_DICTIONARY)).toMatchObject({
      best: "エルフーン",
      method: "exact",
      status: "accepted",
    });
  });

  it("accepts high-confidence fuzzy matches with enough margin", () => {
    expect(
      matchDictionaryEntry("マフォオクシー", SEED_POKEMON_DICTIONARY, {
        ocrConfidence: 0.9,
      }),
    ).toMatchObject({
      best: "マフォクシー",
      method: "fuzzy",
      status: "accepted",
    });
  });

  it("keeps fuzzy matches as review candidates when OCR confidence is low", () => {
    expect(
      matchDictionaryEntry("マフォオクシー", SEED_POKEMON_DICTIONARY, {
        ocrConfidence: 0.52,
      }),
    ).toMatchObject({
      best: "マフォクシー",
      method: "fuzzy",
      status: "needs_review",
      reason: "low-ocr-confidence",
    });
  });
});

describe("normalizedSimilarity", () => {
  it("scores single-character OCR insertions near the intended label", () => {
    expect(normalizedSimilarity("マフォオクシー", "マフォクシー")).toBeGreaterThan(0.84);
  });
});
